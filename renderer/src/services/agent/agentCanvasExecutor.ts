import { store as projectStore, touchProject } from '@/store/projectStore';
import { addCanvasEdge } from '@/store/canvasGraphStore';
import {
  findAgentBatch,
  listAgentBatches,
  recordAgentBatch,
} from '@/store/agentBatchStore';
import {
  canvasMutationFingerprint,
  claimAgentStep,
  completeClaimedAgentStep,
  createPendingAgentStep,
  findAgentStep,
  listAgentSteps,
  markAgentStep,
} from '@/store/agentStepStore';
import {
  findAgentEvaluation,
  listAgentEvaluations,
} from '@/store/agentEvaluationStore';
import {
  canRedoCanvas,
  canUndoCanvas,
  recordCanvasTransactionHistory,
} from '@/store/canvasHistoryStore';
import { settingsStore } from '@/store/settingsStore';
import { validateAgentActionShape } from '@/composables/agentActionValidator';
import { agentNodeAliasMaps, buildAgentCanvasSnapshot } from '@/services/agentCanvasSnapshot';
import { registerDefaultAgentActions } from '@/services/agent/registerDefaultActions';
import { validateAgentInputRole } from '@/services/agentInputRole';
import { getGenerationInputModes } from '@/domain/catalog/ModelCatalog';
import {
  defaultInputSlot,
  isSlotValidForMode,
  type GenerationInputMode,
  type GenerationInputSlot,
} from '@/domain/graph/GenerationInputContract';
import {
  defaultAgentNodePosition,
  numberFromAgentAction as numberFromAction,
  sizeFromAgentAction as sizeFromAction,
} from '@/services/agentNodeFactory';
import { layoutAgentNodes, placeAgentNodesIncrementally } from '@/services/agentLayoutService';
import {
  AgentProjectChangedError,
  createAgentProjectQueue,
} from '@/services/agentProjectQueue';
import { assertAgentProject, getAgentProjectIdentity, getAgentProjectKey } from '@/services/agentProjectIdentity';
import { dispatchAction } from '@/services/agent/actionRegistry';
import { recordPerformanceMetric } from '@/services/performanceMetrics';
import {
  captureCanvasTransaction,
  filterChangedCanvasTransaction,
} from '@/utils/canvasTransaction.mjs';
import type {
  AgentAction,
  AgentActionRequest,
  AgentActionResult,
  AgentBatchResult,
  AgentInputRole,
  AgentNode,
  JsonObject,
} from '@/services/agentTypes';

type LooseRecord = Record<string, any>;
const store: LooseRecord = projectStore as LooseRecord;
registerDefaultAgentActions();

// ── Helpers ─────────────────────────────────────────────────────────────────

const persistentTempIdMap = new Map<string, string>();
let persistentTempIdProjectKey = '';
const projectActionQueue = createAgentProjectQueue(getAgentProjectKey);

function ensurePersistentTempIdProject() {
  const key = getAgentProjectKey();
  if (persistentTempIdProjectKey !== key) {
    persistentTempIdMap.clear();
  }
  persistentTempIdProjectKey = key;
  for (const node of store.project.nodes || []) {
    const tempId = node.agentTempId || (
      node.agentPlan?.runId && node.agentPlan?.id
        ? `assistant:${node.agentPlan.runId}:${node.agentPlan.id}`
        : ''
    );
    if (tempId) persistentTempIdMap.set(String(tempId), node.id);
    // 助手计划 ID 是模型可长期使用的语义引用。Renderer 在动作落地前
    // 将它解析为真实 UUID，避免模型因画布扩大而反复读取全部节点。
    const semanticId = node.agentSemanticId
      || node.agentPlan?.semanticId
      || node.agentPlan?.id;
    if (semanticId && !persistentTempIdMap.has(String(semanticId))) {
      persistentTempIdMap.set(String(semanticId), node.id);
    }
  }
}

function prunePersistentTempIds() {
  ensurePersistentTempIdProject();
  const liveNodeIds = new Set<string>((store.project.nodes || []).map((node: AgentNode) => node.id));
  for (const [tempId, nodeId] of persistentTempIdMap.entries()) {
    if (!liveNodeIds.has(nodeId)) persistentTempIdMap.delete(tempId);
  }
}

