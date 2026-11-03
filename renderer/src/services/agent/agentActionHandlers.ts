import { t } from '@/i18n/index';
import { isGenerationNodeType } from '@/domain/graph/NodeType';
import { uid } from '@/utils/format';
import { DEFAULT_GENERATION_TIMEOUT_MS, nodeTypeLabel } from '@/store/nodeStore';
import { getAvailableModelIdsByType, getModelCredentialStatus, settingsStore } from '@/store/settingsStore';
import {
  getGenerationInputModes,
  getModelSchema,
  getTypeMeta,
  isModelForType,
  resolveModeIdForInputMode,
} from '@/domain/catalog/ModelCatalog';
import { compileGenerationNodeConfig, generationOutputSpec } from '@/domain/graph/GenerationNodeContract';
import { canvasNodeDimensions } from '@/domain/graph/CanvasNodeDimensions';
import { addCanvasEdge, deleteCanvasNodeData } from '@/store/canvasGraphStore';
import { toggleCanvasEdge } from '@/store/canvasEdgeStore';
import { cancelNode, failedTaskStatuses, findLatestTaskForNode, runNode } from '@/store/taskStore';
import { validateAgentInputRole } from '@/services/agentInputRole';
import {
  defaultInputSlot,
  isSlotValidForMode,
  type GenerationInputSlot,
} from '@/domain/graph/GenerationInputContract';
import { numberFromAgentAction, sizeFromAgentAction } from '@/services/agentNodeFactory';
import { canvasArtifactType } from '../agentTypes';
import type {
  AgentAction,
  AgentActionResult,
  AgentAttachment,
  AgentInputMode,
  AgentInputRole,
  AgentNode,
  AgentProject,
  JsonObject,
} from '../agentTypes';

/**
 * 执行器交给单个 Action 的全部能力。
 *
 * 这里只允许项目本体和稳定引用解析：节点 ID 解析必须由执行器统一负责，
 * 因为 tempId 与语义别名映射是跨批次持久的；其余字段一概不进上下文，
 * 避免动作实现拿到一个可以随意塞内部状态的 `Record<string, any>`。
 */
export interface ActionHandlerContext {
  project: AgentProject;
  tempIdMap: Map<string, string>;
  resolveNode: (ref: string | null | undefined) => AgentNode | null;
  resolveNodeId: (ref: string | number | null | undefined) => string | null;
  defaultNodePosition: (action: AgentAction) => { x: number; y: number };
}

/** 素材库与资产记录在磁盘上是松散 JSON，这里只声明动作真正读取的字段。 */
interface AssetLike {
  id?: string;
  name?: string;
  note?: string;
  path?: string;
  filePath?: string;
  resourceType?: string;
  nodeType?: string;
  materialId?: string;
  [key: string]: unknown;
}

interface MaterialLike {
  id?: string;
  name?: string;
  note?: string;
  path?: string;
  filePath?: string;
  content?: string;
  resourceType?: string;
  mimeType?: string;
  type?: string;
  nodeType?: string;
  sourceType?: string;
  source?: string;
  size?: number;
  [key: string]: unknown;
}

function asRecords<T>(value: unknown): T[] {
  return (Array.isArray(value) ? value : []) as T[];
}

function nodeTypeForResource(resourceType: string): string {
  return {
    image: 'imageGeneration',
    video: 'videoGeneration',
    audio: 'audioGeneration',
    text: 'textGeneration',
    file: 'textGeneration',
  }[resourceType] || 'textGeneration';
}

function resourceTypeForAttachment(file: Record<string, unknown> = {}): string {
  const explicit = String(file.resourceType || file.mimeType || file.type || '').toLowerCase();
  if (explicit.includes('image')) return 'image';
  if (explicit.includes('video')) return 'video';
  if (explicit.includes('audio')) return 'audio';
  const stem = String(file.name || file.fileName || file.path || file.filePath || '')
    .split(/[?#]/)[0] ?? '';
  const ext = stem.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'svg'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'webm', 'm4v'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext)) return 'audio';
  return explicit || 'file';
}

