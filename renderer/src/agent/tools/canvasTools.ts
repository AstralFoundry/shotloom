import {
  executeAgentActions,
  getAgentCanvasSnapshot,
  layoutAgentCanvasNodes,
} from '@/services/agent/agentCanvasExecutor';
import type { AgentAction, AgentActionRequest, JsonObject } from '@/services/agentTypes';
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
import { buildAgentActionSchema, flattenAgentActionSchema, normalizeAgentActions } from './agentProtocol';
import { canvasMutationFingerprint } from '@/utils/canvasMutationFingerprint.mjs';
import { desktopApi } from '@/services/desktopApi';

function imageDataUrl(bytes: ArrayBuffer) {
  const data = new Uint8Array(bytes);
  let binary = '';
  for (let offset = 0; offset < data.length; offset += 0x8000) {
    binary += String.fromCharCode(...data.subarray(offset, offset + 0x8000));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

function mediaCandidate(node: Record<string, any>) {
  const outputs = Array.isArray(node.generatedOutputs) ? node.generatedOutputs : [];
  const selectedId = String(node.selectedOutputNodeId || '').replace(/^material:/, '');
  const selected = outputs.find((item: any) => String(item?.id || '') === selectedId)
    || outputs.find((item: any) => item?.selected)
    || outputs.at(-1);
  const material = (projectStore.project.materials || []).find((item: any) =>
    item.nodeId === node.id && (!selectedId || String(item.id) === selectedId));
  return selected || material || node.uploadedFile || node;
}

function mediaPath(candidate: Record<string, any>) {
  const path = String(candidate?.filePath || candidate?.path || '');
  return path && !/^(?:https?:|blob:|data:)/i.test(path) ? path : '';
}

function isVideoCandidate(candidate: Record<string, any>, path: string) {
  const kind = String(candidate?.resourceType || candidate?.mimeType || candidate?.type || '').toLowerCase();
  return kind.includes('video') || /\.(?:mp4|m4v|mov|webm|mkv|avi)$/i.test(path);
}

const generationActions = new Set(['start_generation']);
// 模型只看到这份白名单中的 Action。完整存储契约可以包含内部动作，
// 但不会因为存在于 JSON 文件中就自动暴露给 Agent。

function assertContextProject(context: AgentToolContext) {
  return assertAgentProject(context.projectKey, context.projectInstanceId, context.projectGeneration);
}

function assertCanvasWriteFence(context: AgentToolContext) {
  assertContextProject(context);
  const expected = String(context.state.get('expectedCanvasFingerprint') || '');
  const current = canvasMutationFingerprint(projectStore.project);
  if (expected && expected !== current) {
    const error = new Error('画布在 Agent 读取后已被其他操作修改；请重新调用 canvas_list_nodes 或 canvas_get_node 后再写入');
    error.name = 'AgentCanvasRevisionConflictError';
    throw error;
  }
}

function advanceCanvasWriteFence(context: AgentToolContext) {
  context.state.set('expectedCanvasFingerprint', canvasMutationFingerprint(projectStore.project));
}

function focusedActionSchema(types: string[]) {
  return flattenAgentActionSchema(buildAgentActionSchema(actionContract, { allowedTypes: types }));
}

/**
 * 工具回执里给用户看的节点名。模型传进来的可能是别名或真实 ID，
 * 但 UI 绝不能把 UUID 直接摊给用户，所以统一解析成画布上显示的那个名字。
 */
function nodeSummaryLabel(rawId: unknown) {
  const raw = String(rawId || '').trim();
  if (!raw) return '未指定节点';
  const nodes = projectStore.project.nodes || [];
  const aliasMap = agentNodeAliasMaps(nodes).aliasMap;
  const nodeId = String(aliasMap[raw.toUpperCase()] || raw);
  const node = nodes.find((item: { id: string }) => String(item.id) === nodeId) as Record<string, any> | undefined;
  if (!node) return '节点已不存在';
  const outputs = Array.isArray(node.generatedOutputs) ? node.generatedOutputs : [];
  return String(outputs.at(-1)?.fileName || node.uploadedFile?.name || node.title || node.type || '未命名节点');
}

/** 读取类工具用真实快照条目数量描述产出，界面才不会出现没有结果的"已运行"。 */
function snapshotDisplay(result: any) {
  const parts = [
    [result?.nodes, '节点'],
    [result?.edges, '连线'],
    [result?.tasks, '任务'],
  ] as Array<[unknown, string]>;
  const counted = parts
    .map(([value, label]) => ({ total: Array.isArray(value) ? value.length : 0, label }))
    .filter((item) => item.total > 0)
    .map((item) => `${item.total} 个${item.label}`);
  return counted.length ? { summary: counted.join(' · ') } : undefined;
}

async function executeFocusedAction(input: JsonObject, context: AgentToolContext) {
  assertCanvasWriteFence(context);
  return executeActions({ actions: [input as AgentAction] }, context);
}

async function executeActions(input: CanvasActionToolInput, context: AgentToolContext) {
  // 工具层采用“有效动作保留、无效动作跳过”的局部成功语义。这样模型修复
  // 单个坏 Action 时不会重复创建前面已经成功的节点。
  // A focused tool call contains one action, so using only the run id would
  // assign every independent create in the run the same fallback tempId.
  // turnId includes the native tool call id: retries of the same call remain
  // idempotent while separate calls receive separate identities.
  const actions = normalizeAgentActions(input.actions, context.turnId);
  const checked = actions.map((action, index) => ({ action, index, validation: validateAgentActionShape(action) }));
  const valid = checked.filter((item) => item.validation.valid);
  const skipped = checked.filter((item) => !item.validation.valid).map((item) => ({
    index: item.index, type: item.action.type, applied: false, error: item.validation.error,
  }));
  // 细粒度工具共享这个执行入口；其中启动生成由独立的
  // media_generation 工具暴露，避免付费动作伪装成普通画布修改。
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
    id: 'canvas_list_nodes',
    icon: 'grid',
    title: '浏览画布',
    description: '浏览画布节点索引、连线摘要、任务状态和稳定别名；timeline 按显式分段组织，full 仅在确实需要素材库 assets/materials 时使用。写操作前先建立当前 revision 基线。',
    effect: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        view: { type: 'string', enum: ['summary', 'timeline', 'selection', 'full'] },
        sinceRevision: { type: 'number' },
      },
      additionalProperties: false,
    },
    summarizeInput: (input) => String(input.view || 'summary'),
    summarizeResult: snapshotDisplay,
    execute: (input, context) => {
      assertContextProject(context);
      const snapshot = getAgentCanvasSnapshot(input);
      advanceCanvasWriteFence(context);
      return snapshot;
    },
  });

  registerAgentTool({
    id: 'canvas_get_node',
    icon: 'search',
    title: '读取画布节点',
    description: '按真实节点 ID、稳定别名或语义 ID读取一个节点及其一跳上下游、相关连线和任务。用于局部核验，避免重复读取完整画布。',
    effect: 'read',
    inputSchema: {
      type: 'object',
      required: ['nodeId'],
      properties: { nodeId: { type: 'string' } },
      additionalProperties: false,
    },
    summarizeInput: (input) => nodeSummaryLabel(input.nodeId),
    summarizeResult: snapshotDisplay,
    execute: (input, context) => {
      assertContextProject(context);
      const raw = String(input.nodeId || '').trim();
      const aliasMap = agentNodeAliasMaps(projectStore.project.nodes || []).aliasMap;
      const nodeId = String(aliasMap[raw.toUpperCase()] || raw);
      const snapshot = getAgentCanvasSnapshot({ view: 'working', nodeIds: [nodeId] });
      advanceCanvasWriteFence(context);
      return snapshot;
    },
  });

  registerAgentTool<JsonObject>({
    id: 'canvas_media_frame',
    icon: 'film',
    title: '查看画布视频画面',
    description: '读取画布节点的真实视频文件，在指定时间点用 FFmpeg 抽取源视频帧并以图片附件返回给模型。用于判断视频画面内容；不修改画布，不用文件名或路径猜测内容。一次最多读取 8 个明确时间点。',
    effect: 'read',
    inputSchema: {
      type: 'object',
      required: ['nodeId', 'timesSec'],
      properties: {
        nodeId: { type: 'string' },
        timesSec: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'number', minimum: 0 } },
      },
      additionalProperties: false,
    },
    summarizeInput: (input) => `${nodeSummaryLabel(input.nodeId)} @ ${Array.isArray(input.timesSec) ? input.timesSec.join(', ') : ''}s`,
    execute: async (input, context) => {
      assertContextProject(context);
      const rawNodeId = String(input.nodeId || '').trim();
      const aliasMap = agentNodeAliasMaps(projectStore.project.nodes || []).aliasMap;
      const nodeId = String(aliasMap[rawNodeId.toUpperCase()] || rawNodeId);
      const node = (projectStore.project.nodes || []).find((item: any) => String(item.id) === nodeId) as Record<string, any> | undefined;
      if (!node || node.archived) return { success: false, error: '画布视频节点不存在，请先重新读取画布' };
      const candidate = mediaCandidate(node);
      const source = mediaPath(candidate);
      if (!source) return { success: false, error: '该节点没有可读取的本地视频文件' };
      if (!isVideoCandidate(candidate, source)) return { success: false, error: '该节点不是视频素材，不能使用视频抽帧工具' };
      const times = [...new Set((Array.isArray(input.timesSec) ? input.timesSec : [])
        .map((value) => Number(value)).filter((value) => Number.isFinite(value) && value >= 0))];
      if (!times.length) return { success: false, error: '至少提供一个有效的时间点（秒）' };
      const attachments: JsonObject[] = [];
      const frames: JsonObject[] = [];
      for (const seconds of times) {
        try {
          const frame = await desktopApi.file.captureVideoFrameToProject(source, seconds, `agent-frame-${nodeId}-${seconds.toFixed(3)}.jpg`);
          const path = String(frame?.filePath || frame?.path || '');
          if (!path) throw new Error('截帧没有返回文件');
          const bytes = await desktopApi.file.readImagePreview(path, 1280);
          if (!bytes?.byteLength) throw new Error('截帧文件无法读取');
          const filename = `${String(node.title || node.fileName || nodeId)}-${seconds.toFixed(3)}s.jpg`;
          attachments.push({ type: 'file', mime: 'image/jpeg', filename, url: imageDataUrl(bytes) });
          frames.push({ seconds, filename, path });
        } catch (error) {
          frames.push({ seconds, error: error instanceof Error ? error.message : String(error) });
        }
      }
      if (!attachments.length) return { success: false, nodeId, frames, error: '所有指定时间点都无法抽取视频帧' };
      return {
        success: true,
        nodeId,
        sourceFile: source,
        frames,
        evidence: '源视频帧；不含画布叠层或剪辑合成效果',
        __toolAttachments: attachments,
      };
    },
    // 抽帧是模型看得见、用户看不见的典型：把真实帧文件交给界面显示，用户才能核对 Agent 的依据。
    summarizeResult: (result: any) => {
      const frames = (Array.isArray(result?.frames) ? result.frames : []).filter((frame: any) => frame?.path);
      if (!frames.length) return undefined;
      return {
        summary: `${frames.length} 帧源视频画面`,
        previews: frames.map((frame: any) => ({
          path: String(frame.path),
          label: `${Number(frame.seconds).toFixed(1)}s`,
        })),
      };
    },
  });

  registerAgentTool({
    id: 'canvas_focus_nodes',
    icon: 'cursor',
    title: '聚焦画布节点',
    description: '按 canvas_list_nodes 返回的真实节点 ID或稳定别名选择并聚焦节点；这是瞬时 UI 操作，不修改项目。传空数组可清空选择。',
    effect: 'read',
    inputSchema: {
      type: 'object',
      required: ['nodeIds'],
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    },
    summarizeInput: (input) => `${(input.nodeIds as string[] | undefined)?.length || 0} 个节点`,
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

  registerAgentTool<JsonObject>({
    id: 'canvas_create_node',
    icon: 'plus',
    title: '创建画布节点',
    description: '创建一个生成节点、说明节点，或把已有真实素材放回画布。成功回执中的 nodeIds 可直接用于后续连接。',
    effect: 'canvas_write',
    inputSchema: focusedActionSchema(['create_gen_node', 'create_note_node', 'place_asset_on_canvas']),
    summarizeInput: (input) => String(input.title || input.type || 'create node'),
    execute: executeFocusedAction,
  });

  registerAgentTool<JsonObject>({
    id: 'canvas_layout_nodes',
    icon: 'shapes',
    title: '整理画布节点',
    description: '根据真实连线拓扑、显式分段和节点尺寸整理指定节点。代码只处理几何和碰撞，不从标题或关键词猜测制作语义。',
    effect: 'canvas_write',
    inputSchema: {
      type: 'object',
      required: ['nodeIds'],
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
        scope: { type: 'string', enum: ['selection', 'workflow', 'all'] },
        mode: { type: 'string', enum: ['workflow', 'horizontal', 'vertical', 'grid'] },
        includeConnected: { type: 'boolean' },
        avoidCollisions: { type: 'boolean' },
        x: { type: 'number' },
        y: { type: 'number' },
        gapX: { type: 'number' },
        gapY: { type: 'number' },
      },
      additionalProperties: false,
    },
    summarizeInput: (input) => `${Array.isArray(input.nodeIds) ? input.nodeIds.length : 0} 个节点`,
    execute: async (input, context) => {
      assertCanvasWriteFence(context);
      const result = await layoutAgentCanvasNodes({
        ...input,
        projectKey: context.projectKey,
        projectInstanceId: context.projectInstanceId,
        projectGeneration: context.projectGeneration,
      });
      if (result.success) advanceCanvasWriteFence(context);
      return result;
    },
  });

  registerAgentTool<JsonObject>({
    id: 'canvas_update_node',
    icon: 'pencil',
    title: '更新画布节点',
    description: '更新一个生成节点的模型、提示词、输入模式或参数，修改 Note 的标题或正文，或者移动一个现有节点。只提交需要变化的字段。',
    effect: 'canvas_write',
    inputSchema: focusedActionSchema(['update_gen_config', 'update_note_node', 'move_node']),
    summarizeInput: (input) => nodeSummaryLabel(input.nodeId),
    execute: executeFocusedAction,
  });

  registerAgentTool<JsonObject>({
    id: 'canvas_connect_nodes',
    icon: 'link',
    title: '连接画布节点',
    description: '连接两个真实节点，并为特殊媒体输入明确指定 slot。返回真实 edgeIds 和受影响节点。',
    effect: 'canvas_write',
    inputSchema: focusedActionSchema(['connect_nodes']),
    summarizeInput: (input) => `${nodeSummaryLabel(input.source)} -> ${nodeSummaryLabel(input.target)}`,
    execute: executeFocusedAction,
  });

  registerAgentTool<JsonObject>({
    id: 'canvas_delete_node',
    icon: 'trash',
    title: '删除画布节点',
    description: '删除一个真实节点及相关连线。只有用户目标明确要求删除时使用。',
    effect: 'canvas_write',
    inputSchema: focusedActionSchema(['delete_node']),
    summarizeInput: (input) => nodeSummaryLabel(input.nodeId),
    execute: executeFocusedAction,
  });

  registerAgentTool<JsonObject>({
    id: 'canvas_update_edge',
    icon: 'workflow',
    title: '更新画布连线',
    description: '删除、启用或禁用一条真实连线。优先使用 edgeId；没有 edgeId 时使用 source 和 target。',
    effect: 'canvas_write',
    inputSchema: focusedActionSchema(['delete_edge', 'toggle_edge']),
    summarizeInput: (input) => (input.edgeId
      ? `连线 ${String(input.edgeId)}`
      : `${nodeSummaryLabel(input.source)} -> ${nodeSummaryLabel(input.target)}`),
    execute: executeFocusedAction,
  });

  registerAgentTool<JsonObject>({
    id: 'canvas_start_generation',
    icon: 'play',
    title: '启动节点生成',
    description: '启动一个已配置完整的生成节点。返回 taskId 后使用 inspect_tasks 核验真实状态，不要重复启动。',
    effect: 'media_generation',
    isAvailable: (context) => context.capabilities.nodeExecution && settingsStore.agentCanRunNodes === true,
    inputSchema: focusedActionSchema(['start_generation']),
    summarizeInput: (input) => nodeSummaryLabel(input.nodeId),
    execute: executeFocusedAction,
  });

  registerAgentTool({
    id: 'undo_canvas',
    icon: 'undo',
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
    icon: 'redo',
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

  registerAgentTool({
    id: 'inspect_tasks',
    icon: 'task',
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
