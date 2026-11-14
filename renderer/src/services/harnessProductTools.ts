import { t } from '../i18n/index.ts';
import { registerCanvasTools } from '../agent/tools/canvasTools';
import { agentDefinition, CANVAS_AGENT_ID, DIRECTOR_AGENT_ID, EDITOR_AGENT_ID, type AgentId } from '../agent/agents/definitions';
import { registerCatalogTools } from '../agent/tools/catalogTools';
import { registerProductionPlanTools } from '../agent/tools/productionPlanTools';
import { registerTextDraftTools } from '../agent/tools/textTools';
import { registerVideoEditorTools } from '../agent/tools/videoEditorTools';
import { allAgentTools, hasAgentTool, prepareAgentToolCall, registerAgentTool } from '../agent/core/toolRegistry';
import type { AgentToolContext, AgentRunFacts, JsonObject } from '../agent/core/types';
import { getAgentProjectIdentity, assertAgentProject } from './agentProjectIdentity';
import { store, touchProject, saveProject, exportProjectPackage } from '../store/projectStore';
import { getAgentCanvasSnapshot } from './agent/agentCanvasExecutor';
import { activeProductionPlanSummary } from '../store/productionPlanStore';
import { canvasArtifactType, type AgentNode } from './agentTypes';
import { desktopApi } from './desktopApi';
import { supportsEditorTool, nativeToolUnlocked } from '../agent/core/openReelTools';
import { createNodeMediaCatalog, selectedNodeMedia, localMediaPath } from '../utils/nodeMedia';
import { inferMediaType } from '../utils/mediaType';
import { prepareVideoEditor, WORKSPACE_VIDEO_EDITOR_ID } from './videoEditorSession';
import { settingsStore } from '../store/settingsStore';
import { registerDirectorTools } from '../agent/tools/directorTools';
import { directorDeskAvailable, runDirectorDeskCommand } from './directorDeskAgentRuntime';
import { directorReferenceCatalog, resolveDirectorReference } from './agent/directorReferences';

export interface ProductBinding {
  sessionId: string; projectKey: string; conversationId: string;
  agentId: AgentId; nodeId?: string;
}
const bindings = new Map<string, { binding: ProductBinding; context: AgentToolContext }>();
const calls = new Map<string, Promise<unknown>>();

let editorSessionBinder: ((nodeId: string) => Promise<ProductBinding>) | undefined;
export function registerEditorSessionBinder(binder: (nodeId: string) => Promise<ProductBinding>) {
  editorSessionBinder = binder;
}

