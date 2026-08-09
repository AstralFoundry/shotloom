import { executeAgentActions, getAgentCanvasSnapshot } from '@/services/agent/agentCanvasExecutor';
import type { AgentActionRequest, JsonObject } from '@/services/agentTypes';
import { registerAgentTool } from '../core/toolRegistry';
import type { AgentToolContext, CanvasActionToolInput } from '../core/types';
import { assertAgentProject } from '@/services/agentProjectIdentity';
import { agentNodeAliasMaps } from '@/services/agentCanvasSnapshot';
import { store as projectStore } from '@/store/projectStore';
import { settingsStore } from '@/store/settingsStore';
import { setSelectedNodeIds } from '@/store/nodeStore';
import { redoCanvas, undoCanvas } from '@/store/canvasHistoryStore';
import actionContract from '@/config/agent-action-contract.json';
import { validateAgentActionShape } from '@/composables/agentActionValidator';
import { buildAgentActionSchema, normalizeAgentActions } from './agentProtocol';
import { MODEL_AGENT_CANVAS_ACTION_TYPES } from '@/utils/agentCanvasActionTypes.mjs';
import { canvasMutationFingerprint } from '@/utils/canvasMutationFingerprint.mjs';

const generationActions = new Set(['start_generation']);
// 模型只看到这份白名单中的 Action。完整存储契约可以包含内部动作，
// 但不会因为存在于 JSON 文件中就自动暴露给 Agent。
const canvasActionSchema = buildAgentActionSchema(actionContract, {
  allowedTypes: MODEL_AGENT_CANVAS_ACTION_TYPES,
});
const canvasActionSchemaWithoutGeneration = buildAgentActionSchema(actionContract, {
  allowedTypes: MODEL_AGENT_CANVAS_ACTION_TYPES.filter((type) => !generationActions.has(type)),
});

function assertContextProject(context: AgentToolContext) {
  return assertAgentProject(context.projectKey, context.projectInstanceId, context.projectGeneration);
}

function assertCanvasWriteFence(context: AgentToolContext) {
  assertContextProject(context);
  const expected = String(context.state.get('expectedCanvasFingerprint') || '');
  const current = canvasMutationFingerprint(projectStore.project);
  if (expected && expected !== current) {
    const error = new Error('画布在 Agent 读取后已被其他操作修改；请重新调用 get_canvas 后再写入');
    error.name = 'AgentCanvasRevisionConflictError';
    throw error;
  }
}

function advanceCanvasWriteFence(context: AgentToolContext) {
  context.state.set('expectedCanvasFingerprint', canvasMutationFingerprint(projectStore.project));
}

function actionToolSchema(actionSchema = canvasActionSchema) {
  return {
    type: 'object' as const,
    properties: {
      actions: { type: 'array' as const, items: actionSchema, minItems: 1 },
      title: { type: 'string' as const },
      autoLayout: { type: 'boolean' as const },
      selectCreated: { type: 'boolean' as const },
    },
    additionalProperties: false,
  };
}

async function executeActions(input: CanvasActionToolInput, context: AgentToolContext) {
  // 工具层采用“有效动作保留、无效动作跳过”的局部成功语义。这样模型修复
  // 单个坏 Action 时不会重复创建前面已经成功的节点。
  const actions = normalizeAgentActions(input.actions, context.requestId);
  const checked = actions.map((action, index) => ({ action, index, validation: validateAgentActionShape(action) }));
  const valid = checked.filter((item) => item.validation.valid);
  const skipped = checked.filter((item) => !item.validation.valid).map((item) => ({
    index: item.index, type: item.action.type, applied: false, error: item.validation.error,
  }));
  // mutate_canvas 自身标记为 canvas_write；批次内若启动生成，则提升为
  // media_generation 权限等级，避免付费动作伪装成普通画布修改。
  const hasMedia = valid.some(({ action }) => generationActions.has(action.type));
  if (!valid.length) {
    return {
      success: false, complete: false, appliedCount: 0, skippedCount: skipped.length,
      error: skipped.map((item) => item.error).join('；') || '没有可执行的画布动作', actionResults: skipped,
    };
  }
  const request: AgentActionRequest = {
    actions: valid.map((item) => item.action),
    title: input.title || (hasMedia ? 'Agent 生成任务' : 'Agent 画布操作'),
    autoLayout: input.autoLayout,
    selectCreated: input.selectCreated,
    requireConfirmation: false,
    source: `typescript-agent:${context.requestId}`,
    projectKey: context.projectKey,
    projectInstanceId: context.projectInstanceId,
    projectGeneration: context.projectGeneration,
    conversationId: context.conversationId,
    runId: context.requestId,
  };
  const result = await executeAgentActions(request);
  if (result.success) advanceCanvasWriteFence(context);
  if (result.pending) return { ...result, preflightSkippedCount: skipped.length, preflightActionResults: skipped };
  const actionResults = [
    ...skipped,
    ...(result.actionResults || []).map((item) => ({
      ...item,
      index: valid[Number(item.index) || 0]?.index ?? item.index,
    })),
  ].sort((a, b) => Number(a.index) - Number(b.index));
  return {
    ...result,
    success: Number(result.appliedCount || 0) > 0,
    complete: skipped.length === 0 && result.complete === true,
    partial: skipped.length > 0 || result.partial === true,
    skippedCount: skipped.length + Number(result.skippedCount || 0),
    actionResults,
  };
}

