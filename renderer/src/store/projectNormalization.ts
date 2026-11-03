import { t } from '../i18n/index.ts';
import { isActiveTaskStatus } from '@/domain/tasks/TaskStatus';
import { uid } from '@/utils/format';
import { canvasArtifactType } from '@/services/agentTypes';
import { defaultGenerationModel } from '@/utils/defaultGenerationModels';
import { generationOutputIssue } from '@/utils/generationResultValidation';
import { summarizeGenerationPayload, type GenerationPayload } from '@/domain/graph/generationPayload';
import { ensureHarnessSessions } from '@/services/harnessSessionStore.ts';
import {
  CANVAS_NODE_SIZE_SCALE,
  CANVAS_NODE_SIZING_VERSION,
} from '@/domain/graph/CanvasNodeDimensions';

const MAX_CANVAS_HISTORY = 8;
const PROJECT_SCHEMA_VERSION = 2;

type AnyRecord = Record<string, any>;

/** Retired runtime data has no product owner; never load or save it again. */
export function removeLegacyAgentState(project: AnyRecord): void {
  for (const key of [
    'agentConversations', 'activeAgentConversationId', 'agentRuns', 'agentRuntimeEvents',
    'agentInteractions', 'agentSteps', 'goal', 'planMode', 'todoItems',
    'projectionJournal', 'projectionCheckpoint', 'projectionSeq',
  ]) delete project[key];
}