function register() {
  if (hasAgentTool('canvas_list_nodes')) return;
  registerCanvasTools(); registerCatalogTools(); registerProductionPlanTools();
  registerTextDraftTools(); registerVideoEditorTools(); registerDirectorTools();
  registerAgentTool({ id: 'canvas_prepare_editor', title: t('agent.role.editor'),
    description: '为剪辑委派打开并绑定真实剪辑工程。nodeId 指定现有剪辑节点；省略时打开独立剪辑工作台。不表示已完成剪辑；使用 delegate_editor 派发剪辑子 Agent。',
    effect: 'agent_state_write', inputSchema: { type: 'object', properties: { nodeId: { type: 'string' } }, additionalProperties: false },
    async execute(input, context) {
      const nodeId = String(input.nodeId || WORKSPACE_VIDEO_EDITOR_ID);
      if (nodeId !== WORKSPACE_VIDEO_EDITOR_ID && !store.project.nodes.some((node: AgentNode) => node.id === nodeId && node.type === 'clipStudio' && !node.archived)) {
        return { success: false, error: 'The requested clip workspace does not exist' };
      }
      if (!editorSessionBinder) return { success: false, error: 'Editor session binding is unavailable' };
      await prepareVideoEditor(nodeId, context);
      assertAgentProject(context.projectKey, context.projectInstanceId, context.projectGeneration);
      const binding = await editorSessionBinder(nodeId);
      assertAgentProject(context.projectKey, context.projectInstanceId, context.projectGeneration);
      return { success: true, binding };
    },
  });
  registerAgentTool({ id: 'project_snapshot', title: t('tool.title.project_snapshot'), description: '读取当前工程概览、节点摘要和当前会话制作计划。节点详情、素材和任务使用对应读取工具；不含聊天历史或媒体字节。', effect: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: (_input, context) => ({ ...getAgentCanvasSnapshot({ view: 'summary' }),
      productionPlan: activeProductionPlanSummary(context.conversationId) ?? null }) });
  registerAgentTool({ id: 'project_save', title: t('tool.title.project_save'), description: '保存当前工程，返回实际保存结果及路径。取消不算成功。', effect: 'project_write',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async execute() { const saved = await saveProject(); return { success: saved === true, applied: saved === true, path: store.filePath }; } });
  registerAgentTool({ id: 'project_export_package', title: t('tool.title.project_export_package'), description: '导出当前工程包，返回原生导出回执。', effect: 'project_write',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: () => exportProjectPackage(store.project) });
}
function contextFor(binding: Omit<ProductBinding, 'sessionId'>): AgentToolContext {
  const identity = getAgentProjectIdentity();
  assertAgentProject(binding.projectKey);
  const run: AgentRunFacts = { expectedCanvasFingerprint: '', activeProductionPlanId: '' };
  // Product handlers need facts and a scope; Harness owns all execution state.
  return {
    requestId: '', turnId: '', projectKey: binding.projectKey,
    projectInstanceId: identity.instanceId, projectGeneration: identity.generation,
    conversationId: binding.conversationId, agentId: binding.agentId, agentSessionId: '',
    signal: new AbortController().signal, loadedSkillIds: new Set(), attachments: [],
    capabilities: { nodeExecution: settingsStore.agentCanRunNodes === true }, run,
    emit: () => {},
  };
}
export function productToolCatalog(binding: Omit<ProductBinding, 'sessionId'>) {
  register();
  const allowed = agentDefinition(binding.agentId);
  const context = contextFor(binding);
  return allAgentTools().filter(tool => allowed.tools.includes(tool.id) && allowed.effects.includes(tool.effect)
    && supportsEditorTool(tool.id, desktopApi.platform !== 'browser' && Boolean(store.projectDir))
    // 原生工具 309 个，只下发核心集；其余等 editor_find_tools 在本会话解锁后重新绑定。
    // 只作用于 openreel_ 前缀，其他工具的可见性判定保持原样。
    && (!tool.id.startsWith('openreel_') || nativeToolUnlocked(tool.id.slice('openreel_'.length), binding.conversationId))).map(tool => ({
    name: tool.id, title: tool.title, description: tool.description, parameters: tool.resolveInputSchema?.(context) || tool.inputSchema,
    roles: [binding.agentId], effect: tool.effect === 'read' ? 'read' : tool.effect === 'media_generation' ? 'generation' : 'write',
    approvalRequired: tool.approvalRequired === true,
  }));
}
export function bindProductSession(binding: ProductBinding) {
  bindings.set(binding.sessionId, { binding, context: contextFor(binding) });
}

