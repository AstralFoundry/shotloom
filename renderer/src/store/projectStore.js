import { reactive, toRaw } from '@/store/domainReactivity';
import { desktopApi } from '@/services/desktopApi';
import { uid } from '@/utils/format';
import { showToast } from '@/composables/useToast';
import { cancelTask, runNode } from '@/store/taskStore';
import { selectedNode } from '@/store/nodeStore';
import { settingsStore } from '@/store/settingsStore';
import { generationOutputIssue } from '@/utils/generationResultValidation';
import { summarizeGenerationPayload } from '@/utils/generationPayload';
import { ensureCopilotConversations } from '@/services/copilotConversations.mjs';
import { hasPersistedProject, resolveProjectRoute } from '@/utils/projectNavigation.mjs';
import {
  buildProjectSession,
  hasFullProjectSessionSnapshot,
  PROJECT_SESSION_KEY,
} from '@/utils/projectSession.mjs';
import { LatestSaveQueue } from '@/services/latestSaveQueue.mjs';
import { recordPerformanceMetric } from '@/services/performanceMetrics';
import { expandCopilotArchivesForPersistence } from '@/services/copilotSessionLifecycle.mjs';

const MAX_CANVAS_HISTORY = 8;
const PROJECT_SCHEMA_VERSION = 2;
const CANVAS_NODE_SIZE_SCALE = 0.75;

