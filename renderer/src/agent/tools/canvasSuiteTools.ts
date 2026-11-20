import { t } from '@/i18n';
import { registerAgentTool } from '../core/toolRegistry';
import type { AgentToolContext, JsonObject } from '../core/types';
import { store, touchProject } from '@/store/projectStore';
import { addNode, deleteNodeById } from '@/store/nodeStore';
import { recordCanvasHistory } from '@/store/canvasHistoryStore';
import { getAvailableModelIdsByType, settingsStore } from '@/store/settingsStore';
import { assertAgentProject } from '@/services/agentProjectIdentity';
import { agentNodeAliasMaps } from '@/services/agentCanvasSnapshot';
import { canvasWriteFenceConflict, canvasWriteFenceFingerprint } from '@/utils/canvasMutationFingerprint';
import { isModelForType } from '@/domain/catalog/ModelCatalog';
import {
  MAX_STORYBOARD_SHOTS,
  STORYBOARD_SCRIPT_SUBTASK,
  STORYBOARD_SCRIPT_VIEW,
  normalizeStoryboardShots,
  storyboardShotSummary,
  type StoryboardShot,
} from '@/domain/graph/StoryboardScript';
import {
  MAX_BATCH_REFERENCE_COLUMNS,
  MAX_BATCH_ROWS,
  normalizeBatchTable,
  type BatchRow,
  type BatchTableData,
} from '@/domain/graph/BatchTable';
import { batchReferenceDefaults, batchTableData, ensureBatchTableData, isCanvasImageNode } from '@/services/batchTableService';
import { runStoryboardScriptGeneration, runStoryboardShots, storyboardShots } from '@/services/storyboardScriptService';
import { runBatchTable } from '@/services/batchTableService';

type AnyRecord = Record<string, any>;

function project() {
  return store.project as AnyRecord;
}

function resolveNodeId(raw: unknown): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  const aliasMap = agentNodeAliasMaps(project().nodes || []).aliasMap;
  return String(aliasMap[value.toUpperCase()] || value);
}

function assertContext(context: AgentToolContext) {
  assertAgentProject(context.projectKey, context.projectInstanceId, context.projectGeneration);
}

function assertWriteFence(context: AgentToolContext) {
  assertContext(context);
  if (canvasWriteFenceConflict(context.run.expectedCanvasFingerprint, store.project)) {
    const error = new Error(t('tool.feedback.canvas.conflict'));
    error.name = 'AgentCanvasRevisionConflictError';
    throw error;
  }
}

function advanceWriteFence(context: AgentToolContext) {
  context.run.expectedCanvasFingerprint = canvasWriteFenceFingerprint(store.project);
}

function findStoryboard(nodeId: string): AnyRecord | null {
  const node = (project().nodes as AnyRecord[]).find((item) => item.id === nodeId && !item.archived) || null;
  return node && node.type === 'textGeneration' && node.canvasView === STORYBOARD_SCRIPT_VIEW ? node : null;
}

function findBatchTable(nodeId: string): AnyRecord | null {
  const node = (project().nodes as AnyRecord[]).find((item) => item.id === nodeId && !item.archived) || null;
  return node && node.type === 'batchTable' ? node : null;
}

function storyboardResult(node: AnyRecord) {
  const rows = storyboardShots(node);
  const summary = storyboardShotSummary(rows);
  return {
    success: true,
    nodeId: String(node.id),
    title: String(node.title || ''),
    source: String(node.prompt || ''),
    model: String(node.model || ''),
    shotCount: Number(node.storyboardShotCount) > 0 ? Number(node.storyboardShotCount) : 'auto',
    shotDuration: Number(node.storyboardShotDuration) > 0 ? Number(node.storyboardShotDuration) : 'auto',
    extraRequirement: String(node.storyboardExtraRequirement || ''),
    count: summary.count,
    totalDuration: summary.totalDuration,
    rows: rows.map((shot) => ({
      id: shot.id,
      shotNumber: shot.shotNumber,
      durationSeconds: shot.durationSeconds,
      plot: shot.plot,
      videoPrompt: shot.videoPrompt,
      dialogue: shot.dialogue,
      imageNodeId: shot.imageNodeId,
      videoNodeId: shot.videoNodeId,
      status: shot.status,
    })),
  };
}

