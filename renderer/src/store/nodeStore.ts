import { t } from '../i18n/index.ts';
import { GENERATION_NODE_TYPES, UTILITY_NODE_TYPES, CANVAS_NODE_TYPES } from '@/domain/graph/NodeType';
import { computed } from '@/store/domainReactivity';
import { projectOperationBlockReason } from '@/services/projectOperationGuards';
import { store, touchProject } from '@/store/projectStore';
import { showToast } from '@/store/notificationStore';
import { uid } from '@/utils/format';
import { addCanvasEdge, deleteCanvasNodeData, type CanvasProjectLike } from '@/store/canvasGraphStore';
import { cancelNode } from '@/store/taskStore';
import { compileGenerationNodeConfig, generationNodeConfig } from '@/domain/graph/GenerationNodeContract';
import { getGenerationInputModes, getModelSchema } from '@/domain/catalog/ModelCatalog';
import { defaultInputSlot, type GenerationInputSlot } from '@/domain/graph/GenerationInputContract';
import { validateAgentInputRole } from '@/services/agentInputRole';
import type { AgentNode, AgentProject } from '@/services/agentTypes';
import { resolveProjectDefaultModel } from '@/utils/projectModelDefaults.ts';
import { getAvailableModelIdsByType, getModelCredentialStatus } from '@/store/settingsStore';
import { defaultCanvasNodeDimensions } from '@/domain/graph/CanvasNodeDimensions.ts';

// projectStore → taskStore → 本模块 → projectStore 是循环引用：本模块求值时它的 `store`
// 绑定可能还在 TDZ 里，所以只能在函数调用时读取，不能在模块作用域快照一份。
// `project` 在 projectStore 里是未类型化的对象，回调参数因此需要显式标注。
type EdgeLike = {
  id?: string;
  source?: string;
  target?: string;
  kind?: string;
  data?: { inputRole?: string; inputSlot?: GenerationInputSlot; [key: string]: unknown };
  [key: string]: unknown;
};

type NodeLike = {
  id?: string;
  type?: string;
  model?: string;
  inputMode?: string | undefined;
  config?: unknown;
  outputSpec?: unknown;
  [key: string]: unknown;
};

export const generationNodeTypes: readonly string[] = GENERATION_NODE_TYPES;
export const utilityNodeTypes: readonly string[] = UTILITY_NODE_TYPES;
export const canvasNodeTypes: readonly string[] = CANVAS_NODE_TYPES;
export const DEFAULT_GENERATION_TIMEOUT_MS = 900000;

// ── Computed ────────────────────────────────────────────────────────────────

/** 当前选中的画布节点。 */
export const selectedNode = computed(() => (
  store.project.nodes.find((node: NodeLike) => node.id === store.selectedNodeId) || null
));

export const selectedNodes = computed(() => {
  const ids = Array.isArray(store.selectedNodeIds) && store.selectedNodeIds.length
    ? store.selectedNodeIds
    : store.selectedNodeId ? [store.selectedNodeId] : [];
  const idSet = new Set(ids);
  return store.project.nodes.filter((node: NodeLike) => idSet.has(node.id || ''));
});

// ── Node type helpers ───────────────────────────────────────────────────────

const NODE_TYPE_LABELS: Record<string, string> = {
  canvasSection: t('canvas.section.default'),
  imageGeneration: t("ui.taskAdapter.imageGeneration.1f6a9dab"),
  videoGeneration: t("ui.taskAdapter.videoGeneration.19978a8d"),
  audioGeneration: t("ui.taskAdapter.audioGeneration.d371481a"),
  textGeneration: t("catalog.label.9612898b53"),
  resource: t("ui.CanvasNodes.text.64586ce4"),
  threeDDirector: t("ui.navigation.label.1386e28f"),
  clipStudio: t("ui.videoEditorActions.text.801f1d23"),
};

/** 将节点类型标识映射为中文标签。 */
export function nodeTypeLabel(type: string): string {
  return NODE_TYPE_LABELS[type] || type;
}

/** 生成节点的默认配置。 */
export function defaultGenerationConfig(type = 'imageGeneration', model = ''): Record<string, unknown> {
  return compileGenerationNodeConfig({}, getModelSchema(type, model).params);
}

/**
 * 确保生成节点拥有完整的配置对象（就地补全缺失字段）。
 * @returns 补全后的 config 对象，非生成节点返回 null
 */
export function ensureGenerationConfig(node: NodeLike | null | undefined): Record<string, unknown> | null {
  if (!node || !generationNodeTypes.includes(String(node.type))) return null;
  node.config = compileGenerationNodeConfig(
    generationNodeConfig(node.config),
    getModelSchema(node.type, node.model).params,
    node.outputSpec,
  );
  return node.config as Record<string, unknown>;
}

// ── Node CRUD ───────────────────────────────────────────────────────────────