export function registerCanvasTools(): void {
  registerAgentTool({
    id: 'get_canvas',
    title: '读取画布',
    description: '读取当前画布的节点、连线、任务、选择状态和稳定别名；full 视图还包含素材库 assets/materials，可用于把已有素材放回画布。写操作前应先读取相关数据。',
    effect: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        view: { type: 'string', enum: ['summary', 'full', 'selection'] },
        nodeIds: { type: 'array', items: { type: 'string' } },
        sinceRevision: { type: 'number' },
      },
      additionalProperties: false,
    },
    summarizeInput: (input) => String(input.view || 'summary'),
    execute: (input, context) => {
      assertContextProject(context);
      const snapshot = getAgentCanvasSnapshot(input);
      advanceCanvasWriteFence(context);
      return snapshot;
    },
  });

  registerAgentTool({
    id: 'select_canvas',
    title: '选择画布节点',
    description: '按 get_canvas 返回的真实节点 ID或稳定别名选择节点，便于后续围绕选区读取和操作；传空数组可清空选择。',
    effect: 'read',
    inputSchema: {
      type: 'object',
      required: ['nodeIds'],
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    },
    summarizeInput: (input) => `${(input.nodeIds as string[] | undefined)?.length || 0} node(s)`,
    execute: (input, context) => {
      assertContextProject(context);
      const aliasMap = agentNodeAliasMaps(projectStore.project.nodes || []).aliasMap;
      const existing = new Set((projectStore.project.nodes || []).map((node: any) => String(node.id)));
      const resolved = ((input.nodeIds as string[] | undefined) || []).flatMap((value) => {
        const raw = String(value || '').trim();
        const id = String(aliasMap[raw.toUpperCase()] || raw);
        return existing.has(id) ? [id] : [];
      });
      setSelectedNodeIds(resolved);
      return {
        success: true,
        selectedNodeIds: [...new Set(resolved)],
        missingCount: ((input.nodeIds as string[] | undefined) || []).length - resolved.length,
      };
    },
  });

  registerAgentTool({
    id: 'undo_canvas',
    title: '撤销画布操作',
    description: '撤销最近一次可撤销的画布操作，包括 Agent 批量动作。只在用户明确要求撤销或需要恢复刚才的误操作时调用。',
    effect: 'canvas_write',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    summarizeInput: () => 'undo',
    execute: (_input, context) => {
      assertCanvasWriteFence(context);
      const applied = undoCanvas();
      if (applied) advanceCanvasWriteFence(context);
      return { success: applied, applied, error: applied ? '' : '没有可撤销的画布操作' };
    },
  });

  registerAgentTool({
    id: 'redo_canvas',
    title: '重做画布操作',
    description: '恢复最近一次被撤销的画布操作。只在用户明确要求重做时调用。',
    effect: 'canvas_write',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    summarizeInput: () => 'redo',
    execute: (_input, context) => {
      assertCanvasWriteFence(context);
      const applied = redoCanvas();
      if (applied) advanceCanvasWriteFence(context);
      return { success: applied, applied, error: applied ? '' : '没有可重做的画布操作' };
    },
  });

  registerAgentTool<CanvasActionToolInput>({
    id: 'mutate_canvas',
    title: '修改画布',
    description: '逐条执行画布动作。是否启动节点由用户要求和当前节点执行设置共同决定；有效动作立即应用，无效动作跳过并返回原因。',
    effect: 'canvas_write',
    inputSchema: actionToolSchema(),
    resolveInputSchema: (context) => actionToolSchema(
      context.capabilities.nodeExecution && settingsStore.agentCanRunNodes === true
        ? canvasActionSchema
        : canvasActionSchemaWithoutGeneration,
    ),
    summarizeInput: ({ actions }) => `${actions?.length || 0} canvas action(s)`,
    execute: (input, context) => {
      assertCanvasWriteFence(context);
      return executeActions(input, context);
    },
  });

  registerAgentTool({
    id: 'inspect_tasks',
    title: '读取生成任务',
    description: '读取指定生成任务的当前真实状态。该工具不会等待或推测结果；complete=false 时不得构造依赖实际媒体输出的下游阶段。',
    effect: 'read',
    inputSchema: {
      type: 'object',
      properties: { taskIds: { type: 'array', items: { type: 'string' } } },
      additionalProperties: false,
    },
    execute: (input, context) => {
      assertContextProject(context);
      const snapshot = getAgentCanvasSnapshot({ view: 'summary' }) as JsonObject;
      const ids = new Set((input.taskIds as string[] | undefined) || []);
      const tasks = ((snapshot.tasks as JsonObject[] | undefined) || []).filter((task) => !ids.size || ids.has(String(task.id)));
      const foundIds = new Set(tasks.map((task) => String(task.id)));
      const missingTaskIds = [...ids].filter((id) => !foundIds.has(id));
      const success = missingTaskIds.length === 0;
      return {
        success,
        tasks,
        missingTaskIds,
        complete: success
          && tasks.length > 0
          && tasks.every((task) => String(task.status) === 'completed'),
        error: success ? '' : `任务不存在：${missingTaskIds.join(', ')}`,
      };
    },
  });
}