function preferredModel(nodeType: string): string {
  const remoteDefault = getTypeMeta(nodeType).defaultModel;
  const preferred = nodeType === 'textGeneration' ? settingsStore.agentPreferredTextModel
    : nodeType === 'imageGeneration' ? settingsStore.agentPreferredImageModel
      : nodeType === 'videoGeneration' ? settingsStore.agentPreferredVideoModel
        : remoteDefault;
  const available = getAvailableModelIdsByType(nodeType);
  return available.includes(preferred) ? preferred : available[0] || '';
}

function normalizedInteger(value: unknown, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) && next >= 0 ? Math.round(next) : fallback;
}

function attachmentFromAction(action: AgentAction): JsonObject | null {
  const attachments = asRecords<AgentAttachment>(action.data?.attachments);
  const file = attachments.find((item) => item?.path || item?.filePath || item?.url);
  if (!file) return null;
  const path = String(file.path || file.filePath || '');
  return {
    name: file.name || file.fileName || path.split(/[\\/]/).pop() || t('agent.execution.referenceFile'),
    path,
    filePath: path,
    url: file.url || '',
    type: file.mimeType || file.type || '',
    size: Number(file.size) || 0,
    materialId: file.materialId || '',
    resourceType: resourceTypeForAttachment(file),
    source: 'agent-attachment',
  };
}

function planReferenceFromAction(action: AgentAction): JsonObject | null {
  if (action.agentPlan) return action.agentPlan as JsonObject;
  if (!action.tempId) return null;
  return {
    id: String(action.tempId),
    source: 'assistant',
    artifactRole: String(action.artifactRole || ''),
    segmentIds: Array.isArray(action.segmentIds) ? [...action.segmentIds] : [],
  };
}

/**
 * 一条上游输入的真实落地：角色来自上游节点类型，输入模式与槽位只来自模型目录能力。
 *
 * `connect_nodes` 和 `create_gen_node.inputLinks` 共用这一份解析，否则同一个输入语义
 * 会在两个工具入口写出不同的持久化结构，运行期与界面就会各自认一套边。
 */
function connectInputEdge(
  targetId: string,
  link: { source?: unknown; role?: unknown; slot?: unknown; required?: unknown },
  context: ActionHandlerContext,
): AgentActionResult {
  const { project } = context;
  const sourceId = context.resolveNodeId(link.source as string | number | null | undefined);
  const source = project.nodes.find((node) => node.id === sourceId) || null;
  const target = project.nodes.find((node) => node.id === targetId) || null;
  const validation = validateAgentInputRole(
    project,
    source,
    target,
    String(link.role || 'auto') as AgentInputRole | 'auto',
  );
  if (!validation.valid || !source || !target || !sourceId) {
    return { applied: false, error: validation.error };
  }
  const role = validation.role;
  const required = link.required !== false;
  const writeEdge = (slot?: GenerationInputSlot): AgentActionResult => {
    const result = addCanvasEdge(project, sourceId, targetId, {
      touch: false,
      updateExisting: true,
      edge: {
        kind: 'typed-input',
        data: {
          inputRole: role,
          ...(slot ? { inputSlot: slot } : {}),
          required,
        },
      },
    });
    if (!result.ok) return { applied: false, error: result.error };
    return {
      applied: true,
      sourceId,
      targetId,
      role,
      required,
      edgeId: result.edge?.id || null,
      existed: result.existed,
    };
  };
  // 文本上下文没有槽位语义，也不占用输入模式。
  if (role === 'textContext') return writeEdge();

  const modes = getGenerationInputModes(String(target.model || ''));
  const activeMode = modes.find((item) => item.value === target.inputMode) || modes[0];
  if (!activeMode) {
    return { applied: false, error: t('agent.execution.noModes', { value0: target.model || t('agent.execution.unset'), value1: role }) };
  }
  const capacity = role === 'referenceImage' ? activeMode.maxImages
    : role === 'inputVideo' ? activeMode.maxVideos
      : activeMode.maxAudios;
  if (capacity <= 0) {
    return { applied: false, error: t('agent.execution.roleUnsupported', { value0: activeMode.label, value1: role }) };
  }
  const occupied = project.edges
    .filter((edge) => edge.target === targetId)
    .map((edge) => String(edge.data?.inputSlot || ''))
    .filter(Boolean) as GenerationInputSlot[];
  const slot = (link.slot
    ? String(link.slot)
    : defaultInputSlot(activeMode.value, role, occupied)) as GenerationInputSlot;
  if (!isSlotValidForMode(activeMode.value, slot, role)) {
    return { applied: false, error: t('agent.execution.slotMode', { value0: slot, value1: activeMode.value }) };
  }
  target.inputMode = activeMode.value;
  return writeEdge(slot);
}

