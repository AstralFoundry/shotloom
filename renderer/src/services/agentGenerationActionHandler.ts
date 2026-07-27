import { uid } from '@/utils/format';
import {
  DEFAULT_GENERATION_TIMEOUT_MS,
  nodeTypeLabel,
} from '@/store/nodeStore';
import {
  getAvailableModelIdsByType,
  getModelCredentialStatus,
  settingsStore,
} from '@/store/settingsStore';
import { getModelSchema, getTypeMeta, isModelForType } from '@/domain/catalog/ModelCatalog';
import {
  compileGenerationNodeConfig,
  generationOutputSpec,
} from '@/domain/graph/GenerationNodeContract';
import { canvasNodeDimensions } from './agentLayoutService';
import type { AgentAction, AgentActionResult, AgentAttachment, AgentNode } from './agentTypes';

type GenerationAction = AgentAction & Record<string, any>;
type GenerationActionContext = Record<string, any>;

const GENERATION_NODE_TYPES = new Set([
  'imageGeneration', 'videoGeneration', 'audioGeneration', 'textGeneration',
]);

function nodeTypeForResource(resourceType: string): string {
  return {
    image: 'imageGeneration',
    video: 'videoGeneration',
    audio: 'audioGeneration',
    text: 'textGeneration',
    file: 'textGeneration',
  }[resourceType] || 'textGeneration';
}

function resolveProjectMaterial(project: Record<string, any>, action: GenerationAction) {
  const assets = Array.isArray(project.assets) ? project.assets : [];
  const materials = Array.isArray(project.materials) ? project.materials : [];
  const materialById = new Map(materials.map((item: any) => [String(item.id), item]));
  let asset: any = null;
  let material: any = null;
  if (action.assetId) {
    asset = assets.find((item: any) => String(item.id) === String(action.assetId));
    if (!asset) return { error: `素材库条目不存在：${action.assetId}` };
    material = materialById.get(String(asset.materialId));
  } else if (action.materialId) {
    material = materialById.get(String(action.materialId));
    asset = assets.find((item: any) => String(item.materialId) === String(action.materialId)) || null;
  } else {
    const name = String(action.assetName || '').trim().toLocaleLowerCase();
    const matches = materials.filter((item: any) => String(item.name || '').trim().toLocaleLowerCase() === name);
    for (const item of assets) {
      if (String(item.name || '').trim().toLocaleLowerCase() !== name) continue;
      const candidate = materialById.get(String(item.materialId));
      if (candidate && !matches.some((value: any) => value.id === candidate.id)) matches.push(candidate);
    }
    if (matches.length > 1) return { error: `素材名称不唯一，请改用 assetId 或 materialId：${action.assetName}` };
    material = matches[0];
    asset = material ? assets.find((item: any) => String(item.materialId) === String(material.id)) || null : null;
  }
  if (!material) return { error: `素材文件不存在：${action.materialId || action.assetName || action.assetId}` };
  const resourceType = String(asset?.resourceType || material.resourceType || resourceTypeForAttachment(material));
  if (!material.path && !material.filePath && resourceType !== 'text' && !material.content) {
    return { error: `素材没有可读取的真实文件：${asset?.name || material.name || material.id}` };
  }
  return { asset, material, resourceType };
}

function normalizedInteger(value: unknown, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) && next >= 0 ? Math.round(next) : fallback;
}

const OUTPUT_SPEC_CONFIG_KEYS: Record<string, string[]> = {
  aspectRatio: ['aspectRatio', 'size', 'imageSize'],
  duration: ['duration'],
  resolution: ['resolution'],
  generationCount: ['generationCount'],
  generateAudio: ['generateAudio'],
  quality: ['quality'],
};