function persistentTempIdSnapshot() {
  prunePersistentTempIds();
  const tempIdMap = Object.fromEntries(persistentTempIdMap.entries());
  const tempIdById: Record<string, string> = {};
  for (const [tempId, nodeId] of persistentTempIdMap.entries()) {
    tempIdById[nodeId] = tempId;
  }
  return { tempIdMap, tempIdById };
}

/** @param {number} value @param {number} fallback @returns {number} */
/**
 * 通过别名或 ID 解析节点对象。
 * @param {string} idOrAlias
 * @param {Map<string,string>} tempIdMap
 * @returns {Object|null}
 */
function resolveNode(idOrAlias: string, tempIdMap: Map<string, string>): AgentNode | null {
  const id = resolveNodeId(idOrAlias, tempIdMap);
  return store.project.nodes.find((node: AgentNode) => node.id === id) || null;
}

/**
 * 解析节点 ID：优先查 tempIdMap，其次解析稳定节点别名，最后原样返回。
 * @param {string|number} idOrAlias
 * @param {Map<string,string>} tempIdMap
 * @returns {string|null}
 */
function resolveNodeId(idOrAlias: string | number | null | undefined, tempIdMap: Map<string, string>): string | null {
  if (!idOrAlias) return null;
  const rawId = String(idOrAlias);
  if (tempIdMap.has(rawId)) return tempIdMap.get(rawId) || null;
  ensurePersistentTempIdProject();
  if (persistentTempIdMap.has(rawId)) return persistentTempIdMap.get(rawId) || null;
  const aliasId = agentNodeAliasMaps(store.project.nodes || []).aliasMap[rawId.toUpperCase()];
  if (aliasId) return aliasId;
  return rawId;
}

/**
 * 从 inputLinks 列表创建从源节点到目标节点的边。
 * @param {Array<{nodeId:string,role:string}>} inputLinks
 * @param {string} targetId
 * @param {Map<string,string>} tempIdMap
 */
function connectInputLinks(
  inputLinks: AgentAction['inputLinks'] = [],
  targetId: string,
  tempIdMap: Map<string, string>,
) {
  const results = [];
  for (const link of inputLinks || []) {
    const sourceId = resolveNodeId(link?.nodeId, tempIdMap);
    if (!sourceId) continue;
    const source = store.project.nodes.find((node: AgentNode) => node.id === sourceId);
    const target = store.project.nodes.find((node: AgentNode) => node.id === targetId);
    const requestedRole = String(link?.role || '') as AgentInputRole;
    const roleValidation = validateAgentInputRole(store.project, source, target, requestedRole);
    if (!roleValidation.valid) {
      results.push({ sourceId, targetId, applied: false, error: roleValidation.error });
      continue;
    }
    const role = roleValidation.role;
    const required = link?.required !== false;
    const modes = getGenerationInputModes(String(target?.model || ''));
    const activeMode = modes.find((item) => item.value === target?.inputMode) || modes[0];
    const roleSupported = role === 'textContext' || (role === 'referenceImage' && (activeMode?.maxImages || 0) > 0)
      || (role === 'inputVideo' && (activeMode?.maxVideos || 0) > 0)
      || (role === 'referenceAudio' && (activeMode?.maxAudios || 0) > 0);
    if (!roleSupported) {
      results.push({ sourceId, targetId, applied: false, error: `输入模式 ${activeMode?.label || target?.inputMode || '未设置'} 不支持 ${role}` });
      continue;
    }
    const occupied = (store.project.edges || []).filter((edge: any) => edge.target === targetId)
      .map((edge: any) => edge.data?.inputSlot).filter(Boolean) as GenerationInputSlot[];
    const slot = role === 'textContext' ? undefined : String(link?.slot || defaultInputSlot(
      (activeMode?.value || 'reference') as GenerationInputMode,
      role,
      occupied,
    )) as GenerationInputSlot;
    if (activeMode && slot && !isSlotValidForMode(activeMode.value, slot, role)) {
      results.push({ sourceId, targetId, applied: false, error: `槽位 ${slot} 不属于输入模式 ${activeMode.value}` });
      continue;
    }
    if (activeMode && role !== 'textContext') target.inputMode = activeMode.value;
    results.push({
      sourceId,
      targetId,
      role,
      required,
      ...addCanvasEdge(store.project, sourceId, targetId, {
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
      }),
    });
  }
  return results;
}