function batchResult(node: AnyRecord) {
  const table = batchTableData(node);
  const defaults = batchReferenceDefaults(String(node.id));
  return {
    success: true,
    nodeId: String(node.id),
    title: String(node.title || ''),
    operation: table.operation,
    concurrency: table.concurrency,
    globalPrompt: table.globalPrompt,
    columns: table.columns,
    defaults,
    rows: table.rows.map((row: BatchRow, index: number) => ({
      index,
      id: row.id,
      enabled: row.enabled,
      prompt: row.prompt,
      referenceNodeIds: row.referenceNodeIds,
      resolvedReferences: row.referenceNodeIds.map((id, position) => id || defaults[position] || ''),
      outputNodeId: row.outputNodeId,
    })),
  };
}

export function registerCanvasSuiteTools(): void {
  registerAgentTool<JsonObject>({
    id: 'canvas_get_storyboard',
    icon: 'text',
    title: t('tool.title.canvas_get_storyboard'),
    description: '读取一个分镜脚本节点的真实镜头行、镜号、提示词、台词和产出节点 ID。只读，不修改画布。',
    effect: 'read',
    inputSchema: {
      type: 'object', required: ['nodeId'],
      properties: { nodeId: { type: 'string', description: '真实分镜节点 ID 或稳定别名' } },
      additionalProperties: false,
    },
    summarizeInput: (input) => String(input.nodeId || ''),
    execute: (input, context) => {
      assertContext(context);
      const node = findStoryboard(resolveNodeId(input.nodeId));
      if (!node) return { success: false, error: t('tool.feedback.canvas.missingStoryboard') };
      return storyboardResult(node);
    },
  });
  registerAgentTool<JsonObject>({
    id: 'canvas_get_batch_table',
    icon: 'table',
    title: t('tool.title.canvas_get_batch_table'),
    description: '读取批量创作表的任务类型、并发、全局提示词、参考列、行 ID、行参考与产出节点。只读，不提交生成。',
    effect: 'read',
    inputSchema: {
      type: 'object', required: ['nodeId'],
      properties: { nodeId: { type: 'string', description: '真实批量创作表节点 ID 或稳定别名' } },
      additionalProperties: false,
    },
    summarizeInput: (input) => String(input.nodeId || ''),
    execute: (input, context) => {
      assertContext(context);
      const node = findBatchTable(resolveNodeId(input.nodeId));
      if (!node) return { success: false, error: t('tool.feedback.canvas.missingBatchTable') };
      return batchResult(node);
    },
  });
  registerAgentTool<JsonObject>({
    id: 'canvas_storyboard',
    icon: 'text',
    title: t('tool.title.canvas_storyboard'),
    description: '读取、创建或更新分镜脚本节点。分镜行是画布上的真实数据，read 返回 nodeId 和逐镜 ID；update 的 shots 会整表替换镜头行，source 是剧情/创意原文。不会自动提交图片或视频生成，也不猜测未提供的字段。',
    effect: 'canvas_write',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['create', 'update'] },
        nodeId: { type: 'string', description: '真实分镜节点 ID 或稳定别名' },
        title: { type: 'string' },
        source: { type: 'string', description: '剧情、剧本或创意原文；生成分镜时作为模型输入' },
        model: { type: 'string', description: '可用的文本模型 ID' },
        shotCount: { type: 'number', minimum: 0, maximum: 100, description: '0 表示由模型自动决定镜头数' },
        shotDuration: { type: 'number', minimum: 0, maximum: 600, description: '0 表示单镜时长自动' },
        extraRequirement: { type: 'string' },
        shots: {
          type: 'array',
          maxItems: MAX_STORYBOARD_SHOTS,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              shotNumber: { type: 'number' },
              durationSeconds: { type: 'number' },
              plot: { type: 'string' },
              shotSize: { type: 'string' },
              camera: { type: 'string' },
              motion: { type: 'string' },
              imagePrompt: { type: 'string' },
              videoPrompt: { type: 'string' },
              dialogue: { type: 'string' },
              sound: { type: 'string' },
              characters: { type: 'string' },
              negativePrompt: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        x: { type: 'number' },
        y: { type: 'number' },
      },
      additionalProperties: false,
    },
    summarizeInput: (input) => `${String(input.action || '')} ${String(input.title || input.nodeId || '')}`.trim(),
    execute: (input, context) => {
      const action = String(input.action || '');
      if (action === 'create') {
        assertWriteFence(context);
        const node: AnyRecord = addNode('textGeneration');
        node.title = String(input.title || t('canvas.storyboard.title'));
        node.titleOverride = node.title;
        node.canvasView = STORYBOARD_SCRIPT_VIEW;
        node.artifactType = 'storyboard';
        node.canvasWidth = 920;
        node.canvasHeight = 440;
        if (Number.isFinite(Number(input.x))) node.x = Math.round(Number(input.x));
        if (Number.isFinite(Number(input.y))) node.y = Math.round(Number(input.y));
        node.prompt = String(input.source || '');
        node.config = { ...(node.config || {}), textSubtask: STORYBOARD_SCRIPT_SUBTASK };
        node.storyboardShotCount = Number(input.shotCount) > 0 ? Number(input.shotCount) : 0;
        node.storyboardShotDuration = Number(input.shotDuration) > 0 ? Number(input.shotDuration) : 0;
        node.storyboardExtraRequirement = String(input.extraRequirement || '');
        node.storyboardShots = Array.isArray(input.shots) ? normalizeStoryboardShots(input.shots) : [];
        if (input.model) {
          if (!isModelForType('textGeneration', String(input.model))) {
            deleteNodeById(String(node.id));
            return { success: false, error: t('tool.feedback.canvas.storyboardModel') };
          }
          node.model = String(input.model);
        }
        touchProject();
        advanceWriteFence(context);
        return storyboardResult(node);
      }
      if (action !== 'update') return { success: false, error: t('tool.feedback.canvas.unknownOperation') };
      const node = findStoryboard(resolveNodeId(input.nodeId));
      if (!node) return { success: false, error: t('tool.feedback.canvas.missingStoryboard') };
      if (input.model && !isModelForType('textGeneration', String(input.model))) {
        return { success: false, error: t('tool.feedback.canvas.storyboardModel') };
      }
      assertWriteFence(context);
      recordCanvasHistory(t('canvas.storyboard.edit'));
      if (input.title !== undefined) { node.title = String(input.title); node.titleOverride = node.title; }
      if (input.source !== undefined) node.prompt = String(input.source);
      if (input.extraRequirement !== undefined) node.storyboardExtraRequirement = String(input.extraRequirement);
      if (input.shotCount !== undefined) node.storyboardShotCount = Number(input.shotCount) > 0 ? Math.min(MAX_STORYBOARD_SHOTS, Number(input.shotCount)) : 0;
      if (input.shotDuration !== undefined) node.storyboardShotDuration = Number(input.shotDuration) > 0 ? Number(input.shotDuration) : 0;
      if (input.model) node.model = String(input.model);
      if (Array.isArray(input.shots)) node.storyboardShots = normalizeStoryboardShots(input.shots);
      touchProject();
      advanceWriteFence(context);
      return storyboardResult(node);
    },
  });

  registerAgentTool<JsonObject>({
    id: 'canvas_batch_table',
    icon: 'table',
    title: t('tool.title.canvas_batch_table'),
    description: '读取、创建或更新批量创作表。operation 支持 try_on（每行至少两张参考图）和 creative（至少一张）；referenceNodeIds 必须是当前画布真实图片节点。update 的 rows 会整表替换任务行。工具只改计划，不提交生成。',
    effect: 'canvas_write',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['create', 'update'] },
        nodeId: { type: 'string' },
        title: { type: 'string' },
        operation: { type: 'string', enum: ['try_on', 'creative'] },
        concurrency: { type: 'number', enum: [1, 5, 10] },
        globalPrompt: { type: 'string' },
        columnCount: { type: 'number', minimum: 1, maximum: MAX_BATCH_REFERENCE_COLUMNS },
        rows: {
          type: 'array',
          maxItems: MAX_BATCH_ROWS,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              enabled: { type: 'boolean' },
              prompt: { type: 'string' },
              referenceNodeIds: { type: 'array', items: { type: 'string' }, maxItems: MAX_BATCH_REFERENCE_COLUMNS },
            },
            additionalProperties: false,
          },
        },
        x: { type: 'number' },
        y: { type: 'number' },
      },
      additionalProperties: false,
    },
    summarizeInput: (input) => `${String(input.action || '')} ${String(input.title || input.nodeId || '')}`.trim(),
    execute: (input, context) => {
      const action = String(input.action || '');
      if (action === 'create') {
        assertWriteFence(context);
        const node: AnyRecord = addNode('batchTable');
        node.title = String(input.title || t('canvas.batch.title'));
        node.titleOverride = node.title;
        node.canvasWidth = 1280;
        node.canvasHeight = 560;
        if (Number.isFinite(Number(input.x))) node.x = Math.round(Number(input.x));
        if (Number.isFinite(Number(input.y))) node.y = Math.round(Number(input.y));
        ensureBatchTableData(node);
        applyBatchPatch(node, input);
        const invalid = validateBatchReferences(node);
        if (invalid) {
          deleteNodeById(String(node.id));
          return { success: false, error: invalid };
        }
        touchProject();
        advanceWriteFence(context);
        return batchResult(node);
      }
      if (action !== 'update') return { success: false, error: t('tool.feedback.canvas.unknownOperation') };
      const node = findBatchTable(resolveNodeId(input.nodeId));
      if (!node) return { success: false, error: t('tool.feedback.canvas.missingBatchTable') };
      assertWriteFence(context);
      recordCanvasHistory(t('canvas.batch.edit'));
      const previousTable = node.batchTable;
      const previousTitle = node.title;
      const previousTitleOverride = node.titleOverride;
      if (input.title !== undefined) { node.title = String(input.title); node.titleOverride = node.title; }
      applyBatchPatch(node, input);
      const invalid = validateBatchReferences(node);
      if (invalid) {
        node.batchTable = previousTable;
        node.title = previousTitle;
        node.titleOverride = previousTitleOverride;
        return { success: false, error: invalid };
      }
      touchProject();
      advanceWriteFence(context);
      return batchResult(node);
    },
  });

  registerAgentTool<JsonObject>({
    id: 'canvas_generate_storyboard',
    icon: 'spark',
    title: t('tool.title.canvas_generate_storyboard'),
    description: '启动真实的分镜生成：kind=script 用当前文本模型拆分镜头；kind=image/video 为所选镜头创建或复用生成节点并提交任务。需要用户允许 Agent 运行节点。返回启动的任务/节点后使用 inspect_tasks 核验，不要重复提交。',
    effect: 'media_generation',
    isAvailable: (context) => context.capabilities.nodeExecution && settingsStore.agentCanRunNodes === true,
    inputSchema: {
      type: 'object',
      required: ['nodeId', 'kind'],
      properties: {
        nodeId: { type: 'string' },
        kind: { type: 'string', enum: ['script', 'image', 'video'] },
        shotIds: { type: 'array', items: { type: 'string' }, maxItems: MAX_STORYBOARD_SHOTS },
      },
      additionalProperties: false,
    },
    summarizeInput: (input) => `${String(input.kind || '')} ${String(input.nodeId || '')}`,
    execute: (input, context) => {
      assertContext(context);
      const node = findStoryboard(resolveNodeId(input.nodeId));
      if (!node) return { success: false, error: t('tool.feedback.canvas.missingStoryboard') };
      const kind = String(input.kind);
      if (kind === 'script') {
        if (!String(node.prompt || '').trim()) return { success: false, error: t('canvas.storyboard.needSource') };
        const task = runStoryboardScriptGeneration(String(node.id));
        if (!task) return { success: false, error: String(node.error || t('tool.feedback.canvas.generationRejected')) };
        return { success: true, taskId: String(task.id), nodeId: String(node.id) };
      }
      if (kind !== 'image' && kind !== 'video') return { success: false, error: t('tool.feedback.canvas.unknownOperation') };
      const shotIds = Array.isArray(input.shotIds) ? input.shotIds.map(String) : undefined;
      const shots = storyboardShots(node).filter((shot: StoryboardShot) => !shotIds || shotIds.includes(shot.id));
      if (!shots.length) return { success: false, error: t('canvas.storyboard.nothingToRun') };
      if (!getAvailableModelIdsByType(kind === 'image' ? 'imageGeneration' : 'videoGeneration').length) {
        return { success: false, error: t('canvas.storyboard.noModel') };
      }
      void runStoryboardShots(String(node.id), kind, shotIds);
      return { success: true, started: shots.length, nodeId: String(node.id), kind };
    },
  });

  registerAgentTool<JsonObject>({
    id: 'canvas_run_batch_table',
    icon: 'play',
    title: t('tool.title.canvas_run_batch_table'),
    description: '启动批量创作表中的任务；rowIds 为空时只启动可运行且未完成的行。需要用户允许 Agent 运行节点。返回启动行数后使用 inspect_tasks 核验真实状态，不要重复提交。',
    effect: 'media_generation',
    isAvailable: (context) => context.capabilities.nodeExecution && settingsStore.agentCanRunNodes === true,
    inputSchema: {
      type: 'object',
      required: ['nodeId'],
      properties: {
        nodeId: { type: 'string' },
        rowIds: { type: 'array', items: { type: 'string' }, maxItems: MAX_BATCH_ROWS },
      },
      additionalProperties: false,
    },
    summarizeInput: (input) => String(input.nodeId || ''),
    execute: (input, context) => {
      assertContext(context);
      const node = findBatchTable(resolveNodeId(input.nodeId));
      if (!node) return { success: false, error: t('tool.feedback.canvas.missingBatchTable') };
      if (!getAvailableModelIdsByType('imageGeneration').length) return { success: false, error: t('canvas.batch.noModel') };
      const rowIds = Array.isArray(input.rowIds) ? input.rowIds.map(String) : undefined;
      const table = batchTableData(node);
      const targets = table.rows.filter((row) => (rowIds ? rowIds.includes(row.id) : row.enabled));
      if (!targets.length) return { success: false, error: t('canvas.batch.nothingToRun') };
      void runBatchTable(String(node.id), { ...(rowIds ? { rowIds } : {}), force: Boolean(rowIds) });
      return { success: true, started: targets.length, nodeId: String(node.id) };
    },
  });
}

