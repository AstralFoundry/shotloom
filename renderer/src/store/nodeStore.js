import { computed } from '@/store/domainReactivity';
import { store, touchProject } from '@/store/projectStore';
import { showToast } from '@/composables/useToast';
import { uid } from '@/utils/format';
import { addCanvasEdge, deleteCanvasNodeData } from '@/store/canvasGraphStore';
import { cancelNode } from '@/store/taskStore';
import { compileGenerationNodeConfig, generationNodeConfig } from '@/domain/graph/GenerationNodeContract';
import { getModelSchema } from '@/domain/catalog/ModelCatalog';
import { resolveProjectDefaultModel } from '@/utils/projectModelDefaults.mjs';
import { defaultCanvasNodeDimensions } from '@/domain/graph/CanvasNodeDimensions.ts';

export const generationNodeTypes = ['imageGeneration', 'videoGeneration', 'audioGeneration', 'textGeneration'];
export const utilityNodeTypes = ['threeDDirector', 'board', 'note'];
export const canvasNodeTypes = [...generationNodeTypes, ...utilityNodeTypes];
export const DEFAULT_GENERATION_TIMEOUT_MS = 900000;

// ── Computed ────────────────────────────────────────────────────────────────

/**
 * 当前选中的画布节点。
 * @type {{ readonly value: Object|null }}
 */
export const selectedNode = computed(() => (
  store.project.nodes.find((node) => node.id === store.selectedNodeId) || null
));

export const selectedNodes = computed(() => {
  const ids = Array.isArray(store.selectedNodeIds) && store.selectedNodeIds.length
    ? store.selectedNodeIds
    : store.selectedNodeId ? [store.selectedNodeId] : [];
  const idSet = new Set(ids);
  return store.project.nodes.filter((node) => idSet.has(node.id));
});

// ── Node type helpers ───────────────────────────────────────────────────────

/**
 * 将节点类型标识映射为中文标签。
 * @param {string} type - 节点类型标识
 * @returns {string}
 */
export function nodeTypeLabel(type) {
  return {
    imageGeneration: '图片生成',
    videoGeneration: '视频生成',
    audioGeneration: '音频生成',
    textGeneration: '文本生成',
    resource: '资源节点',
    board: '画板',
    note: '便签',
    threeDDirector: '3D导演台',
  }[type] || type;
}

/**
 * 生成节点的默认配置。
 * @returns {Object}
 */
export function defaultGenerationConfig(type = 'imageGeneration', model = '') {
  return compileGenerationNodeConfig({}, getModelSchema(type, model).params);
}

/**
 * 确保生成节点拥有完整的配置对象（就地补全缺失字段）。
 * @param {Object} node - 节点对象
 * @returns {Object|null} 补全后的 config 对象，非生成节点返回 null
 */
export function ensureGenerationConfig(node) {
  if (!node || !generationNodeTypes.includes(node.type)) return null;
  node.config = compileGenerationNodeConfig(
    generationNodeConfig(node.config),
    getModelSchema(node.type, node.model).params,
    node.outputSpec,
  );
  return node.config;
}

// ── Node CRUD ───────────────────────────────────────────────────────────────

/**
 * 在画布上创建一个新节点。
 * @param {string} [type='imageGeneration'] - 节点类型
 * @returns {Object} 创建的节点对象
 */
export function addNode(type = 'imageGeneration') {
  if (!canvasNodeTypes.includes(type)) type = 'imageGeneration';
  const isGenerationNode = generationNodeTypes.includes(type);
  const isDirector = type === 'threeDDirector';
  const isBoard = type === 'board';
  const count = store.project.nodes.filter((node) => canvasNodeTypes.includes(node.type)).length;
  const dimensions = defaultCanvasNodeDimensions(type);
  const node = {
    id: uid(),
    type,
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
    node.model = resolveProjectDefaultModel(store.project.settings, type);
    node.config = defaultGenerationConfig(type, node.model);
  }
  if (isBoard) {
    node.boardText = '';
    node.boardData = { strokes: [], texts: [], images: [], crop: null };
  }
  if (isDirector) {
    node.directorData = {};
  }
  store.project.nodes.push(node);
  store.selectedNodeId = node.id;
  store.selectedNodeIds = [node.id];
  store.route = 'creation';
  touchProject();
  return node;
}

// ── Selection & connection ──────────────────────────────────────────────────

/**
 * 选择画布节点。如果当前处于连接模式且目标不同于源节点，
 * 则自动创建一条从源到目标的边。
 * @param {string} nodeId
 */
export function setSelectedNodeIds(nodeIds = []) {
  const validIds = nodeIds.filter((id) => store.project.nodes.some((node) => node.id === id));
  store.selectedNodeIds = [...new Set(validIds)];
  store.selectedNodeId = store.selectedNodeIds[0] || null;
}

export function selectNode(nodeId, options = {}) {
  if (store.connectFromId && store.connectFromId !== nodeId) {
    const source = store.project.nodes.find((node) => node.id === store.connectFromId);
    const target = store.project.nodes.find((node) => node.id === nodeId);
    if (!source || !target || !generationNodeTypes.includes(source.type) || !generationNodeTypes.includes(target.type)) {
      store.connectFromId = null;
      store.selectedNodeId = nodeId;
      store.selectedNodeIds = [nodeId];
      return;
    }
    const result = addCanvasEdge(store.project, store.connectFromId, nodeId, { touch: false });
    if (!result.ok) showToast(result.error || '连线失败');
    store.connectFromId = null;
    touchProject();
  }
  if (options.additive) {
    const next = new Set(store.selectedNodeIds?.length ? store.selectedNodeIds : store.selectedNodeId ? [store.selectedNodeId] : []);
    if (next.has(nodeId)) next.delete(nodeId);
    else next.add(nodeId);
    setSelectedNodeIds([...next]);
  } else {
    setSelectedNodeIds([nodeId]);
  }
}

/**
 * 进入连接模式：当前选中节点成为源节点，等待选取目标。
 */
export function startConnect() {
  if (!store.selectedNodeId) {
    showToast('先选择源节点');
    return;
  }
  store.connectFromId = store.selectedNodeId;
  showToast('请选择目标节点');
}

/**
 * 删除当前选中节点及其关联的所有边。
 */
export function deleteSelectedNode() {
  if (!store.selectedNodeId) return;
  deleteNodeById(store.selectedNodeId);
}

export function deleteNodeById(nodeId, { touch = true } = {}) {
  if (!nodeId || !store.project.nodes.some((node) => node.id === nodeId)) return false;
  cancelNode(nodeId);
  return deleteCanvasNodeData(nodeId, { touch });
}

export function deleteSelectedNodes() {
  const ids = selectedNodes.value.map((node) => node.id);
  if (!ids.length) return;
  ids.forEach((id) => deleteNodeById(id, { touch: false }));
  store.selectedNodeIds = [];
  store.selectedNodeId = null;
  touchProject();
}