function createProject(name = '未命名项目') {
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

function normalizeProject(project) {
  project = assertCurrentProjectSchema(project);
  const base = createProject(project?.name || '未命名项目');
  const storedNodeSizeScale = Number(project?.canvasNodeSizeScale) || 1;
  const nodeSizeRatio = CANVAS_NODE_SIZE_SCALE / storedNodeSizeScale;
  const nodes = (Array.isArray(project?.nodes) ? project.nodes : []).map((node) => {
    if (nodeSizeRatio === 1) return node;
    const next = { ...node };
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

function normalizeCanvasViewport(viewport = {}) {
  const x = Number(viewport?.x);
  const y = Number(viewport?.y);
  const zoom = Number(viewport?.zoom);
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1,
  };
}

function restoreSession() {
  try {
    const data = JSON.parse(localStorage.getItem(PROJECT_SESSION_KEY) || 'null');
    if (!data?.project) return null;
    return {
      project: normalizeProject(data.project),
      projectDir: data.projectDir || null,
      filePath: data.filePath || null,
      hasFullProjectSnapshot: hasFullProjectSessionSnapshot(data),
    };
  } catch {
    return null;
  }
}

const restored = restoreSession();
const AUTO_SAVE_DELAY_MS = 1_000;
const AUTO_SAVE_MAX_DELAY_MS = 30_000;
let autoSaveTimer = null;
let autoSaveQueuedAt = 0;
let sessionPersistTimer = null;
const projectSaveQueue = new LatestSaveQueue(
  ({ directory, snapshot }) => desktopApi.project.save(directory, snapshot),
  {
    maxRetryAttempts: 1,
    onMetric: (detail) => recordPerformanceMetric(
      'project.save.queue',
      performance.now() - Number(detail.queueMs || 0),
      detail,
    ),
  },
);
// ── Shared state ────────────────────────────────────────────────────────────

let cleanCloseSnapshot = '';

/**
 * 将当前项目状态标记为"干净"（无未保存更改）。
 * 在保存、新建和打开项目后调用。
 */
function markProjectCleanForClose() {
  cleanCloseSnapshot = JSON.stringify({
    projectId: store.project?.id || '',
    updatedAt: store.project?.updatedAt || '',
    projectDir: store.projectDir,
    filePath: store.filePath,
  });
}

export const store = reactive({
  route: 'projects',
  assetCategory: 'characters',
  assetView: 'card',
  assetKeyword: '',
  selectedNodeId: null,
  selectedNodeIds: [],
  selectedEdgeId: null,
  connectFromId: null,
  recentProjects: [],
  projectLibraryEntries: [],
  cloneProgressByProject: {},
  projectDir: restored?.projectDir || null,
  filePath: restored?.filePath || null,
  project: restored?.project || createProject(),
});

export function hasOpenProject() {
  return hasPersistedProject(store);
}

export function navigateToRoute(route, { notify = true } = {}) {
  const resolvedRoute = resolveProjectRoute(route, store);
  store.route = resolvedRoute;
  if (resolvedRoute !== route && notify) {
    showToast('请先新建或打开一个项目');
  }
  return resolvedRoute === route;
}

function clearActiveProjectSession() {
  if (autoSaveTimer) {
    window.clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
  projectSaveQueue.discardPending();
  store.projectDir = null;
  store.filePath = null;
  store.project = createProject();
  store.selectedNodeId = null;
  store.selectedNodeIds = [];
  store.selectedEdgeId = null;
  store.connectFromId = null;
  store.route = 'projects';
  persistSession();
  markProjectCleanForClose();
}

function projectPersistenceSnapshot() {
  const snapshot = JSON.parse(JSON.stringify(store.project));
  if (Array.isArray(snapshot.copilotConversations)) {
    snapshot.copilotConversations = snapshot.copilotConversations.map((conversation) => ({
      ...conversation,
      messages: Array.isArray(conversation.messages)
        ? conversation.messages.filter((message) => !message?.transient)
        : [],
    }));
  }
  return expandCopilotArchivesForPersistence(snapshot);
}

export function persistSession() {
  const persisted = Boolean(store.projectDir && store.filePath);
  // Persisted projects keep only identity in WebView storage. Avoid cloning
  // every node, task and undo snapshot merely to discard them below.
  const project = persisted ? store.project : projectPersistenceSnapshot();
  const session = buildProjectSession({
    project,
    projectDir: store.projectDir,
    filePath: store.filePath,
  });
  localStorage.setItem(PROJECT_SESSION_KEY, JSON.stringify(session));
  const snapshot = {
    project: session.project,
    projectDir: store.projectDir,
    filePath: store.filePath,
    nodes: persisted ? [] : project.nodes,
    edges: persisted ? [] : project.edges,
    tasks: persisted ? [] : project.tasks,
  };
  desktopApi.project
    .syncCurrent?.({
      project: snapshot.project,
      projectDir: snapshot.projectDir,
      filePath: snapshot.filePath,
      nodes: snapshot.nodes,
      edges: snapshot.edges,
      tasks: snapshot.tasks,
    })
    .catch(() => {});
  desktopApi.project.setWindowProjectName?.(snapshot.project?.name || '未命名项目').catch(() => {});
}

function scheduleSessionPersist(delay = 100, { coalesce = false } = {}) {
  // Progress updates from many concurrent tasks may arrive a few milliseconds
  // apart. Keep the first scheduled flush in that burst instead of repeatedly
  // serializing the complete project between responses.
  if (sessionPersistTimer && coalesce) return;
  if (sessionPersistTimer) window.clearTimeout(sessionPersistTimer);
  sessionPersistTimer = window.setTimeout(() => {
    sessionPersistTimer = null;
    persistSession();
  }, delay);
}

export function touchProject({ sessionDelay = 100, coalesceSession = false } = {}) {
  store.project.updatedAt = new Date().toISOString();
  scheduleSessionPersist(sessionDelay, { coalesce: coalesceSession });
  scheduleAutoSave();
}

export function persistCanvasViewport(viewport) {
  const project = toRaw(store.project);
  project.canvasViewport = viewport;
  project.updatedAt = new Date().toISOString();
  scheduleSessionPersist(400, { coalesce: true });
  scheduleAutoSave();
}

export function isProjectAutoSaveEnabled() {
  return store.project?.settings?.autoSave !== false;
}

function canAutoSaveProject() {
  return Boolean(store.projectDir && isProjectAutoSaveEnabled());
}

function scheduleAutoSave(delay = AUTO_SAVE_DELAY_MS) {
  if (!canAutoSaveProject()) return;
  if (!autoSaveQueuedAt) autoSaveQueuedAt = Date.now();
  const remaining = Math.max(0, AUTO_SAVE_MAX_DELAY_MS - (Date.now() - autoSaveQueuedAt));
  if (autoSaveTimer) window.clearTimeout(autoSaveTimer);
  autoSaveTimer = window.setTimeout(
    () => {
      autoSaveTimer = null;
      flushAutoSave();
    },
    Math.min(delay, remaining),
  );
}

async function writeProjectFile({ updateRecent = false } = {}) {
  const snapshot = projectPersistenceSnapshot();
  const hash = JSON.stringify({ ...snapshot, updatedAt: '' });
  const directory = store.projectDir;
  const projectId = String(snapshot.id || '');
  const result = await projectSaveQueue.enqueue(
    { directory, snapshot },
    { key: `${directory}:${hash}`, scope: String(directory || '') },
  );
  if (store.projectDir !== directory || String(store.project?.id || '') !== projectId) return result;
  if (result.filePath) store.filePath = result.filePath;
  if (updateRecent) {
    await desktopApi.recent.add({
      name: store.project.name,
      folderName: store.project.library?.name || '',
      seriesName: store.project.series?.name || '',
      filePath: store.filePath,
      projectDir: store.projectDir,
    });
  }
  persistSession();
  markProjectCleanForClose();
  return result;
}

export async function flushAutoSave() {
  if (autoSaveTimer) {
    window.clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
  if (!canAutoSaveProject()) return false;
  try {
    await writeProjectFile({ updateRecent: false });
    autoSaveQueuedAt = 0;
    return true;
  } catch (error) {
    showToast(error?.message || '自动保存失败');
    return false;
  }
}

export function initProjectCloneProgressListener() {
  if (initProjectCloneProgressListener.dispose) return;
  initProjectCloneProgressListener.dispose = desktopApi.project.onCloneProgress?.((progress) => {
    if (!progress?.projectDir) return;
    store.cloneProgressByProject[progress.projectDir] = progress;
    if (progress.phase === 'completed' || progress.phase === 'failed') {
      window.setTimeout(
        () => {
          if (store.cloneProgressByProject[progress.projectDir] === progress) {
            delete store.cloneProgressByProject[progress.projectDir];
          }
        },
        progress.phase === 'completed' ? 800 : 2400,
      );
    }
  });
}

export async function loadRecentProjects() {
  try {
    const rootEntries = (await desktopApi.project.listRoot?.(await ensureProjectRoot())) || [];
    const recentProjects = await desktopApi.recent.list();
    const flattenProjects = (entries = []) =>
      entries.flatMap((entry) =>
        entry.kind === 'project' ? [entry] : flattenProjects(entry.children || []),
      );
    const rootedProjects = flattenProjects(rootEntries);
    const rootedPaths = new Set(rootedProjects.map((project) => project.filePath));
    const externalRecent = recentProjects.filter((project) => !rootedPaths.has(project.filePath));
    store.projectLibraryEntries = [
      ...rootEntries,
      ...externalRecent.map((project) => ({ ...project, kind: 'project' })),
    ];
    store.recentProjects = uniqueProjects([...rootedProjects, ...recentProjects]);
  } catch {
    store.recentProjects = [];
    store.projectLibraryEntries = [];
  }
}

export async function createNewProject(name = '未命名项目', options = {}) {
  store.project = createProject(name || '未命名项目');
  const rootDir = await ensureProjectRoot();
  if (options.parentDir) {
    store.projectDir = await desktopApi.project.createFolder(options.parentDir, store.project.name);
    if (options.sharedRootDir) {
      store.project.library = {
        enabled: true,
        name: options.sharedName || '',
        rootDir: options.sharedRootDir,
        assetRootDir: `${String(options.sharedRootDir).replace(/[\\/]$/, '')}/assets`,
      };
    }
  } else if (options.createEpisode) {
    const folder = await desktopApi.project.createEpisodeFolder(
      options.parentDir,
      options.workDir,
      options.episodeName || store.project.name,
    );
    store.projectDir = folder.projectDir;
    store.project.series = {
      enabled: true,
      name: options.workName || store.project.name,
      seasonName: options.seasonName || '',
      rootDir: folder.seriesDir,
      assetRootDir: folder.assetRootDir,
    };
  } else {
    store.projectDir = await desktopApi.project.createFolder(rootDir, store.project.name);
  }
  const result = await desktopApi.project.save(
    store.projectDir,
    JSON.parse(JSON.stringify(store.project)),
  );
  store.filePath = result.filePath;
  store.selectedNodeId = null;
  store.selectedNodeIds = [];
  store.selectedEdgeId = null;
  store.connectFromId = null;
  if (options.openAfterCreate !== false) store.route = 'creation';
  await desktopApi.recent.add({
    name: store.project.name,
    folderName: store.project.library?.name || '',
    seriesName: store.project.series?.name || '',
    filePath: store.filePath,
    projectDir: store.projectDir,
  });
  await loadRecentProjects();
  persistSession();
  markProjectCleanForClose();
  showToast('项目已创建');
}

export async function saveProject() {
  if (!store.projectDir) {
    store.projectDir = await desktopApi.project.createFolder(
      await ensureProjectRoot(),
      store.project.name,
    );
  }

  if (autoSaveTimer) {
    window.clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
  await writeProjectFile({ updateRecent: true });
  await loadRecentProjects();
  showToast('项目已保存');
  return true;
}

export async function openProjectFromDialog() {
  const result = await (desktopApi.project.openFolderDialog
    ? desktopApi.project.openFolderDialog()
    : desktopApi.project.openDialog());
  if (!result) return false;
  if (result.ok === false) {
    showToast(result.error || '项目文件夹无法读取');
    return false;
  }
  if (await focusDuplicateProject(result.projectDir)) return false;
  await applyOpenedProject(result);
  return true;
}

export async function importProjectJsonFromDialog() {
  const result = await desktopApi.project.openDialog();
  if (!result) return false;
  if (await focusDuplicateProject(result.projectDir)) return false;
  await applyOpenedProject(result);
  return true;
}

export async function openRecentProject(filePath) {
  const projectDir = filePath.split(/[\\/]/).slice(0, -1).join('/');
  if (await focusDuplicateProject(projectDir)) return false;
  const project = await desktopApi.project.readFile(filePath);
  await applyOpenedProject({
    project,
    filePath,
    projectDir,
  });
  return true;
}

export async function openProjectInNewWindow(projectDir) {
  if (await desktopApi.project.focusExistingWindow?.(projectDir)) {
    showToast('项目已在窗口中打开');
    return false;
  }
  await desktopApi.window.createNew?.(projectDir);
  return true;
}

export async function showProjectInFolder(projectDir) {
  const result = await desktopApi.project.showInFolder?.(projectDir);
  if (result?.ok === false) showToast(result.error || '无法打开项目目录');
  return result;
}

export async function cloneRecentProject(project) {
  if (!project?.projectDir) {
    showToast('项目目录不存在');
    return null;
  }
  store.cloneProgressByProject[project.projectDir] = {
    projectDir: project.projectDir,
    copiedBytes: 0,
    totalBytes: 0,
    percent: 0,
    phase: 'starting',
  };
  try {
    const result = await desktopApi.project.cloneFolder?.(
      project.projectDir,
      `${project.name || '未命名项目'}-copy`,
    );
    if (!result) {
      showToast('复制项目失败');
      delete store.cloneProgressByProject[project.projectDir];
      return null;
    }
    const clonedFilePath = `${String(result.projectDir || '').replace(/[\\/]$/, '')}/project.shotloom.json`;
    try {
      const cloned = await desktopApi.project.readFile(clonedFilePath);
      if (cloned && typeof cloned === 'object') {
        cloned.id = uid();
        cloned.name = result.name || cloned.name;
        await desktopApi.project.save(result.projectDir, cloned);
      }
    } catch {
      // The folder copy itself succeeded; opening it will still normalize old data.
    }
    await loadRecentProjects();
    showToast(`已复制项目「${result.name || project.name}」`);
    return result;
  } catch (error) {
    store.cloneProgressByProject[project.projectDir] = {
      projectDir: project.projectDir,
      copiedBytes: 0,
      totalBytes: 0,
      percent: 0,
      phase: 'failed',
      error: error?.message || '复制项目失败',
    };
    showToast(error?.message || '复制项目失败');
    return null;
  }
}

export async function exportProjectPackage(project) {
  if (!project?.projectDir) {
    showToast('项目目录不存在');
    return null;
  }
  try {
    const result = await desktopApi.project.exportPackage?.(project.projectDir, project.name);
    if (result?.ok) showToast(`项目包已导出（${result.count || 0} 个文件）`);
    return result;
  } catch (error) {
    showToast(error?.message || '项目包导出失败');
    return null;
  }
}

export async function importProjectPackage() {
  try {
    const imported = await desktopApi.project.importPackage?.(await ensureProjectRoot());
    if (!imported) return false;
    await loadRecentProjects();
    showToast(`项目包已导入（${imported.count || 0} 个文件）`);
    return true;
  } catch (error) {
    showToast(error?.message || '项目包导入失败');
    return false;
  }
}

export async function trashRecentProject(project) {
  if (!project?.projectDir) {
    await removeRecentProject(project?.filePath);
    await loadRecentProjects();
    showToast('已移除无效项目记录');
    return false;
  }

  const deletingCurrentProject = Boolean(
    store.projectDir && project.projectDir === store.projectDir,
  );
  let deletedProjectId = deletingCurrentProject ? store.project?.id : '';
  if (!deletedProjectId && project.filePath) {
    try {
      deletedProjectId = (await desktopApi.project.readFile(project.filePath))?.id || '';
    } catch {
      /* stale entry */
    }
  }
  const previousIdentity = deletingCurrentProject
    ? { projectDir: store.projectDir, filePath: store.filePath }
    : null;

  if (deletingCurrentProject) {
    if (autoSaveTimer) {
      window.clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }
    projectSaveQueue.discardPending();
    await projectSaveQueue.waitForIdle();
    for (const task of store.project.tasks || []) {
      if (['running', 'queued'].includes(task.status)) cancelTask(task.id);
    }
    if (autoSaveTimer) {
      window.clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }
    projectSaveQueue.discardPending();
    // 先解除项目绑定，确保移入废纸篓期间不会被延迟自动保存重新创建。
    store.projectDir = null;
    store.filePath = null;
  }

  try {
    const result = await desktopApi.project.trashFolder?.(project.projectDir, project.filePath);
    if (!result?.ok) {
      if (previousIdentity) {
        store.projectDir = previousIdentity.projectDir;
        store.filePath = previousIdentity.filePath;
        persistSession();
      }
      showToast(result?.error || '删除项目失败');
      return false;
    }

    if (project.filePath) await desktopApi.recent.remove(project.filePath);
    if (deletedProjectId) {
      const { releaseAllLocalAssetReferences } = await import('@/store/localAssetLibraryStore');
      await releaseAllLocalAssetReferences(deletedProjectId);
    }
    if (deletingCurrentProject) {
      store.project = createProject();
      store.selectedNodeId = null;
      store.selectedNodeIds = [];
      store.selectedEdgeId = null;
      store.connectFromId = null;
      store.route = 'projects';
      persistSession();
      markProjectCleanForClose();
    }
    await loadRecentProjects();
    showToast('项目已移到废纸篓');
    return true;
  } catch (error) {
    if (previousIdentity) {
      store.projectDir = previousIdentity.projectDir;
      store.filePath = previousIdentity.filePath;
      persistSession();
    }
    showToast(error?.message || '删除项目失败');
    return false;
  }
}

export async function loadBoundWindowProject() {
  const projectDir = await desktopApi.project.getWindowProjectDir?.();
  if (!projectDir) {
    // 浏览器预览没有窗口级项目绑定，以项目库记录校验恢复会话，避免清空项目库后
    // localStorage 里的旧项目仍然点得进“继续创作”。
    if (desktopApi.platform === 'browser' && hasOpenProject()) {
      const remainsInLibrary = store.recentProjects.some(
        (project) => project.filePath === store.filePath,
      );
      if (!remainsInLibrary) clearActiveProjectSession();
    }
    return false;
  }
  // The project file is authoritative on startup. A restored localStorage
  // session may point at the same directory while containing stale nodes;
  // skipping the read in that case lets the stale session overwrite disk on
  // the first touch/autosave.
  const filePath = `${projectDir.replace(/[\\/]$/, '')}/project.shotloom.json`;
  let timer;
  let project;
  try {
    project = await Promise.race([
      desktopApi.project.readFile(filePath),
      new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(new Error('读取项目文件超时')), 5000);
      }),
    ]);
  } catch (error) {
    // 仅当磁盘上的项目文件仍然存在时，才允许使用同一路径的本地快照应对临时
    // 读取超时。项目已经被移动或删除时必须解除绑定，不能显示一个幽灵项目。
    const fileStillExists = await desktopApi.file.pathExists(filePath).catch(() => false);
    if (!fileStillExists) {
      clearActiveProjectSession();
      return false;
    }
    if (
      restored?.hasFullProjectSnapshot &&
      store.projectDir === projectDir &&
      store.filePath === filePath &&
      store.project
    ) {
      return false;
    }
    throw error;
  } finally {
    if (timer) window.clearTimeout(timer);
  }
  await applyOpenedProject({ project, filePath, projectDir });
  return true;
}

async function applyOpenedProject(result) {
  store.project = normalizeProject(result.project);
  store.projectDir = result.projectDir;
  store.filePath = result.filePath;
  store.selectedNodeId = null;
  store.selectedNodeIds = [];
  store.selectedEdgeId = null;
  store.connectFromId = null;
  store.route = 'creation';
  const { reconcileCurrentProjectLocalAssetReferences } = await import(
    '@/store/localAssetLibraryStore'
  );
  await reconcileCurrentProjectLocalAssetReferences();
  await desktopApi.recent.add({
    name: store.project.name,
    folderName: store.project.library?.name || '',
    seriesName: store.project.series?.name || '',
    filePath: store.filePath,
    projectDir: store.projectDir,
  });
  await loadRecentProjects();
  persistSession();
  markProjectCleanForClose();
  showToast('项目已打开');
}

async function focusDuplicateProject(projectDir) {
  if (!projectDir || store.projectDir === projectDir) return false;
  const focused = await desktopApi.project.focusOtherWindow?.(projectDir);
  if (focused) {
    showToast('项目已在其他窗口打开');
    return true;
  }
  return false;
}

export async function removeRecentProject(filePath) {
  store.recentProjects = await desktopApi.recent.remove(filePath);
}

export async function migrateProjectRoot(targetRoot) {
  const result = await desktopApi.project.migrateRoot?.(store.recentProjects, targetRoot);
  if (!result?.root) return false;
  settingsStore.projectRootDir = result.root;
  const movedCurrent = result.projects?.find(
    (project) =>
      (store.filePath && project.oldFilePath === store.filePath) ||
      (store.projectDir && project.oldProjectDir === store.projectDir),
  );
  if (movedCurrent) {
    store.projectDir = movedCurrent.projectDir;
    store.filePath = movedCurrent.filePath;
    persistSession();
  }
  await loadRecentProjects();
  showToast('项目目录已迁移');
  return true;
}

async function ensureProjectRoot() {
  const root = settingsStore.projectRootDir || (await desktopApi.project.getDefaultRoot?.());
  const ensured = await desktopApi.project.ensureRoot?.(root);
  if (ensured && settingsStore.projectRootDir !== ensured) settingsStore.projectRootDir = ensured;
  return ensured || root || null;
}

function uniqueProjects(projects) {
  const seen = new Set();
  return projects
    .filter((project) => {
      const key = project?.filePath;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(b.lastOpenedAt) - new Date(a.lastOpenedAt));
}

// ── Store facade exports ────────────────────────────────────────────────────

export { showToast } from '@/composables/useToast';
export { filteredAssets, importAssetFiles } from '@/store/assetStore';
export { selectedNode };
export {
  nodeTypeLabel,
  defaultGenerationConfig,
  ensureGenerationConfig,
  addNode,
  deleteNodeById,
  deleteSelectedNode,
  deleteSelectedNodes,
  selectNode,
  selectedNodes,
  setSelectedNodeIds,
  startConnect,
} from '@/store/nodeStore';
export {
  failedTaskStatuses,
  statusLabel,
  statusTone,
  runNode,
  cancelTask,
  cancelNode,
  retryTask,
  retryNode,
  canRetryTask,
  clearTasks,
  isHistoricalModelTask,
  findLatestTaskForNode,
  clearActiveTaskForNode,
} from '@/store/taskStore';
export {
  stageSelectedWorkflow,
  pasteStagedWorkflow,
  captureWorkflowSnapshot,
  importWorkflowTemplate,
} from '@/store/clipboardStore';
export { deleteCanvasNodeData, remapImportedNodeReferences } from '@/store/canvasGraphStore';

// ── Convenience ─────────────────────────────────────────────────────────────

/**
 * 运行当前选中节点。
 */
export function runSelectedNode() {
  const node = selectedNode.value;
  runNode(node);
}

// ── Wire circular dependency: taskStore ↔ runGroup ─────────────────────────

// ── Store accessor ─────────────────────────────────────────────────────────

export function useProjectStore() {
  return { store, selectedNode };
}