function applyBatchPatch(node: AnyRecord, input: JsonObject): void {
  const table = batchTableData(node);
  const current = normalizeBatchTable(table);
  const operation = input.operation === 'creative' ? 'creative' : input.operation === 'try_on' ? 'try_on' : current.operation;
  const concurrency = [1, 5, 10].includes(Number(input.concurrency)) ? Number(input.concurrency) : current.concurrency;
  const columnCount = Number(input.columnCount) >= 1 && Number(input.columnCount) <= MAX_BATCH_REFERENCE_COLUMNS
    ? Math.round(Number(input.columnCount))
    : current.columns.length;
  const columns = Array.from({ length: columnCount }, (_, index) => (
    current.columns[index] || { id: `column-${index + 1}-${Math.random().toString(36).slice(2, 8)}`, label: `参考图 ${index + 1}` }
  )).map((column, index) => ({ ...column, label: `参考图 ${index + 1}` }));
  const rows = Array.isArray(input.rows)
    ? normalizeBatchTable({ operation, concurrency, globalPrompt: input.globalPrompt ?? current.globalPrompt, columns, rows: input.rows }).rows
    : current.rows.map((row) => ({ ...row, referenceNodeIds: row.referenceNodeIds.slice(0, columnCount) }));
  node.batchTable = {
    ...current,
    operation,
    concurrency,
    globalPrompt: input.globalPrompt !== undefined ? String(input.globalPrompt) : current.globalPrompt,
    columns,
    rows,
  } satisfies BatchTableData;
}

function validateBatchReferences(node: AnyRecord): string {
  const invalid: string[] = [];
  for (const row of batchTableData(node).rows) {
    for (const id of row.referenceNodeIds.filter(Boolean)) {
      if (!isCanvasImageNode(id)) invalid.push(id);
    }
  }
  return invalid.length ? t('tool.feedback.canvas.invalidBatchReferences', { value0: [...new Set(invalid)].join(', ') }) : '';
}