function defaultNodePosition(action: AgentAction = { type: '' }, tempIdMap = new Map<string, string>()) {
  const anchorNodeIds = (action.inputLinks || [])
    .map((link) => resolveNodeId(link?.nodeId, tempIdMap))
    .filter(Boolean);
  return defaultAgentNodePosition(store.project, { ...action, anchorNodeIds });
}

function canvasSummary() {
  return {
    nodeCount: store.project.nodes.length,
    edgeCount: store.project.edges.length,
    taskCount: store.project.tasks.length,
    selectedNodeIds: [...(store.selectedNodeIds || [])],
  };
}

const CREATE_NODE_ACTIONS = new Set([
  'create_gen_node',
  'create_note_node',
  'place_asset_on_canvas',
]);

const SINGLE_NODE_REF_KEYS: Record<string, string[]> = {
  update_gen_config: ['nodeId'],
  update_note_node: ['nodeId'],
  start_generation: ['nodeId'],
  delete_node: ['nodeId'],
  move_node: ['nodeId'],
};

function firstActionRef(action: AgentAction, keys: string[] = []) {
  return keys.map((key) => action?.[key]).find((value) => value !== undefined && value !== null && value !== '');
}

function preflightAgentActions(actions: AgentAction[] = [], seedTempIds = new Map<string, string>()) {
  const liveIds = new Set<string>((store.project.nodes || []).map((node: AgentNode) => node.id));
  const virtualTempIds = new Map<string, string>(seedTempIds);
  const virtualNodes = new Map<string, AgentNode>();
  const errors: Array<{ index: number; type: string; error: string }> = [];
  const resolveVirtualId = (value: unknown): string | null => {
    const raw = typeof value === 'string'
      ? value
      : value && typeof value === 'object' && 'nodeId' in value
        ? String(value.nodeId || '')
        : '';
    if (!raw) return null;
    if (virtualTempIds.has(raw)) return virtualTempIds.get(raw) || null;
    const resolved = resolveNodeId(raw, virtualTempIds);
    return resolved && liveIds.has(resolved) ? resolved : null;
  };
  const requireRef = (action: AgentAction, index: number, value: unknown, label: string) => {
    if (resolveVirtualId(value)) return true;
    errors.push({ index, type: action.type, error: `${label} 引用的节点不存在或已失效` });
    return false;
  };

  actions.forEach((action, index) => {
    if (CREATE_NODE_ACTIONS.has(action.type)) {
      const virtualId = `__agent_virtual_${index}`;
      liveIds.add(virtualId);
      virtualNodes.set(virtualId, {
        id: virtualId,
        type: String(action.nodeType || ''),
        prompt: String(action.prompt || ''),
        config: action.config || {},
      });
      if (action.tempId) {
        if (virtualTempIds.has(action.tempId)) {
          errors.push({ index, type: action.type, error: `tempId 重复：${action.tempId}` });
        } else {
          virtualTempIds.set(action.tempId, virtualId);
        }
      }
      (action.inputLinks || []).forEach((link) => requireRef(action, index, link, 'inputLinks'));
      if (action.type === 'create_gen_node') {
        if (!String(action.prompt || '').trim()) errors.push({ index, type: action.type, error: '生成节点必须提供非空顶层 prompt' });
      }
      if (action.type === 'create_gen_node' && Array.isArray(action.data?.attachments)) {
        action.data.attachments.forEach((file) => {
          if (!file?.path && !file?.filePath && !file?.url) {
            errors.push({ index, type: action.type, error: '参考附件缺少可读取的 path、filePath 或 url' });
          }
        });
      }
      return;
    }

    const singleKeys = SINGLE_NODE_REF_KEYS[action.type];
    if (singleKeys) requireRef(action, index, firstActionRef(action, singleKeys), singleKeys[0]);
    if (action.type === 'connect_nodes' || ((action.type === 'delete_edge' || action.type === 'toggle_edge') && !action.edgeId)) {
      requireRef(action, index, action.source, 'source');
      requireRef(action, index, action.target, 'target');
    }
    if (action.type === 'start_generation') {
      const nodeId = resolveVirtualId(action.nodeId);
      const node = (nodeId ? virtualNodes.get(nodeId) : null)
        || store.project.nodes.find((item: AgentNode) => item.id === nodeId);
      if (node && ['imageGeneration', 'videoGeneration', 'audioGeneration', 'textGeneration'].includes(node.type)) {
        const prompt = node.prompt || '';
        if (!String(prompt).trim()) errors.push({ index, type: action.type, error: '运行生成节点前必须提供 prompt' });
      }
    }
    if (action.type === 'delete_node') {
      const nodeId = resolveVirtualId(action.nodeId);
      if (nodeId) liveIds.delete(nodeId);
    }
  });

  return errors.length
    ? { valid: false, error: errors.map((item) => `actions[${item.index}]: ${item.error}`).join('; '), errors }
    : { valid: true, errors: [] };
}