function resolveProjectMaterial(project: AgentProject, action: AgentAction) {
  const assets = asRecords<AssetLike>(project.assets);
  const materials = asRecords<MaterialLike>(project.materials);
  const materialById = new Map(materials.map((item) => [String(item.id), item]));
  const assetName = String(action.assetName || '').trim().toLocaleLowerCase();
  let asset: AssetLike | null = null;
  let material: MaterialLike | null = null;
  if (action.assetId) {
    asset = assets.find((item) => String(item.id) === String(action.assetId)) || null;
    if (!asset) return { error: t('agent.execution.assetMissing', { value0: action.assetId }) };
    material = materialById.get(String(asset.materialId)) || null;
  } else if (action.materialId) {
    material = materialById.get(String(action.materialId)) || null;
    asset = assets.find((item) => String(item.materialId) === String(action.materialId)) || null;
  } else {
    const matches = materials.filter((item) => String(item.name || '').trim().toLocaleLowerCase() === assetName);
    for (const item of assets) {
      if (String(item.name || '').trim().toLocaleLowerCase() !== assetName) continue;
      const candidate = materialById.get(String(item.materialId));
      if (candidate && !matches.some((value) => value.id === candidate.id)) matches.push(candidate);
    }
    if (matches.length > 1) return { error: t('agent.execution.ambiguousAsset', { value0: String(action.assetName) }) };
    material = matches[0] || null;
    asset = material
      ? assets.find((item) => String(item.materialId) === String(material?.id)) || null
      : null;
  }
  if (!material) return { error: t('agent.execution.materialMissing', { value0: String(action.materialId || action.assetName || action.assetId) }) };
  const resourceType = String(asset?.resourceType || material.resourceType || resourceTypeForAttachment(material));
  if (!material.path && !material.filePath && resourceType !== 'text' && !material.content) {
    return { error: t('agent.execution.assetFile', { value0: String(asset?.name || material.name || material.id) }) };
  }
  return { asset, material, resourceType };
}

const OUTPUT_SPEC_CONFIG_KEYS: Record<string, string[]> = {
  aspectRatio: ['aspectRatio', 'size', 'imageSize'],
  duration: ['duration'],
  resolution: ['resolution'],
  generationCount: ['generationCount'],
  generateAudio: ['generateAudio'],
  quality: ['quality'],
};

/**
 * outputSpec 是语义来源，config 里的同名参数只是它的旧写法。
 * 两者同时出现时以 action.config 为准，否则把被 outputSpec 接管的 config 字段清掉，
 * 避免同一个比例或时长在节点上留下两份互相冲突的值。
 */
function configSourceForOutputSpecUpdate(nodeConfig: JsonObject, action: AgentAction) {
  const config = (action.config || {}) as Record<string, unknown>;
  const source: Record<string, unknown> = { ...(nodeConfig as Record<string, unknown>), ...config };
  const semanticPatch: Record<string, unknown> = { ...((action.outputSpec || {}) as Record<string, unknown>) };
  for (const key of Object.keys(OUTPUT_SPEC_CONFIG_KEYS)) {
    if (config[key] !== undefined) semanticPatch[key] = config[key];
  }
  for (const key of Object.keys(semanticPatch)) {
    for (const configKey of OUTPUT_SPEC_CONFIG_KEYS[key] || []) {
      if (config[configKey] === undefined) delete source[configKey];
    }
  }
  return source;
}