/** 在画布上创建一个新节点。 */
export function addNode(type = 'imageGeneration'): NodeLike {
  if (!canvasNodeTypes.includes(type)) type = 'imageGeneration';
  const isGenerationNode = generationNodeTypes.includes(type);
  const isDirector = type === 'threeDDirector';
  const count = store.project.nodes.filter((node: NodeLike) => canvasNodeTypes.includes(String(node.type))).length;
  const dimensions = defaultCanvasNodeDimensions(type);
  const node: NodeLike = {
    id: uid(),
    type,
    artifactType: 'other',
    title: nodeTypeLabel(type),
    content: '',
    canvasWidth: dimensions.width,
    canvasHeight: dimensions.height,
    status: 'idle',
    progress: 0,
    x: 80 + (count % 4) * 270,
    y: 80 + Math.floor(count / 4) * 180,
    createdAt: new Date().toISOString(),
  };
  if (isGenerationNode) {
    node.prompt = '';
    const preferred = resolveProjectDefaultModel(store.project.settings, type);
    // 默认模型可能来自尚未配置凭据的厂商（目录默认值就是 OpenAI 系）。
    // 优先用工程默认；它不可用时退到同类型第一个已配置模型，避免新建节点
    // 直接落在一个没有 Key 的模型上。
    const preferredAvailable = Boolean(preferred) && getModelCredentialStatus(preferred).available;
    node.model = preferredAvailable
      ? preferred
      : (getAvailableModelIdsByType(type)[0] || preferred);
    const defaultInputMode = getGenerationInputModes(node.model || '')[0]?.value;
    if (defaultInputMode) node.inputMode = defaultInputMode;
    node.config = defaultGenerationConfig(type, node.model);
  }
  if (isDirector) {
    node.directorData = {};
  }
  store.project.nodes.push(node);
  store.selectedNodeId = node.id || '';
  store.selectedNodeIds = [node.id || ''];
  store.route = 'creation';
  touchProject();
  return node;
}

// ── Selection & connection ──────────────────────────────────────────────────

/**
 * 选择画布节点。如果当前处于连接模式且目标不同于源节点，
 * 则自动创建一条从源到目标的边。
 */
export function setSelectedNodeIds(nodeIds: string[] = []): void {
  const validIds = nodeIds.filter((id) => store.project.nodes.some((node: NodeLike) => node.id === id));
  const selected = [...new Set(validIds)];
  store.selectedNodeIds = selected;
  store.selectedNodeId = selected[0] || null;
}

export function selectNode(nodeId: string, options: { additive?: boolean } = {}): void {
  if (store.connectFromId && store.connectFromId !== nodeId) {
    const source = store.project.nodes.find((node: NodeLike) => node.id === store.connectFromId);
    const target = store.project.nodes.find((node: NodeLike) => node.id === nodeId);
    if (!source || !target || !generationNodeTypes.includes(String(source.type)) || !generationNodeTypes.includes(String(target.type))) {
      store.connectFromId = null;
      store.selectedNodeId = nodeId;
      store.selectedNodeIds = [nodeId];
      return;
    }
    const validation = validateAgentInputRole(store.project as AgentProject, source as AgentNode, target as AgentNode, 'auto');
    const modes = getGenerationInputModes(target.model || '');
    const activeMode = modes.find((item) => item.value === target.inputMode) || modes[0];
    if (activeMode && validation.role !== 'textContext') target.inputMode = activeMode.value;
    const occupied = store.project.edges
      .filter((edge: EdgeLike) => edge.target === nodeId)
      .map((edge: EdgeLike) => edge.data?.inputSlot)
      .filter(Boolean) as GenerationInputSlot[];
    const inputSlot = validation.role === 'textContext' ? '' : defaultInputSlot(
      activeMode?.value || 'reference', validation.role, occupied,
    );
    const result = validation.valid ? addCanvasEdge(store.project as CanvasProjectLike, store.connectFromId, nodeId, {
      touch: false,
      edge: { kind: 'typed-input', data: { inputRole: validation.role, ...(inputSlot ? { inputSlot } : {}), required: true, creationSource: 'manual' } },
    }) : { ok: false, error: validation.error };
    if (!result.ok) showToast(result.error || t("ui.nodeStore.text.7c25cd80"));
    store.connectFromId = null;
    touchProject();
  }
  if (options.additive) {
    const next = new Set<string>(store.selectedNodeIds?.length ? store.selectedNodeIds : store.selectedNodeId ? [store.selectedNodeId] : []);
    if (next.has(nodeId)) next.delete(nodeId);
    else next.add(nodeId);
    setSelectedNodeIds([...next]);
  } else {
    setSelectedNodeIds([nodeId]);
  }
}

/** 进入连接模式：当前选中节点成为源节点，等待选取目标。 */
export function startConnect(): void {
  if (!store.selectedNodeId) {
    showToast(t("ui.nodeStore.text.191c1344"));
    return;
  }
  store.connectFromId = store.selectedNodeId;
  showToast(t("ui.nodeStore.text.d333376c"));
}

/** 删除当前选中节点及其关联的所有边。 */
export function deleteSelectedNode(): void {
  if (!store.selectedNodeId) return;
  deleteNodeById(store.selectedNodeId);
}

export function deleteNodeById(nodeId: string, { touch = true }: { touch?: boolean } = {}): boolean {
  if (!nodeId || !store.project.nodes.some((node: NodeLike) => node.id === nodeId)) return false;
  const reason = projectOperationBlockReason(store.project, [nodeId]);
  if (reason) { showToast(reason); return false; }
  cancelNode(nodeId);
  return deleteCanvasNodeData(nodeId, { touch });
}

export function deleteSelectedNodes(): void {
  const ids = selectedNodes.value.map((node: NodeLike) => node.id || '');
  if (!ids.length) return;
  const reason = projectOperationBlockReason(store.project, ids);
  if (reason) { showToast(reason); return; }
  ids.forEach((id: string) => deleteNodeById(id, { touch: false }));
  store.selectedNodeIds = [];
  store.selectedNodeId = null;
  touchProject();
}