/** Native credential and binding are checked before this product boundary. */
export async function executeProductRequest(request: {
  requestId: string; binding: ProductBinding; toolName: string; input: JsonObject;
  phase?: string; approvedByHarness?: boolean; authorizedByFullAccess?: boolean;
}): Promise<unknown> {
  const registered = bindings.get(request.binding?.sessionId);
  if (!registered || (['sessionId', 'projectKey', 'conversationId', 'agentId', 'nodeId'] as const).some(key => registered.binding[key] !== request.binding[key])) throw new Error(t('agent.bindingUnknown'));
  const { binding, context } = registered;
  const callContext = { ...context, requestId: request.requestId, turnId: request.requestId, agentSessionId: binding.sessionId };
  assertAgentProject(context.projectKey, context.projectInstanceId, context.projectGeneration);
  const conversation = store.project.harnessSessions?.find((item: { id?: string }) => item.id === binding.conversationId);
  if (!conversation || conversation.agentId !== binding.agentId) throw new Error(t('agent.bindingChanged'));
  if (binding.nodeId) {
    const node = binding.agentId === EDITOR_AGENT_ID && binding.nodeId === WORKSPACE_VIDEO_EDITOR_ID
      ? store.project.videoEditorSession : store.project.nodes.find((item: { id: string }) => item.id === binding.nodeId);
    const boundNodeId = binding.agentId === EDITOR_AGENT_ID ? conversation.editorNodeId
      : binding.agentId === DIRECTOR_AGENT_ID ? conversation.directorNodeId : conversation.textNodeId;
    if (!node || boundNodeId !== binding.nodeId) throw new Error(t('agent.bindingNodeMissing'));
  }
  context.capabilities.nodeExecution = settingsStore.agentCanRunNodes === true;
  if (!supportsEditorTool(request.toolName, desktopApi.platform !== 'browser' && Boolean(store.projectDir))) {
    throw new Error(t('agent.toolUnavailable', { name: request.toolName }));
  }
  const prepared = prepareAgentToolCall(request.toolName, JSON.stringify(request.input), callContext);
  const effect = prepared.definition.resolveEffect?.(prepared.input, callContext) ?? prepared.definition.effect;
  if (effect === 'media_generation' && !context.capabilities.nodeExecution) return { success: false, code: 'NODE_EXECUTION_DISABLED', applied: false };
  const approvalRequired = prepared.definition.approvalRequired === true ||
    (settingsStore.agentApprovalPolicy !== 'never' && ['project_write', 'canvas_write', 'media_generation'].includes(effect));
  if (request.phase === 'authorize') return { success: true, approvalRequired };
  if (approvalRequired && request.approvedByHarness !== true && request.authorizedByFullAccess !== true) return { success: false, code: 'APPROVAL_REQUIRED', applied: false };
  const existing = calls.get(request.requestId);
  if (existing) return existing;
  const operation = (async () => {
    const result = await prepared.definition.execute(prepared.input, callContext);
    assertAgentProject(context.projectKey, context.projectInstanceId, context.projectGeneration);
    if (effect !== 'read') touchProject();
    const data = result && typeof result === 'object' ? result as Record<string, unknown> : {};
    const ids = [...(Array.isArray(data.nodeIds) ? data.nodeIds : []), data.nodeId].filter((id): id is string => typeof id === 'string' && store.project.nodes.some((node: { id: string }) => node.id === id));
    const taskIds = [...(Array.isArray(data.taskIds) ? data.taskIds : []), data.taskId].filter((id): id is string => typeof id === 'string' && store.project.tasks?.some((task: { id: string }) => task.id === id));
    return { requestId: request.requestId, sessionId: binding.sessionId, toolName: request.toolName, references: { nodeIds: [...new Set(ids)], taskIds: [...new Set(taskIds)] }, result };
  })();
  calls.set(request.requestId, operation);
  // Rejections remain replayable too: repeating a call must not repeat a write.
  return operation;
}

export function productToolCount() { register(); return allAgentTools().length; }