export function createProject(name = t('ui.ProjectCard.text.060f1435')): any {
  const project = {
    id: uid(),
    schema: 'shotloom-project',
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name,
    assets: [],
    materials: [],
    nodes: [],
    edges: [],
    tasks: [],
    harnessSessions: [],
    activeHarnessSessionId: '',
    canvasViewport: { x: 0, y: 0, zoom: 1 },
    canvasNodeSizeScale: CANVAS_NODE_SIZE_SCALE,
    canvasNodeSizingVersion: CANVAS_NODE_SIZING_VERSION,
    agentBatches: [],
    agentEvaluations: [],
    productionPlans: [],
    canvasHistory: [],
    canvasRedoStack: [],
    settings: {
      autoSave: true,
      defaultTextModel: defaultGenerationModel('textGeneration'),
      defaultImageModel: defaultGenerationModel('imageGeneration'),
      defaultVideoModel: defaultGenerationModel('videoGeneration'),
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  ensureHarnessSessions(project);
  return project;
}

function assertCurrentProjectSchema(project: unknown): any {
  const record = project as AnyRecord | null | undefined;
  if (!record || typeof record !== 'object' || record.schema !== 'shotloom-project') {
    throw new Error(t("errors.c17248e2d5"));
  }
  const version = Number(record.schemaVersion);
  if (version !== PROJECT_SCHEMA_VERSION) {
    throw new Error(t("errors.0be3ca8229", { value0: PROJECT_SCHEMA_VERSION, value1: version }));
  }
  return record;
}

export function normalizeProject(input: unknown): any {
  const project = assertCurrentProjectSchema(input);
  const base = createProject(project.name || t('ui.ProjectCard.text.060f1435'));
  const storedNodeSizeScale = Number(project?.canvasNodeSizeScale) || 1;
  const nodeSizeRatio = CANVAS_NODE_SIZE_SCALE / storedNodeSizeScale;
  const storedNodeSizingVersion = Number(project?.canvasNodeSizingVersion) || 1;
  const retiredNodeIds = new Set((Array.isArray(project?.nodes) ? project.nodes : [])
    .filter((node: AnyRecord) => node.type === 'clipStudio' && node.clipNodeVersion !== 1).map((node: AnyRecord) => node.id));
  const nodes: AnyRecord[] = (Array.isArray(project?.nodes) ? project?.nodes : [])
    .filter((node: AnyRecord) => !retiredNodeIds.has(node.id)).map((node: AnyRecord) => {
    const next = { ...node };
    next.artifactType = canvasArtifactType(next.artifactType);
    if (
      storedNodeSizingVersion < CANVAS_NODE_SIZING_VERSION &&
      (next.type === 'imageGeneration' || next.type === 'videoGeneration')
    ) {
      // Media nodes were not user-resizable in the previous contract. Release
      // their persisted generic bounds so metadata can apply the real ratio.
      delete next.canvasWidth;
      delete next.canvasHeight;
      return next;
    }
    if (
      storedNodeSizingVersion < CANVAS_NODE_SIZING_VERSION &&
      next.type === 'audioGeneration'
    ) {
      // Audio nodes were never user-resizable, so any stored bounds came from
      // an older generic/default contract and can be safely recalculated.
      delete next.canvasWidth;
      delete next.canvasHeight;
      return next;
    }
    if (nodeSizeRatio === 1) return next;
    const usedOldGenericDefault =
      Math.abs(Number(next.canvasWidth) - Math.round(370 * storedNodeSizeScale)) <= 1 &&
      Math.abs(Number(next.canvasHeight) - Math.round(270 * storedNodeSizeScale)) <= 1;
    if (usedOldGenericDefault) {
      delete next.canvasWidth;
      delete next.canvasHeight;
      return next;
    }
    if (Number(next.canvasWidth) > 0) next.canvasWidth = Math.round(next.canvasWidth * nodeSizeRatio);
    if (Number(next.canvasHeight) > 0) next.canvasHeight = Math.round(next.canvasHeight * nodeSizeRatio);
    return next;
  });
  const nodeIds = new Set<any>(nodes.map((node) => node.id));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const tasks: AnyRecord[] = (Array.isArray(project?.tasks) ? project?.tasks : []).map((task: AnyRecord) => {
    const compactRequestPayload = summarizeGenerationPayload((task?.requestPayload || {}) as GenerationPayload);
    task = {
      ...task,
      requestPayload: compactRequestPayload,
    };
    // 同步图片/文本请求没有服务端 task ID，只能依赖当前 WebView 中的 Promise。
    // 项目文件被重新读取意味着原 WebView 已不存在，这类 running 记录不可能恢复；
    // 立即转为可重试错误，不能永久伪装成“运行中”。异步视频有 remoteTaskId，
    // 继续保留 active 状态，交给 resumeRemoteTasks 查询真实远端终态。
    if (
      isActiveTaskStatus(task?.status) &&
      !task?.remoteTaskId
    ) {
      const error = t('task.restoreSyncEnded');
      const node = nodeById.get(task.nodeId) as AnyRecord | undefined;
      if (node) {
        node.status = 'error';
        node.progress = Math.max(0, Math.min(99, Number(node.progress) || 0));
        node.error = error;
      }
      return {
        ...task,
        status: 'error',
        error,
        completedAt: new Date().toISOString(),
        result: {
          ...(task.result || {}),
          error,
          status: 'error',
        },
      };
    }
    if (task?.status !== 'completed') return task;
    const node = nodeById.get(task.nodeId) as AnyRecord;
    if (node?.type !== 'textGeneration') return task;
    const issue = generationOutputIssue(
      node.type,
      {
        result: task.result?.output,
        raw: task.result?.raw,
      },
      {
        text: node.textContent || task.result?.text || '',
        archivedFiles: task.result?.archivedFiles || [],
        resultNodes: task.result?.resultNodes || [],
      },
    );
    if (issue?.code !== 'empty-text-length') return task;
    const currentMaxTokens = Number(node.config?.maxTokens) || 2048;
    node.config = {
      ...(node.config || {}),
      maxTokens: Math.min(16384, Math.max(4096, currentMaxTokens * 2)),
    };
    node.status = 'failed';
    node.progress = Math.min(99, Number(node.progress) || 0);
    node.error = issue.message;
    return {
      ...task,
      status: 'failed',
      progress: node.progress,
      error: issue.message,
      suggestedConfigPatch: { maxTokens: node.config.maxTokens },
      result: { ...(task.result || {}), archiveError: issue.message },
    };
  });
  const normalized = {
    ...base,
    ...project,
    id: String(project?.id || base.id),
    assets: (Array.isArray(project?.assets) ? project?.assets : []).map((asset: AnyRecord) => {
      if (!asset?.scope) return asset;
      const next = { ...asset };
      delete next.scope;
      return next;
    }),
    materials: Array.isArray(project?.materials) ? project?.materials : [],
    nodes,
    edges: (Array.isArray(project?.edges) ? project?.edges : [])
      .filter((edge: AnyRecord) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .filter((edge: AnyRecord) => edge.kind !== 'dependency' && edge.data?.inputRole !== 'dependencyOnly'),
    tasks,
    harnessSessions: Array.isArray(project?.harnessSessions)
      ? project?.harnessSessions
      : [],
    activeHarnessSessionId: String(project?.activeHarnessSessionId || ''),
    canvasViewport: normalizeCanvasViewport(project?.canvasViewport),
    canvasNodeSizeScale: CANVAS_NODE_SIZE_SCALE,
    canvasNodeSizingVersion: CANVAS_NODE_SIZING_VERSION,
    agentBatches: Array.isArray(project?.agentBatches) ? project?.agentBatches : [],
    productionPlans: Array.isArray(project?.productionPlans)
      ? project?.productionPlans.filter((plan: AnyRecord) => plan?.schemaVersion === 2)
      : [],
    agentEvaluations: (Array.isArray(project?.agentEvaluations)
      ? project?.agentEvaluations
      : []
    ).map((evaluation: AnyRecord) => {
      const task = tasks.find((item) => item.id === evaluation.taskId);
      if (task?.status !== 'failed' || !task.error) return evaluation;
      return {
        ...evaluation,
        status: 'partial_failed',
        score: 0,
        summary: task.error,
        checks: (evaluation.checks || []).map((check: AnyRecord) => ({ ...check, passed: false })),
      };
    }),
    canvasHistory: Array.isArray(project?.canvasHistory)
      ? project?.canvasHistory.filter((entry: AnyRecord) =>
          !entry.nodes?.some((node: AnyRecord) =>
            ((node.value || node).type === 'clipStudio' && (node.value || node).clipNodeVersion !== 1) || retiredNodeIds.has(node.id)))
        .slice(0, MAX_CANVAS_HISTORY)
      : [],
    canvasRedoStack: Array.isArray(project?.canvasRedoStack)
      ? project?.canvasRedoStack.filter((entry: AnyRecord) =>
          !entry.nodes?.some((node: AnyRecord) =>
            ((node.value || node).type === 'clipStudio' && (node.value || node).clipNodeVersion !== 1) || retiredNodeIds.has(node.id)))
        .slice(0, MAX_CANVAS_HISTORY)
      : [],
    settings: {
      autoSave: project?.settings?.autoSave !== false,
      defaultTextModel: project?.settings?.defaultTextModel || base.settings.defaultTextModel,
      defaultImageModel: project?.settings?.defaultImageModel || base.settings.defaultImageModel,
      defaultVideoModel: project?.settings?.defaultVideoModel || base.settings.defaultVideoModel,
    },
  };
  removeLegacyAgentState(normalized);
  ensureHarnessSessions(normalized);
  return normalized;
}

export function normalizeCanvasViewport(viewport: AnyRecord = {}): { x: number; y: number; zoom: number } {
  const x = Number(viewport?.x);
  const y = Number(viewport?.y);
  const zoom = Number(viewport?.zoom);
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1,
  };
}