function createGenerationNode(action: AgentAction, context: ActionHandlerContext): AgentActionResult {
  const requestedNodeType = String(action.nodeType || '');
  const nodeType = isGenerationNodeType(requestedNodeType) ? requestedNodeType : 'imageGeneration';
  const position = context.defaultNodePosition(action);
  const model = String(action.model || preferredModel(nodeType));
  const inputModes = getGenerationInputModes(model);
  const inputMode = String(action.inputMode || inputModes[0]?.value || '');
  if (action.inputMode && !inputModes.some((item) => item.value === inputMode)) {
    return { applied: false, error: t('agent.execution.inputMode', { value0: model, value1: inputMode }) };
  }
  const outputSpec = generationOutputSpec(nodeType, action.config, action.outputSpec);
  const config = compileGenerationNodeConfig(
    action.config,
    getModelSchema(nodeType, model, resolveModeIdForInputMode(model, inputMode)).params,
    outputSpec,
  ) as JsonObject;
  const credentialStatus = getModelCredentialStatus(model);
  if (!credentialStatus.available) {
    return { applied: false, error: t('agent.execution.credentials', { value0: credentialStatus.message }) };
  }
  const dimensions = canvasNodeDimensions({ type: nodeType });
  const attachment = attachmentFromAction(action);
  const plan = planReferenceFromAction(action);
  const node: AgentNode = {
    id: uid(),
    type: nodeType,
    artifactType: canvasArtifactType(action.artifactType),
    ...(action.tempId ? { agentTempId: String(action.tempId) } : {}),
    title: String(action.title || action.name || nodeTypeLabel(nodeType)),
    prompt: String(action.prompt || ''),
    model,
    ...(inputMode ? { inputMode: inputMode as AgentInputMode } : {}),
    recipeId: String(action.recipeId || ''),
    config,
    ...(Object.keys(outputSpec).length ? { outputSpec: outputSpec as JsonObject } : {}),
    status: 'idle',
    progress: 0,
    retryCount: 0,
    maxRetries: 2,
    timeoutMs: DEFAULT_GENERATION_TIMEOUT_MS,
    width: sizeFromAgentAction(action, 'width', dimensions.width),
    height: sizeFromAgentAction(action, 'height', dimensions.height),
    x: position.x,
    y: position.y,
    createdAt: new Date().toISOString(),
    ...(plan ? { agentPlan: plan } : {}),
    ...(attachment ? { uploadedFile: attachment } : {}),
  };
  context.project.nodes.push(node);
  if (action.tempId) context.tempIdMap.set(String(action.tempId), node.id);
  const links = Array.isArray(action.inputLinks) ? action.inputLinks : [];
  const inputLinkResults = links.map((link) => connectInputEdge(node.id, {
    source: link?.nodeId,
    role: link?.role,
    slot: link?.slot,
    required: link?.required,
  }, context));
  return {
    applied: true,
    createdNodeId: node.id,
    nodeId: node.id,
    taskId: null,
    inputLinkResults,
    outputSpec,
    resolvedConfig: config,
    referenceAttachmentCount: attachment ? 1 : 0,
    referenceAttachmentName: String(attachment?.name || ''),
  };
}

function placeAssetOnCanvas(action: AgentAction, context: ActionHandlerContext): AgentActionResult {
  const resolved = resolveProjectMaterial(context.project, action);
  if (resolved.error || !resolved.material) return { applied: false, error: resolved.error };
  const { asset, material, resourceType } = resolved;
  const requestedType = String(asset?.nodeType || material.nodeType || nodeTypeForResource(resourceType));
  const nodeType = isGenerationNodeType(requestedType) ? requestedType : nodeTypeForResource(resourceType);
  const position = context.defaultNodePosition(action);
  const dimensions = canvasNodeDimensions({ type: nodeType });
  const path = String(material.path || material.filePath || '');
  const title = String(action.title || asset?.name || material.name || t('agent.execution.assetReference'));
  const content = String(material.content || asset?.note || material.note || path || title);
  const sourceType = String(material.sourceType || material.source || 'material-library');
  const node: AgentNode = {
    id: uid(),
    type: nodeType,
    artifactType: canvasArtifactType(action.artifactType),
    ...(action.tempId ? { agentTempId: String(action.tempId) } : {}),
    title,
    prompt: String(asset?.note || material.note || ''),
    model: preferredModel(nodeType),
    config: compileGenerationNodeConfig({}, getModelSchema(nodeType, preferredModel(nodeType)).params) as JsonObject,
    content,
    materialId: String(material.id || ''),
    assetId: String(asset?.id || ''),
    resourceType,
    sourceType,
    uploadedFile: {
      name: title,
      path,
      filePath: path,
      type: String(material.mimeType || material.type || ''),
      size: Number(material.size) || 0,
      materialId: String(material.id || ''),
      assetId: String(asset?.id || ''),
      resourceType,
      source: sourceType,
      ...(!path && resourceType === 'text' ? { content } : {}),
    },
    status: 'idle',
    progress: 0,
    width: sizeFromAgentAction(action, 'width', dimensions.width),
    height: sizeFromAgentAction(action, 'height', dimensions.height),
    x: position.x,
    y: position.y,
    createdAt: new Date().toISOString(),
  };
  context.project.nodes.push(node);
  if (action.tempId) context.tempIdMap.set(String(action.tempId), node.id);
  return { applied: true, createdNodeId: node.id, nodeId: node.id, materialId: material.id, assetId: asset?.id || '' };
}