function layoutNodeIds(nodeIds: string[] = [], options: LooseRecord = {}) {
  return layoutAgentNodes(store.project, nodeIds, options);
}

export function getAgentCanvasSnapshot(request: JsonObject = {}) {
  return buildAgentCanvasSnapshot({
    project: store.project,
    projectDir: store.projectDir,
    filePath: store.filePath,
    selection: {
      selectedNodeId: store.selectedNodeId,
      selectedNodeIds: store.selectedNodeIds,
    },
    route: store.route,
    tempIds: persistentTempIdSnapshot(),
    history: {
      canUndo: canUndoCanvas.value,
      canRedo: canRedoCanvas.value,
    },
    request,
  });
}

export function layoutAgentCanvasNodes(body: LooseRecord): Promise<AgentBatchResult> {
  try {
    assertAgentProject(body.projectKey, body.projectInstanceId, body.projectGeneration);
  } catch (error) {
    return Promise.resolve({
      success: false,
      complete: false,
      staleProject: true,
      error: error instanceof Error ? error.message : String(error),
      appliedCount: 0,
      skippedCount: 0,
      actionResults: [],
    });
  }
  return projectActionQueue.enqueue(async () => {
    assertAgentProject(body.projectKey, body.projectInstanceId, body.projectGeneration);
    const requested = Array.isArray(body.nodeIds) ? body.nodeIds : [];
    const nodeIds = [...new Set(requested.flatMap((value: unknown) => {
      const resolved = resolveNodeId(String(value || ''), new Map());
      return resolved ? [resolved] : [];
    }))];
    if (!nodeIds.length && body.scope !== 'all') {
      return {
        success: false,
        complete: false,
        error: '没有可整理的真实画布节点',
        appliedCount: 0,
        skippedCount: requested.length,
        actionResults: [],
      };
    }
    const before = captureCanvasTransaction(
      store.project,
      (store.project.nodes || []).map((node: AgentNode) => node.id),
      [],
      { selectedNodeId: store.selectedNodeId, selectedNodeIds: store.selectedNodeIds },
    );
    const result = layoutAgentNodes(store.project, nodeIds, {
      scope: body.scope,
      mode: body.mode,
      includeConnected: body.includeConnected,
      avoidCollisions: body.avoidCollisions,
      x: body.x,
      y: body.y,
      gapX: body.gapX,
      gapY: body.gapY,
    });
    if (result.movedCount > 0) {
      recordCanvasTransactionHistory(
        'Agent 整理画布',
        filterChangedCanvasTransaction(store.project, before),
      );
      touchProject();
    }
    return {
      success: result.movedCount > 0,
      complete: result.movedCount > 0,
      appliedCount: result.movedCount > 0 ? 1 : 0,
      skippedCount: 0,
      nodeIds: result.nodeIds,
      changedNodeIds: result.nodeIds,
      layoutResult: result,
      actionResults: [],
      error: result.movedCount > 0 ? '' : '节点已经处于目标布局',
    };
  }) as Promise<AgentBatchResult>;
}