/** Composer references use the same live project/session/role fence as tools. */
export async function readHarnessCanvasReference(sessionId: string, nodeId?: string, withImage = false) {
  const registered = bindings.get(sessionId);
  if (!registered || ![CANVAS_AGENT_ID, EDITOR_AGENT_ID, DIRECTOR_AGENT_ID].includes(registered.binding.agentId)) throw new Error(t('agent.reference.forbidden'));
  const { binding, context } = registered;
  assertAgentProject(context.projectKey, context.projectInstanceId, context.projectGeneration);
  const conversation = store.project.harnessSessions?.find((item: { id: string; agentId: string }) => item.id === binding.conversationId);
  if (!conversation || conversation.agentId !== binding.agentId) throw new Error(t('agent.reference.expired'));
  const director = binding.agentId === DIRECTOR_AGENT_ID;
  const directorState = async () => {
    if (!directorDeskAvailable()) throw new Error('当前导演台场景不可用');
    const [snapshot, catalog] = await Promise.all([
      runDirectorDeskCommand('snapshot'), runDirectorDeskCommand('catalog'),
    ]);
    assertAgentProject(context.projectKey, context.projectInstanceId, context.projectGeneration);
    return { snapshot, catalog };
  };
  if (director && nodeId?.startsWith('director:')) {
    const { snapshot, catalog } = await directorState();
    return resolveDirectorReference(nodeId, snapshot, catalog);
  }
  const nodes: AgentNode[] = store.project.nodes.filter((node: AgentNode) => !node.archived);
  const mediaCatalog = createNodeMediaCatalog(store.project);
  const describe = (node: typeof nodes[number]) => {
    const media = mediaCatalog.selected(node);
    const identity = JSON.stringify([media.id, media.filePath, media.path, media.url, media.updatedAt, media.modifiedAt, media.size, node.updatedAt, node.selectedOutputNodeId]);
    let revision = 2166136261;
    for (let index = 0; index < identity.length; index++) revision = Math.imul(revision ^ identity.charCodeAt(index), 16777619);
    return { id: node.id, label: String(media.fileName || media.name || node.title || node.type), type: node.type,
      mediaType: ({ imageGeneration: 'image', videoGeneration: 'video', audioGeneration: 'audio', textGeneration: 'text' } as Record<string, string>)[node.type] || inferMediaType(media), artifactType: canvasArtifactType(node.artifactType),
      mediaRevision: `${identity.length}:${(revision >>> 0).toString(16)}` };
  };
  if (nodeId === undefined) {
    const canvasNodes = nodes.map(node => ({ ...describe(node), referenceScope: 'canvas' as const }));
    if (!director) return { nodes: canvasNodes };
    try {
      const { snapshot, catalog } = await directorState();
      return { nodes: [...directorReferenceCatalog(snapshot, catalog), ...canvasNodes] };
    } catch {
      assertAgentProject(context.projectKey, context.projectInstanceId, context.projectGeneration);
      return { nodes: canvasNodes };
    }
  }
  const node = nodes.find(item => item.id === nodeId);
  if (!node) throw new Error(t('agent.reference.unavailable'));
  const invoke = async (toolName: string, input: JsonObject) => {
    const receipt = await executeProductRequest({ requestId: crypto.randomUUID(), binding, toolName, input });
    return (receipt as { result: Record<string, unknown> }).result;
  };
  const snapshot = await invoke('canvas_get_node', { nodeId });
  const descriptor = describe(node);
  let images: unknown = [];
  if (withImage && descriptor.mediaType === 'image') {
    const result = await invoke('canvas_media_image', { nodeIds: [nodeId] });
    if (result.success !== true) throw new Error(String(result.error || t('agent.reference.imageFailed')));
    images = result.__toolAttachments;
  }
  let duration: number | undefined;
  if (withImage && descriptor.mediaType === 'video') {
    const result = await invoke('canvas_media_frame', { nodeId, timesSec: [0] });
    if (result.success !== true) throw new Error(String(result.error || t('agent.reference.frameFailed')));
    images = result.__toolAttachments;
    const media = selectedNodeMedia(node, store.project) || node;
    const source = localMediaPath(media);
    if (source) {
      try { const probe = await desktopApi.file.probeMedia(source); if (Number.isFinite(probe?.duration) && Number(probe.duration) > 0) duration = Number(probe.duration); }
      catch { /* Unknown duration stays absent; never invent a clock. */ }
    }
  }
  // Recheck after asynchronous file I/O; never return facts from an old project.
  assertAgentProject(context.projectKey, context.projectInstanceId, context.projectGeneration);
  if (!store.project.nodes.some((item: AgentNode) => item.id === nodeId && !item.archived)) throw new Error(t('agent.reference.deleted'));
  return { node: { ...descriptor, ...(node.directorContext ? { directorContext: node.directorContext } : {}), ...(duration !== undefined ? { duration } : {}) }, snapshot: { revision: snapshot.revision, nodes: snapshot.nodes, edges: snapshot.edges, tasks: snapshot.tasks }, images };
}