function updateGenerationConfig(action: AgentAction, context: ActionHandlerContext): AgentActionResult {
  const node = context.resolveNode(action.nodeId);
  if (!node) return { applied: false, error: t('agent.execution.noNode') };
  const nextModel = String(action.model || node.model || '');
  if (!isModelForType(node.type, nextModel)) {
    return { applied: false, error: t('agent.execution.modelType', { value0: nextModel, value1: node.type }) };
  }
  const credentialStatus = getModelCredentialStatus(nextModel);
  if (!credentialStatus.available) return { applied: false, error: credentialStatus.message };
  const availableInputModes = getGenerationInputModes(nextModel);
  const retainedInputMode = availableInputModes.some((item) => item.value === node.inputMode) ? node.inputMode : '';
  const nextInputMode = String(action.inputMode || retainedInputMode || availableInputModes[0]?.value || '');
  if (nextInputMode && !availableInputModes.some((item) => item.value === nextInputMode)) {
    return { applied: false, error: t('agent.execution.nextMode', { value0: nextModel, value1: nextInputMode }) };
  }
  const outputSpecPatch = generationOutputSpec(node.type, action.config, action.outputSpec);
  const nextOutputSpec = generationOutputSpec(
    node.type,
    {},
    { ...(node.outputSpec as Record<string, unknown> || {}), ...outputSpecPatch },
  );
  const nextConfig = compileGenerationNodeConfig(
    configSourceForOutputSpecUpdate(node.config || {}, action),
    getModelSchema(node.type, nextModel, resolveModeIdForInputMode(nextModel, nextInputMode)).params,
    nextOutputSpec,
  );
  node.config = nextConfig as JsonObject;
  if (Object.keys(nextOutputSpec).length) node.outputSpec = nextOutputSpec as JsonObject;
  else delete node.outputSpec;
  if (action.title || action.name) node.title = String(action.title || action.name);
  if (action.artifactType) node.artifactType = canvasArtifactType(action.artifactType);
  node.prompt = String(action.prompt || node.prompt || '');
  node.model = nextModel;
  if (nextInputMode) node.inputMode = nextInputMode as AgentInputMode;
  else delete node.inputMode;
  if (action.recipeId) node.recipeId = String(action.recipeId);
  node.maxRetries = normalizedInteger(node.maxRetries, 2);
  node.timeoutMs = normalizedInteger(node.timeoutMs, DEFAULT_GENERATION_TIMEOUT_MS);
  const status = String(node.status || '');
  if (['failed', 'timeout', 'error', 'cancelled'].includes(status)
    || (status === 'idle' && node.error)) {
    node.status = 'idle';
    node.progress = 0;
    node.retryCount = 0;
    node.error = '';
    node.lastAgentRepairAt = new Date().toISOString();
  }
  return { applied: true, nodeId: node.id, outputSpec: nextOutputSpec, resolvedConfig: nextConfig };
}

function setArtifactType(action: AgentAction, context: ActionHandlerContext): AgentActionResult {
  const node = context.resolveNode(action.nodeId);
  if (!node) return { applied: false, error: t('agent.execution.noNode') };
  node.artifactType = canvasArtifactType(action.artifactType);
  return { applied: true, nodeId: node.id, artifactType: node.artifactType };
}