type CanvasTransactionJournal = {
  nodes: Map<string, AgentNode | null>;
  edges: Map<string, LooseRecord | null>;
  selectedNodeId: string | null;
  selectedNodeIds: string[];
};

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createTransactionJournal(): CanvasTransactionJournal {
  return {
    nodes: new Map(),
    edges: new Map(),
    selectedNodeId: store.selectedNodeId || null,
    selectedNodeIds: [...(store.selectedNodeIds || [])],
  };
}

function captureJournalNode(journal: CanvasTransactionJournal, nodeId: string | null) {
  if (!nodeId || journal.nodes.has(nodeId)) return;
  const node = (store.project.nodes || []).find((item: AgentNode) => item.id === nodeId);
  journal.nodes.set(nodeId, node ? clonePlain(node) : null);
}

function captureJournalEdge(journal: CanvasTransactionJournal, edgeId: string | null) {
  if (!edgeId || journal.edges.has(edgeId)) return;
  const edge = (store.project.edges || []).find((item: LooseRecord) => item.id === edgeId);
  journal.edges.set(edgeId, edge ? clonePlain(edge) : null);
}

function captureActionState(
  journal: CanvasTransactionJournal,
  action: AgentAction,
  tempIdMap: Map<string, string>,
) {
  const nodeId = resolveNodeId(action.nodeId, tempIdMap);
  const sourceId = resolveNodeId(action.source, tempIdMap);
  const targetId = resolveNodeId(action.target, tempIdMap);
  captureJournalNode(journal, nodeId);
  if (action.type === 'connect_nodes') captureJournalNode(journal, targetId);
  if (action.edgeId) captureJournalEdge(journal, String(action.edgeId));
  for (const edge of store.project.edges || []) {
    const matchesEndpoints = sourceId && targetId && edge.source === sourceId && edge.target === targetId;
    const touchesDeletedNode = action.type === 'delete_node'
      && nodeId && (edge.source === nodeId || edge.target === nodeId);
    if (matchesEndpoints || touchesDeletedNode) captureJournalEdge(journal, edge.id);
  }
}

function transactionFromJournal(journal: CanvasTransactionJournal) {
  return filterChangedCanvasTransaction(store.project, {
    kind: 'canvas-transaction',
    nodes: [...journal.nodes].map(([id, value]) => ({ id, value })),
    edges: [...journal.edges].map(([id, value]) => ({ id, value })),
    selectedNodeId: journal.selectedNodeId,
    selectedNodeIds: journal.selectedNodeIds,
  });
}

// ── Action dispatcher ──────────────────────────────────────────────────────

/**
 * 将单个 agent action 应用到当前画布。
 * @param {Object} action
 * @param {Map<string,string>} tempIdMap
 * @returns {{ applied: boolean, createdNodeId?: string, taskId?: string, nodeId?: string, error?: string }}
 */
