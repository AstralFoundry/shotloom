import { uid } from '@/utils/format';
import { generationOutputIssue } from '@/utils/generationResultValidation';
import { summarizeGenerationPayload } from '@/utils/generationPayload';
import { ensureCopilotConversations } from '@/services/copilotConversations.mjs';
import {
  CANVAS_NODE_SIZE_SCALE,
  CANVAS_NODE_SIZING_VERSION,
} from '@/domain/graph/CanvasNodeDimensions';

const MAX_CANVAS_HISTORY = 8;
const PROJECT_SCHEMA_VERSION = 2;

export function createProject(name = '未命名项目') {
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
    copilotConversations: [],
    activeCopilotConversationId: '',
    canvasViewport: { x: 0, y: 0, zoom: 1 },
    canvasNodeSizeScale: CANVAS_NODE_SIZE_SCALE,
    canvasNodeSizingVersion: CANVAS_NODE_SIZING_VERSION,
    agentBatches: [],
    agentSteps: [],
    agentEvaluations: [],
    agentRuns: [],
    agentRuntimeEvents: [],
    agentInteractions: [],
    productionPlans: [],
    canvasHistory: [],
    canvasRedoStack: [],
    settings: {
      autoSave: true,
      defaultTextModel: 'gpt-5.4',
      defaultImageModel: 'gpt-image-2',
      defaultVideoModel: 'grok-imagine-video',
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  ensureCopilotConversations(project);
  return project;
}

function assertCurrentProjectSchema(project) {
  if (!project || typeof project !== 'object' || project.schema !== 'shotloom-project') {
    throw new Error('项目格式无效：不是 Shotloom 项目');
  }
  const version = Number(project.schemaVersion);
  if (version !== PROJECT_SCHEMA_VERSION) {
    throw new Error(`项目版本不受支持：需要 v${PROJECT_SCHEMA_VERSION}，实际为 v${version}`);
  }
  return project;
}

export function normalizeProject(project) {
  project = assertCurrentProjectSchema(project);
  const base = createProject(project?.name || '未命名项目');
  const storedNodeSizeScale = Number(project?.canvasNodeSizeScale) || 1;
  const nodeSizeRatio = CANVAS_NODE_SIZE_SCALE / storedNodeSizeScale;
  const storedNodeSizingVersion = Number(project?.canvasNodeSizingVersion) || 1;
  const nodes = (Array.isArray(project?.nodes) ? project.nodes : []).map((node) => {
    const next = { ...node };
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
    if (nodeSizeRatio === 1) return node;
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
  const nodeIds = new Set(nodes.map((node) => node.id));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const tasks = (Array.isArray(project?.tasks) ? project.tasks : []).map((task) => {
    const compactRequestPayload = summarizeGenerationPayload(task?.requestPayload || {});
    task = {
      ...task,
      requestPayload: compactRequestPayload,
      result: task?.result
        ? {
            ...task.result,
            requestPayload: summarizeGenerationPayload(
              task.result.requestPayload || compactRequestPayload,
            ),
          }
        : task?.result,
    };
    // 同步图片/文本请求没有服务端 task ID，只能依赖当前 WebView 中的 Promise。
    // 项目文件被重新读取意味着原 WebView 已不存在，这类 running 记录不可能恢复；
    // 立即转为可重试错误，不能永久伪装成“运行中”。异步视频有 remoteTaskId，
    // 继续保留 active 状态，交给 resumeRemoteTasks 查询真实远端终态。
    if (
      ['running', 'queued'].includes(task?.status) &&
      task?.runner === 'remote' &&
      !task?.remoteTaskId
    ) {
      const error = '同步生成请求已随上次页面会话结束，无法恢复；请重试该节点';
      const node = nodeById.get(task.nodeId);
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
          requestPayload: compactRequestPayload,
          error,
          status: 'error',
        },
      };
    }
    if (task?.status !== 'completed') return task;
    const node = nodeById.get(task.nodeId);
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
    assets: (Array.isArray(project?.assets) ? project.assets : []).map((asset) => {
      if (!asset?.scope) return asset;
      const next = { ...asset };
      delete next.scope;
      return next;
    }),
    materials: Array.isArray(project?.materials) ? project.materials : [],
    nodes,
    edges: (Array.isArray(project?.edges) ? project.edges : [])
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .filter((edge) => edge.kind !== 'dependency' && edge.data?.inputRole !== 'dependencyOnly'),
    tasks,
    copilotConversations: Array.isArray(project?.copilotConversations)
      ? project.copilotConversations
      : [],
    activeCopilotConversationId: String(project?.activeCopilotConversationId || ''),
    canvasViewport: normalizeCanvasViewport(project?.canvasViewport),
    canvasNodeSizeScale: CANVAS_NODE_SIZE_SCALE,
    canvasNodeSizingVersion: CANVAS_NODE_SIZING_VERSION,
    agentBatches: Array.isArray(project?.agentBatches) ? project.agentBatches : [],
    agentSteps: Array.isArray(project?.agentSteps) ? project.agentSteps : [],
    agentRuns: Array.isArray(project?.agentRuns) ? project.agentRuns : [],
    agentRuntimeEvents: Array.isArray(project?.agentRuntimeEvents)
      ? project.agentRuntimeEvents
      : [],
    agentInteractions: Array.isArray(project?.agentInteractions) ? project.agentInteractions : [],
    productionPlans: Array.isArray(project?.productionPlans)
      ? project.productionPlans.filter((plan) => plan?.schemaVersion === 2)
      : [],
    agentEvaluations: (Array.isArray(project?.agentEvaluations)
      ? project.agentEvaluations
      : []
    ).map((evaluation) => {
      const task = tasks.find((item) => item.id === evaluation.taskId);
      if (task?.status !== 'failed' || !task.error) return evaluation;
      return {
        ...evaluation,
        status: 'partial_failed',
        score: 0,
        summary: task.error,
        checks: (evaluation.checks || []).map((check) => ({ ...check, passed: false })),
      };
    }),
    canvasHistory: Array.isArray(project?.canvasHistory)
      ? project.canvasHistory.slice(0, MAX_CANVAS_HISTORY)
      : [],
    canvasRedoStack: Array.isArray(project?.canvasRedoStack)
      ? project.canvasRedoStack.slice(0, MAX_CANVAS_HISTORY)
      : [],
    settings: {
      autoSave: project?.settings?.autoSave !== false,
      defaultTextModel: project?.settings?.defaultTextModel || base.settings.defaultTextModel,
      defaultImageModel: project?.settings?.defaultImageModel || base.settings.defaultImageModel,
      defaultVideoModel: project?.settings?.defaultVideoModel || base.settings.defaultVideoModel,
    },
  };
  ensureCopilotConversations(normalized);
  return normalized;
}

export function normalizeCanvasViewport(viewport = {}) {
  const x = Number(viewport?.x);
  const y = Number(viewport?.y);
  const zoom = Number(viewport?.zoom);
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1,
  };
}