function configSourceForOutputSpecUpdate(nodeConfig: Record<string, any>, action: GenerationAction) {
  const source = { ...nodeConfig, ...(action.config || {}) };
  const semanticPatch = { ...(action.outputSpec || {}) };
  for (const key of Object.keys(OUTPUT_SPEC_CONFIG_KEYS)) {
    if (action.config?.[key] !== undefined) semanticPatch[key] = action.config[key];
  }
  for (const key of Object.keys(semanticPatch)) {
    for (const configKey of OUTPUT_SPEC_CONFIG_KEYS[key] || []) {
      if (action.config?.[configKey] === undefined) delete source[configKey];
    }
  }
  return source;
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

function resourceTypeForAttachment(file: AgentAttachment = {}): string {
  const explicit = String(file.resourceType || file.mimeType || file.type || '').toLowerCase();
  if (explicit.includes('image')) return 'image';
  if (explicit.includes('video')) return 'video';
  if (explicit.includes('audio')) return 'audio';
  const ext = String(file.name || file.fileName || file.path || file.filePath || '')
    .split(/[?#]/)[0].split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'svg'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'webm', 'm4v'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext)) return 'audio';
  return explicit || 'file';
}

function agentAttachment(action: GenerationAction = { type: '' }) {
  const attachments = Array.isArray(action.data?.attachments) ? action.data.attachments : [];
  const file = attachments.find((item) => item?.path || item?.filePath || item?.url);
  if (!file) return null;
  const path = file.path || file.filePath || '';
  return {
    name: file.name || file.fileName || path.split(/[\\/]/).pop() || 'Agent 参考文件',
    path,
    filePath: path,
    url: file.url || '',
    type: file.mimeType || file.type || '',
    size: Number(file.size) || 0,
    materialId: file.materialId || '',
    resourceType: resourceTypeForAttachment(file),
    source: 'copilot-attachment',
  };
}

export function handleAgentGenerationAction(
  action: GenerationAction,
  context: GenerationActionContext,
): AgentActionResult | null {
  const type = action?.type;
  if (!['create_gen_node', 'place_asset_on_canvas', 'update_gen_config'].includes(type)) return null;
  const { project, resolveNode, defaultNodePosition, sizeFromAction, connectInputLinks, tempIdMap } = context;

  if (type === 'place_asset_on_canvas') {
    const resolved = resolveProjectMaterial(project, action);
    if (resolved.error || !resolved.material) return { applied: false, error: resolved.error };
    const { asset, material, resourceType } = resolved;
    const requestedType = String(asset?.nodeType || material.nodeType || nodeTypeForResource(String(resourceType)));
    const nodeType = GENERATION_NODE_TYPES.has(requestedType) ? requestedType : nodeTypeForResource(String(resourceType));
    const model = preferredModel(nodeType);
    const position = defaultNodePosition(action);
    const dimensions = canvasNodeDimensions({ type: nodeType });
    const path = String(material.path || material.filePath || '');
    const title = String(action.title || asset?.name || material.name || '素材参考');
    const content = String(material.content || asset?.note || material.note || path || title);
    const node: AgentNode = {
      id: uid(),
      type: nodeType,
      ...(action.tempId ? { agentTempId: String(action.tempId) } : {}),
      title,
      prompt: String(asset?.note || material.note || ''),
      model,
      config: compileGenerationNodeConfig({}, getModelSchema(nodeType, model).params) as any,
      content,
      materialId: String(material.id || ''),
      assetId: String(asset?.id || ''),
      resourceType: String(resourceType),
      sourceType: String(material.sourceType || material.source || 'material-library'),
      uploadedFile: {
        name: title,
        path,
        filePath: path,
        type: String(material.mimeType || material.type || ''),
        size: Number(material.size) || 0,
        materialId: String(material.id || ''),
        assetId: String(asset?.id || ''),
        resourceType: String(resourceType),
        source: String(material.sourceType || material.source || 'material-library'),
        ...(!path && resourceType === 'text' ? { content } : {}),
      },
      status: 'idle',
      progress: 0,
      width: sizeFromAction(action, 'width', dimensions.width),
      height: sizeFromAction(action, 'height', dimensions.height),
      x: position.x,
      y: position.y,
      createdAt: new Date().toISOString(),
    };
    project.nodes.push(node);
    if (action.tempId) tempIdMap.set(String(action.tempId), node.id);
    return { applied: true, createdNodeId: node.id, nodeId: node.id, materialId: material.id, assetId: asset?.id || '' };
  }

  if (type === 'create_gen_node') {
    const requestedNodeType = String(action.nodeType || '');
    const nodeType = GENERATION_NODE_TYPES.has(requestedNodeType) ? requestedNodeType : 'imageGeneration';
    const position = defaultNodePosition(action);
    const model = String(action.model || preferredModel(nodeType));
    const outputSpec = generationOutputSpec(nodeType, action.config, action.outputSpec);
    const config: Record<string, any> = compileGenerationNodeConfig(
      action.config,
      getModelSchema(nodeType, model, String(action.config?.mode || '')).params,
      outputSpec,
    );
    const prompt = String(action.prompt || '');
    const dimensions = canvasNodeDimensions({ type: nodeType });
    const credentialStatus = getModelCredentialStatus(model);
    if (!credentialStatus.available) {
      return { applied: false, error: `${credentialStatus.message}，Agent 不会创建不可运行的生成节点` };
    }
    const node: AgentNode = {
      id: uid(),
      type: String(nodeType),
      ...(action.tempId ? { agentTempId: String(action.tempId) } : {}),
      title: String(action.title || action.name || nodeTypeLabel(nodeType)),
      prompt,
      model,
      recipeId: String(action.recipeId || ''),
      config,
      ...(Object.keys(outputSpec).length ? { outputSpec: outputSpec as any } : {}),
      status: 'idle',
      progress: 0,
      retryCount: 0,
      maxRetries: 2,
      timeoutMs: DEFAULT_GENERATION_TIMEOUT_MS,
      width: sizeFromAction(action, 'width', dimensions.width),
      height: sizeFromAction(action, 'height', dimensions.height),
      x: position.x,
      y: position.y,
      createdAt: new Date().toISOString(),
      agentPlan: action.agentPlan || (action.tempId ? {
        id: action.tempId,
        source: 'assistant',
        artifactRole: action.artifactRole || '',
        segmentIds: Array.isArray(action.segmentIds) ? [...action.segmentIds] : [],
      } : null),
    };
    const attachment = agentAttachment(action);
    if (attachment) node.uploadedFile = attachment;
    project.nodes.push(node);
    if (action.tempId) tempIdMap.set(action.tempId, node.id);
    const inputLinkResults = connectInputLinks(action.inputLinks, node.id);
    return {
      applied: true,
      createdNodeId: node.id,
      nodeId: node.id,
      taskId: null,
      inputLinkResults,
      outputSpec,
      resolvedConfig: config,
      referenceAttachmentCount: attachment ? 1 : 0,
      referenceAttachmentName: attachment?.name || '',
    };
  }

  const node = resolveNode(action.nodeId);
  if (!node) return { applied: false, error: 'Node not found' };
  const nextPrompt = action.prompt || node.prompt;
  const nextModel = String(action.model || node.model || '');
  if (!isModelForType(node.type, nextModel)) {
    return { applied: false, error: `模型 ${nextModel} 不属于 ${node.type}` };
  }
  const credentialStatus = getModelCredentialStatus(nextModel);
  if (!credentialStatus.available) return { applied: false, error: credentialStatus.message };
  const outputSpecPatch = generationOutputSpec(node.type, action.config, action.outputSpec);
  const nextOutputSpec = generationOutputSpec(
    node.type,
    {},
    { ...(node.outputSpec || {}), ...outputSpecPatch },
  );
  const nextConfig = compileGenerationNodeConfig(
    configSourceForOutputSpecUpdate(node.config || {}, action),
    getModelSchema(node.type, nextModel, String(action.config?.mode || node.config?.mode || '')).params,
    nextOutputSpec,
  );
  node.config = nextConfig;
  if (Object.keys(nextOutputSpec).length) node.outputSpec = nextOutputSpec;
  else delete node.outputSpec;
  if (action.title || action.name) node.title = action.title || action.name;
  node.prompt = nextPrompt;
  node.model = nextModel;
  if (action.recipeId) node.recipeId = String(action.recipeId);
  node.maxRetries = normalizedInteger(node.maxRetries, 2);
  node.timeoutMs = normalizedInteger(node.timeoutMs, DEFAULT_GENERATION_TIMEOUT_MS);
  if (['failed', 'timeout', 'error', 'cancelled'].includes(node.status)
    || (node.status === 'idle' && node.error)) {
    node.status = 'idle';
    node.progress = 0;
    node.retryCount = 0;
    node.error = '';
    node.lastAgentRepairAt = new Date().toISOString();
  }
  return {
    applied: true,
    nodeId: node.id,
    outputSpec: nextOutputSpec,
    resolvedConfig: nextConfig,
  };
}

// ── 自注册到 ActionRegistry ────────────────────────────────────────────────