async function applyAgentAction(action: AgentAction, tempIdMap: Map<string, string>): Promise<AgentActionResult> {
  const type = action?.type;
  // tempId 在多轮和流式重放中保持幂等：相同临时 ID 已落地时直接复用，
  // 防止网络重试或模型修复批次时复制节点。
  if (CREATE_NODE_ACTIONS.has(type) && action.tempId) {
    ensurePersistentTempIdProject();
    const existingNodeId = persistentTempIdMap.get(String(action.tempId));
    const existingNode = existingNodeId
      ? store.project.nodes.find((node: AgentNode) => node.id === existingNodeId)
      : null;
    if (existingNode) {
      tempIdMap.set(action.tempId, existingNode.id);
      return {
        applied: true,
        deduplicated: true,
        nodeId: existingNode.id,
      };
    }
  }
  // 通过 ActionRegistry 分发（替代原来的 if/else 链）
  const agentCtx: Record<string, unknown> = {
    project: store.project,
    resolveNode: (value: string) => resolveNode(value, tempIdMap),
    resolveNodeId: (value: string | number | null | undefined) => resolveNodeId(value, tempIdMap),
    numberFromAction,
    sizeFromAction,
    defaultNodePosition: (value: AgentAction) => defaultNodePosition(value, tempIdMap),
    connectInputLinks: (links: AgentAction['inputLinks'], targetId: string) => connectInputLinks(links, targetId, tempIdMap),
    tempIdMap,
  };
  const registeredResult = await dispatchAction(action, agentCtx);
  if (registeredResult?.applied) return registeredResult;
  return registeredResult || { applied: false, error: `Action ${type} was not applied` };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * 批量执行外部 agent 发来的 action 列表。
 * 每个 action 按顺序应用到画布，tempId 映射在整个批次中共享。
 * @param {{ actions: Array }} body
 * @returns {{ success: boolean, tempIdMap: Object, createdNodeIds: string[], appliedCount: number, skippedCount: number }}
 */
async function executeAgentActionsNow(
  body: AgentActionRequest,
  queueMeta: LooseRecord = {},
): Promise<AgentBatchResult> {
  const actions = Array.isArray(body.actions) ? body.actions : [];
  if (!actions.length) {
    return {
      success: false,
      error: '没有可执行的画布动作',
      tempIdMap: {},
      createdNodeIds: [],
      changedNodeIds: [],
      startedTaskIds: [],
      actionResults: [],
      appliedCount: 0,
      skippedCount: 0,
      summary: canvasSummary(),
    };
  }

  // 确认策略由当前运行模式在工具层唯一决定，执行器不再读取额外开关。
  const needsConfirmation = body.requireConfirmation === true
    && body.confirmed !== true
    && actions.length > 0;
  if (needsConfirmation) {
    const step = createPendingAgentStep(store.project, body);
    touchProject();
    return {
      success: true,
      pending: true,
      step,
      message: '等待用户确认 Agent 操作',
    };
  }

  const tempIdMap = new Map<string, string>();
  const createdNodeIds: string[] = [];
  const changedNodeIds = new Set<string>();
  const changedEdgeIds = new Set<string>();
  const startedTaskIds: string[] = [];
  const actionResults: AgentActionResult[] = [];

  const projectKey = queueMeta.projectKey || getAgentProjectKey();
  const projectIdentity = getAgentProjectIdentity();
  if ((body.projectKey && body.projectKey !== projectKey)
    || (body.projectInstanceId && body.projectInstanceId !== projectIdentity.instanceId)
    || (body.projectGeneration != null && body.projectGeneration !== projectIdentity.generation)) {
    return {
      success: false,
      complete: false,
      staleProject: true,
      error: 'Agent 操作所属项目已经切换，已拒绝执行',
      appliedCount: 0,
      skippedCount: actions.length,
      actionResults: [],
    };
  }
  const transactionStartedAt = performance.now();
  const journal = createTransactionJournal();
  let appliedCount = 0;
  let skippedCount = 0;
  // Action 逐条提交，不做整批回滚。失败项会返回给模型局部修复，成功项保留。
  for (const [index, action] of actions.entries()) {
    assertAgentProject(body.projectKey || projectKey, body.projectInstanceId, body.projectGeneration);
    try {
      const shape = validateAgentActionShape(action);
      if (!shape.valid) {
        actionResults.push({ index, type: action?.type || '', applied: false, error: shape.error });
        skippedCount += 1;
        continue;
      }
      const preflight = preflightAgentActions([action], tempIdMap);
      if (!preflight.valid) {
        actionResults.push({ index, type: action?.type || '', applied: false, error: preflight.error });
        skippedCount += 1;
        continue;
      }
      captureActionState(journal, action, tempIdMap);
      const result = await applyAgentAction(action, tempIdMap);
      actionResults.push({
        index,
        type: action?.type || '',
        ...result,
      });
      if (result?.createdNodeId) {
        createdNodeIds.push(result.createdNodeId);
        changedNodeIds.add(result.createdNodeId);
        if (!journal.nodes.has(result.createdNodeId)) journal.nodes.set(result.createdNodeId, null);
      }
      if (result?.edgeId && !journal.edges.has(String(result.edgeId))) {
        journal.edges.set(String(result.edgeId), null);
      }
      if (result?.edgeId) changedEdgeIds.add(String(result.edgeId));
      if (action.edgeId && result?.applied) changedEdgeIds.add(String(action.edgeId));
      if (result?.nodeId) changedNodeIds.add(result.nodeId);
      if (typeof result?.taskId === 'string' && result.taskId) startedTaskIds.push(result.taskId);
      if (action?.nodeId) {
        const nodeId = resolveNodeId(action.nodeId, tempIdMap);
        if (nodeId) changedNodeIds.add(nodeId);
      }
      if (result?.applied) appliedCount += 1;
      else skippedCount += 1;
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      actionResults.push({ index, type: action?.type || '', applied: false, error });
      skippedCount += 1;
    }
  }
  let layoutResult = null;
  const shouldAutoLayout = body.autoLayout === true
    || (body.autoLayout == null && settingsStore.agentAutoLayout !== false)
    || (body.autoLayout !== false && createdNodeIds.length > 1 && settingsStore.agentAutoLayout !== false);
  if (shouldAutoLayout && createdNodeIds.length > 0) {
    if (createdNodeIds.length > 1) {
      for (const node of store.project.nodes || []) captureJournalNode(journal, node.id);
    }
    layoutResult = createdNodeIds.length === 1
      ? placeAgentNodesIncrementally(store.project, createdNodeIds)
      : layoutNodeIds(createdNodeIds, {
          ...((body.layout || {}) as LooseRecord),
          scope: 'workflow',
        });
  }
  const createdSet = new Set(createdNodeIds);
  for (const edge of store.project.edges || []) {
    if ((createdSet.has(edge.source) || createdSet.has(edge.target)) && !journal.edges.has(edge.id)) {
      journal.edges.set(edge.id, null);
    }
  }
  if (body.selectCreated !== false && createdNodeIds.length) {
    store.selectedNodeIds = [...createdNodeIds];
    store.selectedNodeId = createdNodeIds[0];
  }
  if (appliedCount > 0) {
    const transaction = transactionFromJournal(journal);
    recordCanvasTransactionHistory(body.title || body.name || 'Agent 画布操作', transaction);
    recordPerformanceMetric('agent.canvas.transaction', transactionStartedAt, {
      actionCount: actions.length,
      changedNodeCount: transaction.nodes.length,
      changedEdgeCount: transaction.edges.length,
      totalNodeCount: store.project.nodes.length,
      totalEdgeCount: store.project.edges.length,
    });
  }
  for (const [tempId, nodeId] of tempIdMap.entries()) {
    persistentTempIdMap.set(tempId, nodeId);
  }
  const persistedTempIds = persistentTempIdSnapshot();
  const shouldTrackBatch = body.trackBatch !== false && (
    Boolean(body.batchId)
    || createdNodeIds.length > 0
    || startedTaskIds.length > 0
    || appliedCount > 1
  );
  const agentBatch = shouldTrackBatch
    ? recordAgentBatch(store.project, {
        batchId: body.batchId,
        title: body.title || body.name,
        source: body.source,
        createdNodeIds,
        changedNodeIds: [...changedNodeIds],
        startedTaskIds,
        actionResults,
        summary: canvasSummary(),
        projectKey,
      })
    : null;
  touchProject();
  const complete = appliedCount > 0 && skippedCount === 0;
  return {
    success: appliedCount > 0,
    complete,
    partial: appliedCount > 0 && skippedCount > 0,
    error: skippedCount ? `${skippedCount} 个画布操作已跳过，其余 ${appliedCount} 个已应用` : '',
    tempIdMap: Object.fromEntries(tempIdMap.entries()),
    persistentTempIdMap: persistedTempIds.tempIdMap,
    tempIdById: persistedTempIds.tempIdById,
    createdNodeIds,
    changedNodeIds: [...changedNodeIds],
    edgeIds: [...changedEdgeIds],
    startedTaskIds,
    actionResults,
    layoutResult,
    agentBatch,
    appliedCount,
    skippedCount,
    summary: canvasSummary(),
    queue: queueMeta,
  };
}

/**
 * Serialize every action batch that reaches this renderer. This protects the
 * shared canvas, history and tempId map when assistant and external API
 * requests arrive at the same time.
 */
export function executeAgentActions(body: AgentActionRequest): Promise<AgentBatchResult> {
  try {
    assertAgentProject(body.projectKey, body.projectInstanceId, body.projectGeneration);
  } catch (error) {
    return Promise.resolve({
      success: false,
      complete: false,
      staleProject: true,
      error: error instanceof Error ? error.message : String(error),
      appliedCount: 0,
      skippedCount: Array.isArray(body.actions) ? body.actions.length : 0,
      actionResults: [],
    });
  }
  const run = projectActionQueue.enqueue(async (queueMeta) => {
    try {
      return await executeAgentActionsNow(body, queueMeta as unknown as LooseRecord);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      console.error('[Shotloom Agent] action batch failed', {
        sequence: queueMeta.sequence,
        title: body.title || '',
        error: error?.message || String(error),
      });
      throw error;
    }
  });
  return run.catch((error: unknown) => {
    if (!(error instanceof AgentProjectChangedError)) throw error;
    return {
      success: false,
      complete: false,
      staleProject: true,
      error: error.message,
      appliedCount: 0,
      skippedCount: Array.isArray(body.actions) ? body.actions.length : 0,
      actionResults: [],
      queue: { projectKey: error.projectKey },
    };
  });
}

export async function executeAgentListSteps(payload: LooseRecord = {}) {
  return {
    success: true,
    steps: listAgentSteps(store.project, payload.status || ''),
  };
}

export async function executeAgentApproveStep(payload: LooseRecord = {}) {
  const stepId = payload.stepId || payload.id;
  const project = store.project;
  const projectKey = getAgentProjectKey();
  const pendingStep = findAgentStep(project, stepId);
  if (!pendingStep) return { success: false, error: '确认步骤不存在' };
  if (pendingStep.canvasFingerprint
    && pendingStep.canvasFingerprint !== canvasMutationFingerprint(project)) {
    const error = '画布在等待确认期间已发生变化，请让助手基于最新画布重新规划';
    const stale = markAgentStep(project, stepId, 'stale', {
      staleAt: new Date().toISOString(),
      error,
    });
    if (stale.ok && getAgentProjectKey() === projectKey) touchProject();
    return { success: false, staleCanvas: true, error, step: stale.step };
  }
  const claim = claimAgentStep(project, stepId);
  if (!claim.ok || !claim.step) return { success: false, error: claim.error, step: claim.step };
  const step = claim.step;
  if (getAgentProjectKey() === projectKey) touchProject();
  const result = await executeAgentActions({
    ...(step.request || {}),
    confirmed: true,
    requireConfirmation: false,
    stepId: step.id,
  });
  const succeeded = result.success === true && result.skippedCount === 0;
  const mark = completeClaimedAgentStep(project, stepId, succeeded ? 'approved' : 'failed', {
    ...(succeeded ? { approvedAt: new Date().toISOString() } : { failedAt: new Date().toISOString() }),
    error: succeeded ? '' : result.error || 'Agent 操作未完整执行',
  });
  if (!mark.ok || !mark.step) return { success: false, error: mark.error, step: mark.step, result };
  mark.step.result = result;
  mark.step.batchId = result.agentBatch?.id || null;
  if (getAgentProjectKey() === projectKey) touchProject();
  return { success: succeeded, error: succeeded ? '' : mark.step.error, step: mark.step, result };
}

export async function executeAgentRejectStep(payload: LooseRecord = {}) {
  const mark = markAgentStep(store.project, payload.stepId || payload.id, 'rejected', {
    rejectedAt: new Date().toISOString(),
    reason: payload.reason || '',
  });
  if (mark.ok) touchProject();
  return mark.ok ? { success: true, step: mark.step } : { success: false, error: mark.error, step: mark.step };
}

export async function executeAgentGetBatch(payload: LooseRecord = {}) {
  const batch = findAgentBatch(store.project, payload.batchId || payload.id);
  return batch ? { success: true, batch } : { success: false, error: 'Batch not found' };
}

export async function executeAgentListBatches(_payload?: LooseRecord) {
  return { success: true, batches: listAgentBatches(store.project) };
}

export async function executeAgentListEvaluations(_payload?: LooseRecord) {
  return { success: true, evaluations: listAgentEvaluations(store.project) };
}

export async function executeAgentGetEvaluation(payload: LooseRecord = {}) {
  const evaluation = findAgentEvaluation(store.project, payload.evaluationId || payload.taskId || payload.nodeId || payload.id);
  return evaluation ? { success: true, evaluation } : { success: false, error: 'Evaluation not found' };
}