async function startGeneration(action: AgentAction, context: ActionHandlerContext): Promise<AgentActionResult> {
  const node = context.resolveNode(action.nodeId);
  if (!node) return { applied: false };
  const currentStatus = String(node.status || 'idle');
  if (currentStatus === 'running') return { applied: false };
  if (currentStatus === 'completed' && action.force !== true) return { applied: false };
  const latestTask = findLatestTaskForNode(node.id);
  const nextRetryCount = failedTaskStatuses.has(currentStatus)
    ? Number(latestTask?.retryCount || node.retryCount || 0) + 1 : 0;
  const maxRetries = normalizedInteger(latestTask?.maxRetries ?? node.maxRetries, 2);
  if (failedTaskStatuses.has(currentStatus) && nextRetryCount > maxRetries) return { applied: false };
  const options = { onlyRetryFailed: action.force !== true, retryCount: nextRetryCount };
  let task = runNode(node, options);
  if (!task) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    task = runNode(node, options);
  }
  return { applied: Boolean(task), nodeId: node.id, taskId: task?.id || null };
}

function deleteNode(action: AgentAction, context: ActionHandlerContext): AgentActionResult {
  const node = context.resolveNode(action.nodeId);
  if (!node) return { applied: false };
  cancelNode(node.id);
  return { applied: deleteCanvasNodeData(node.id, { touch: false }), nodeId: node.id };
}

/**
 * 删除边只按 edgeId 或 source+target 定位，位置参数不参与匹配，
 * 因为画布同一对节点允许多条并行边。
 */
function deleteEdge(action: AgentAction, context: ActionHandlerContext): AgentActionResult {
  const { project } = context;
  const before = project.edges.length;
  const sourceId = context.resolveNodeId(action.source);
  const targetId = context.resolveNodeId(action.target);
  project.edges = project.edges.filter((edge) => (
    action.edgeId ? edge.id !== action.edgeId : !(edge.source === sourceId && edge.target === targetId)
  ));
  return { applied: before !== project.edges.length };
}

function moveNode(action: AgentAction, context: ActionHandlerContext): AgentActionResult {
  const node = context.resolveNode(action.nodeId);
  if (!node || (!action.position && action.x == null && action.y == null)) return { applied: false };
  node.x = numberFromAgentAction(action, 'x', Number(node.x) || 0);
  node.y = numberFromAgentAction(action, 'y', Number(node.y) || 0);
  return { applied: true, nodeId: node.id };
}

function toggleEdge(action: AgentAction, context: ActionHandlerContext): AgentActionResult {
  const { project } = context;
  const sourceId = context.resolveNodeId(action.source);
  const targetId = context.resolveNodeId(action.target);
  let edgeId = String(action.edgeId || '');
  if (!edgeId) {
    const edge = project.edges.find((item) => item.source === sourceId && item.target === targetId);
    if (edge) edgeId = String(edge.id);
  }
  if (!edgeId) return { applied: false, error: t('agent.execution.toggleEdge') };
  const enabled = action.enabled === undefined ? undefined : Boolean(action.enabled);
  return { applied: toggleCanvasEdge(project, edgeId, enabled), edgeId };
}

/**
 * 单个 Action 的唯一落地入口。
 *
 * 类型白名单来自 agent-action-contract.json，校验层已经在批次里拒绝未知类型；
 * 这里的默认分支只兜住"契约新增了类型但还没有落地实现"，
 * 返回可修复的回执让模型改参数，而不是抛错终止整轮运行。
 */
export async function applyAgentAction(
  action: AgentAction,
  context: ActionHandlerContext,
): Promise<AgentActionResult> {
  switch (action?.type) {
    case 'create_gen_node': return createGenerationNode(action, context);
    case 'place_asset_on_canvas': return placeAssetOnCanvas(action, context);
    case 'update_gen_config': return updateGenerationConfig(action, context);
    case 'set_artifact_type': return setArtifactType(action, context);
    case 'start_generation': return startGeneration(action, context);
    case 'connect_nodes': {
      const targetId = context.resolveNodeId(action.target);
      if (!targetId) return { applied: false, error: t('agent.execution.targetMissing') };
      return connectInputEdge(targetId, {
        source: action.source,
        role: action.role,
        slot: action.slot,
        required: action.required,
      }, context);
    }
    case 'delete_node': return deleteNode(action, context);
    case 'delete_edge': return deleteEdge(action, context);
    case 'move_node': return moveNode(action, context);
    case 'toggle_edge': return toggleEdge(action, context);
    default: return { applied: false, error: t('agent.execution.unimplemented', { value0: action?.type || t('agent.execution.empty') }) };
  }
}
