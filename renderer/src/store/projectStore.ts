import { t } from '@/i18n';
import { isRecord } from '@/utils/typeGuards';
import { isActiveTaskStatus } from '@/domain/tasks/TaskStatus';
import { projectCoverSource } from '@/utils/projectCover';
import { bindProjectSource } from '@/services/tauriApi';
import { projectOperationBlockReason } from '@/services/projectOperationGuards';
// 项目状态是数据库回执中的领域记录：recent/clone/desktopApi 回执都按 AnyRecord 进出，
// store 只为顶层导航字段提供最小类型。
import { reactive, toRaw } from '@/store/domainReactivity';
import { desktopApi } from '@/services/desktopApi';
import { uid } from '@/utils/format';
import { showToast, showErrorMessage } from '@/store/notificationStore';
import { cancelTask, stopActiveTaskPolling } from '@/store/taskStore';
import { settingsStore } from '@/store/settingsStore';
import { hasPersistedProject, resolveProjectRoute } from '@/utils/projectNavigation.ts';
import {
  buildProjectSession,
  hasFullProjectSessionSnapshot,
  PROJECT_SESSION_KEY,
} from '@/utils/projectSession.ts';
import { LatestSaveQueue } from '@/services/latestSaveQueue.ts';
import { recordPerformanceMetric } from '@/services/performanceMetrics';
import { restoreMissingGeneratedFiles } from '@/services/generatedResultArchive';
import {
  createProject,
  normalizeProject,
  removeLegacyAgentState,
} from '@/store/projectNormalization';
import {
  captureProjectSnapshot,
  readProjectSnapshot,
  resetProjectSnapshotCache,
} from '@/services/projectSnapshotService';

type AnyRecord = Record<string, any>;

// 克隆进度事件的形状：与桌面桥回执一致，界面按此渲染进度条。
export interface CloneProgressState {
  phase: 'starting' | 'copying' | 'completed' | 'failed';
  percent?: number;
  error?: string;
  [key: string]: unknown;
}

function restoreSession() {
  if (desktopApi.platform !== 'browser') return null;
  try {
    const data: AnyRecord | null = JSON.parse(localStorage.getItem(PROJECT_SESSION_KEY) || 'null');
    if (!data?.project) return null;
    return {
      project: normalizeProject(data.project),
      projectDir: (data.projectDir || null) as string | null,
      filePath: (data.filePath || null) as string | null,
      hasFullProjectSnapshot: hasFullProjectSessionSnapshot(data),
    };
  } catch {
    return null;
  }
}

const restored = restoreSession();
const AUTO_SAVE_DELAY_MS = 1_000;
const AUTO_SAVE_MAX_DELAY_MS = 30_000;
let autoSaveTimer: number | null = null;
let autoSaveQueuedAt = 0;
let sessionPersistTimer: number | null = null;
const savedRevisions = new Map<string, number>();
const projectSaveQueue = new LatestSaveQueue(
  async ({ directory, snapshot }: AnyRecord) => {
    // Queued snapshots may have been captured before the preceding save completed.
    // Advance only by revisions successfully committed by this queue.
    const revision = savedRevisions.get(directory);
    const outgoing = revision === undefined ? snapshot : {
      ...snapshot, storageRevision: Math.max(Number(snapshot.storageRevision || 0), revision),
    };
    const result = await desktopApi.project.save(directory, outgoing);
    if (Number.isInteger(result.project?.storageRevision)) savedRevisions.set(directory, result.project.storageRevision);
    // 快照是保存的旁路产物：失败不影响这次保存，也不阻塞后续写入。
    if (directory && result?.project) void captureProjectSnapshot(directory, outgoing);
    return result;
  },
  {
    maxRetryAttempts: 1,
    onMetric: (detail: AnyRecord) => recordPerformanceMetric(
      'project.save.queue',
      performance.now() - Number(detail.queueMs || 0),
      detail,
    ),
  },
);
// 绕过队列的直接保存会与自动保存交错提交，让后发的旧快照撞上乐观锁，
// 被后端判成「另一窗口修改」。所有工程写入都走这条队列。
function saveProjectSerialized(
  directory: string | null,
  snapshot: AnyRecord,
): Promise<AnyRecord> {
  return projectSaveQueue.enqueue({ directory, snapshot }, { scope: String(directory || '') });
}
// ── Shared state ────────────────────────────────────────────────────────────

export const store = reactive({
  route: 'projects',
  assetCategory: 'characters',
  assetView: 'card',
  assetKeyword: '',
  selectedNodeId: null as string | null,
  selectedNodeIds: [] as string[],
  selectedEdgeId: null as string | null,
  connectFromId: null as string | null,
  recentProjects: [] as AnyRecord[],
  projectLibraryEntries: [] as AnyRecord[],
  cloneProgressByProject: {} as Record<string, CloneProgressState>,
  projectDir: (restored?.projectDir || null) as string | null,
  filePath: (restored?.filePath || null) as string | null,
  project: restored?.project || createProject(),
});

bindProjectSource(() => store);

export function hasOpenProject() {
  return hasPersistedProject(store);
}

export function navigateToRoute(route: string, { notify = true }: { notify?: boolean } = {}) {
  const resolvedRoute = resolveProjectRoute(route, store);
  if (resolvedRoute !== store.route && !canChangeProjectContext()) return false;
  store.route = resolvedRoute;
  if (resolvedRoute !== route && notify) {
    showToast(t('project.openFirst'));
  }
  return resolvedRoute === route;
}

function canChangeProjectContext() {
  const reason = projectOperationBlockReason(store.project);
  if (reason) showToast(reason);
  return !reason;
}

function clearActiveProjectSession() {
  stopActiveTaskPolling();
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
}

export function projectPersistenceSnapshot() {
  const startedAt = performance.now();
  // Official session persistence in SQLite owns conversation history.
  const snapshot: AnyRecord = JSON.parse(JSON.stringify(store.project));
  removeLegacyAgentState(snapshot);
  const result = snapshot;
  recordPerformanceMetric('project.snapshot.build', startedAt, {
    nodeCount: Array.isArray(result.nodes) ? result.nodes.length : 0,
    edgeCount: Array.isArray(result.edges) ? result.edges.length : 0,
    taskCount: Array.isArray(result.tasks) ? result.tasks.length : 0,
  });
  return result;
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
  if (desktopApi.platform === 'browser') localStorage.setItem(PROJECT_SESSION_KEY, JSON.stringify(session));
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
  desktopApi.project.setWindowProjectName?.(snapshot.project?.name || t("ui.ProjectCard.text.060f1435")).catch(() => {});
}

function scheduleSessionPersist(delay = 100, { coalesce = false }: { coalesce?: boolean } = {}) {
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

export function touchProject({ sessionDelay = 100, coalesceSession = false }: { sessionDelay?: number; coalesceSession?: boolean } = {}) {
  store.project.updatedAt = new Date().toISOString();
  scheduleSessionPersist(sessionDelay, { coalesce: coalesceSession });
  scheduleAutoSave();
}

export function persistCanvasViewport(viewport: AnyRecord) {
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

async function writeProjectFile({ updateRecent = false }: { updateRecent?: boolean } = {}) {
  const snapshot = projectPersistenceSnapshot();
  const hash = JSON.stringify({ ...snapshot, updatedAt: '' });
  const directory = store.projectDir;
  const projectId = String(snapshot.id || '');
  const result: AnyRecord = await projectSaveQueue.enqueue(
    { directory, snapshot },
    { key: `${directory}:${hash}`, scope: String(directory || '') },
  );
  if (store.projectDir !== directory || String(store.project?.id || '') !== projectId) return result;
  if (result.filePath) store.filePath = result.filePath;
  if (Number.isInteger(result.project?.storageRevision)) store.project.storageRevision = result.project.storageRevision;
  if (updateRecent) {
    await desktopApi.recent.add({
      name: store.project.name,
      coverSource: projectCoverSource(store.project),
      folderName: store.project.library?.name || '',
      seriesName: store.project.series?.name || '',
      filePath: store.filePath,
      projectDir: store.projectDir,
    });
  }
  persistSession();
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
    showErrorMessage((error as AnyRecord)?.message || t('project.autosaveAdvice'), t('project.autosaveFailed'));
    return false;
  }
}

/**
 * 目标自动续行的 checkpoint-before-drive：在派发下一轮之前，把投影尾日志压实并落盘，
 * 保证「已消耗的轮次」先于任何模型回合持久化。没有可落盘目录（浏览器预览）时视为已 checkpoint，
 * 不阻断运行；真实落盘失败返回 false，调用方据此收手而不是假装成功。
 */
export async function flushProjectCheckpoint(options: { force?: boolean } = {}): Promise<boolean> {
  if (options.force ? !store.projectDir : !canAutoSaveProject()) return true;
  try {
    await writeProjectFile({ updateRecent: false });
    autoSaveQueuedAt = 0;
    return true;
  } catch {
    return false;
  }
}

let cloneProgressDisposable: unknown = null;

export function initProjectCloneProgressListener() {
  if (cloneProgressDisposable) return;
  cloneProgressDisposable = desktopApi.project.onCloneProgress?.((progress: AnyRecord) => {
    if (!progress?.projectDir) return;
    store.cloneProgressByProject[progress.projectDir] = progress as CloneProgressState;
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
    const flattenProjects = (entries: AnyRecord[] = []): AnyRecord[] =>
      entries.flatMap((entry: AnyRecord) =>
        entry.kind === 'project' ? [entry] : flattenProjects(entry.children || []),
      );
    const rootedProjects = flattenProjects(rootEntries);
    const rootedPaths = new Set<string>(rootedProjects.map((project: AnyRecord) => project.filePath));
    const externalRecent = recentProjects.filter((project: AnyRecord) => !rootedPaths.has(project.filePath));
    store.projectLibraryEntries = [
      ...rootEntries,
      ...externalRecent.map((project: AnyRecord) => ({ ...project, kind: 'project' })),
    ];
    store.recentProjects = uniqueProjects([...rootedProjects, ...recentProjects]);
  } catch {
    store.recentProjects = [];
    store.projectLibraryEntries = [];
  }
}

export async function createNewProject(name = t("ui.ProjectCard.text.060f1435"), options: AnyRecord = {}) {
  if (!canChangeProjectContext()) return false;
  stopActiveTaskPolling();
  // 目录创建/保存失败时必须回滚：否则这个空白项目会绑在旧项目的 projectDir/
  // filePath 上，下一次 touchProject 自动保存就会用空白项目覆盖原项目。
  const previous = { project: store.project, projectDir: store.projectDir, filePath: store.filePath };
  store.project = createProject(name || t("ui.ProjectCard.text.060f1435"));
  store.projectDir = null;
  store.filePath = null;
  try {
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
    const result: AnyRecord = await saveProjectSerialized(
      store.projectDir,
      JSON.parse(JSON.stringify(store.project)),
    );
    store.filePath = result.filePath;
    if (Number.isInteger(result.project?.storageRevision)) store.project.storageRevision = result.project.storageRevision;
  } catch (error) {
    store.project = previous.project;
    store.projectDir = previous.projectDir;
    store.filePath = previous.filePath;
    persistSession();
    showErrorMessage((error as AnyRecord)?.message || t('project.cannotCreate'), t('project.createFailed'));
    throw error;
  }
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
  showToast(t('project.created'), 'success');
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
  showToast(t('project.saved'), 'success');
  return true;
}

export async function openProjectFromDialog() {
  if (!canChangeProjectContext()) return false;
  const result = await (desktopApi.project.openFolderDialog
    ? desktopApi.project.openFolderDialog()
    : desktopApi.project.openDialog());
  if (!result) return false;
  if (result.ok === false) {
    showErrorMessage(result.error || t('project.unreadable'), t('project.openFailed'));
    return false;
  }
  if (await focusDuplicateProject(result.projectDir)) return false;
  return applyOpenedProject(result);
}

export async function importProjectJsonFromDialog() {
  if (!canChangeProjectContext()) return false;
  const result = await desktopApi.project.openDialog();
  if (!result) return false;
  if (await focusDuplicateProject(result.projectDir)) return false;
  return applyOpenedProject(result);
}

export async function openRecentProject(filePath: string) {
  if (!canChangeProjectContext()) return false;
  const projectDir = filePath.split(/[\\/]/).slice(0, -1).join('/');
  if (await focusDuplicateProject(projectDir)) return false;
  const startedAt = performance.now();
  let project;
  try {
    project = await desktopApi.project.readFile(filePath);
    if (!isRecord(project)) throw new Error(t("errors.e1c885621d"));
  } finally {
    recordPerformanceMetric('project.open.read', startedAt);
  }
  return applyOpenedProject({
    project,
    filePath,
    projectDir,
  });
}

export async function openProjectInNewWindow(projectDir: string) {
  if (await desktopApi.project.focusExistingWindow?.(projectDir)) {
    showToast(t('project.alreadyOpen'));
    return false;
  }
  const created = await desktopApi.window.createNew?.(projectDir);
  if (!created) throw new Error(t("errors.8547c2a351"));
  return true;
}

export async function showProjectInFolder(projectDir: string) {
  const result = await desktopApi.project.showInFolder?.(projectDir);
  if (result?.ok === false) showErrorMessage(result.error || t('project.cannotOpenFolder'), t('project.openFolderFailed'));
  return result;
}

export async function cloneRecentProject(project: AnyRecord) {
  if (!project?.projectDir) {
    showToast(t('project.missingFolder'));
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
      t("ui.projectStore.text.0d401e8e", { value0: String(project.name || t("ui.ProjectCard.text.060f1435")) }),
    );
    if (!result) {
      showErrorMessage(t('project.copyAdvice'), t('project.copyFailed'));
      delete store.cloneProgressByProject[project.projectDir];
      return null;
    }
    const clonedFilePath = `${String(result.projectDir || '').replace(/[\\/]$/, '')}/project.sqlite`;
    try {
      const cloned = await desktopApi.project.readFile(clonedFilePath);
      if (cloned && typeof cloned === 'object') {
        cloned.id = uid();
        cloned.name = result.name || cloned.name;
        await saveProjectSerialized(result.projectDir, cloned);
      }
    } catch {
      // The folder copy itself succeeded; opening it will still normalize old data.
    }
    await loadRecentProjects();
    showToast(t('project.copied', { name: result.name || project.name }), 'success');
    return result;
  } catch (error) {
    store.cloneProgressByProject[project.projectDir] = {
      projectDir: project.projectDir,
      copiedBytes: 0,
      totalBytes: 0,
      percent: 0,
      phase: 'failed',
      error: (error as AnyRecord)?.message || t('project.copyFailed'),
    };
    showErrorMessage((error as AnyRecord)?.message || t('project.cannotCopy'), t('project.copyFailed'));
    return null;
  }
}

export async function exportProjectPackage(project: AnyRecord) {
  if (!project?.projectDir) {
    showToast(t('project.missingFolder'));
    return null;
  }
  try {
    const result = await desktopApi.project.exportPackage?.(project.projectDir, project.name);
    if (result?.ok) showToast(t('project.exported', { count: result.count || 0 }), 'success');
    return result;
  } catch (error) {
    showErrorMessage((error as AnyRecord)?.message || t('project.cannotWritePackage'), t('project.exportFailed'));
    return null;
  }
}

export async function importProjectPackage() {
  try {
    const imported = await desktopApi.project.importPackage?.(await ensureProjectRoot());
    if (!imported) return false;
    await loadRecentProjects();
    showToast(t('project.imported', { count: imported.count || 0 }), 'success');
    return true;
  } catch (error) {
    showErrorMessage((error as AnyRecord)?.message || t('project.cannotReadPackage'), t('project.importFailed'));
    return false;
  }
}

export async function trashRecentProject(project: AnyRecord) {
  if (!project?.projectDir) {
    await removeRecentProject(project?.filePath);
    await loadRecentProjects();
    showToast(t('project.invalidRemoved'));
    return false;
  }

  const deletingCurrentProject = Boolean(
    store.projectDir && project.projectDir === store.projectDir,
  );
  if (deletingCurrentProject && !canChangeProjectContext()) return false;
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
      if (isActiveTaskStatus(task.status)) cancelTask(task.id);
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
      showErrorMessage(result?.error || t('project.cannotTrash'), t('project.deleteFailed'));
      return false;
    }

    if (project.filePath) await desktopApi.recent.remove(project.filePath);
    if (deletedProjectId) {
      const { releaseAllLocalAssetReferences } = await import('@/store/localAssetLibraryStore');
      await releaseAllLocalAssetReferences(deletedProjectId);
      try { window.localStorage.removeItem(`shotloom:director-workspace:${deletedProjectId}`); } catch { /* browser storage unavailable */ }
    }
    if (deletingCurrentProject) {
      stopActiveTaskPolling();
      store.project = createProject();
      store.selectedNodeId = null;
      store.selectedNodeIds = [];
      store.selectedEdgeId = null;
      store.connectFromId = null;
      store.route = 'projects';
      persistSession();
    }
    await loadRecentProjects();
    showToast(t('project.trashed'), 'success');
    return true;
  } catch (error) {
    if (previousIdentity) {
      store.projectDir = previousIdentity.projectDir;
      store.filePath = previousIdentity.filePath;
      persistSession();
    }
    showErrorMessage((error as AnyRecord)?.message || t('project.cannotTrash'), t('project.deleteFailed'));
    return false;
  }
}

/** Move a library folder and all its projects together, releasing their external references. */
export async function trashProjectLibraryFolder(folderDir: string, projects: Array<{ filePath?: string; id?: string }>): Promise<boolean> {
  const withinFolder = (path: string | null) => Boolean(path && (path === folderDir || path.startsWith(`${folderDir}/`) || path.startsWith(`${folderDir}\\`)));
  const deletingCurrent = withinFolder(store.projectDir);
  if (deletingCurrent && !canChangeProjectContext()) return false;
  const identities = await Promise.all(projects.map(async (project) => {
    if (project.id) return { ...project, id: project.id };
    try { return { ...project, id: project.filePath ? (await desktopApi.project.readFile(project.filePath))?.id : '' }; }
    catch { return { ...project, id: '' }; }
  }));
  const previous = deletingCurrent ? { projectDir: store.projectDir, filePath: store.filePath } : null;
  if (deletingCurrent) {
    if (autoSaveTimer) window.clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
    projectSaveQueue.discardPending();
    await projectSaveQueue.waitForIdle();
    for (const task of store.project.tasks || []) if (isActiveTaskStatus(task.status)) cancelTask(task.id);
    if (autoSaveTimer) window.clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
    projectSaveQueue.discardPending();
    store.projectDir = null;
    store.filePath = null;
  }
  let moved = false;
  try {
    const result = await desktopApi.project.trashLibraryFolder(folderDir);
    if (!result?.ok) {
      if (previous) {
        store.projectDir = previous.projectDir;
        store.filePath = previous.filePath;
        persistSession();
      }
      showToast(result?.error || t('project.cannotTrash'));
      return false;
    }
    moved = true;
    const { releaseAllLocalAssetReferences } = await import('@/store/localAssetLibraryStore');
    for (const project of identities) {
      if (project.filePath) await desktopApi.recent.remove(project.filePath).catch(() => {});
      if (project.id) {
        await releaseAllLocalAssetReferences(project.id).catch(() => {});
        try { window.localStorage.removeItem(`shotloom:director-workspace:${project.id}`); } catch { /* browser storage unavailable */ }
      }
    }
    if (deletingCurrent) clearActiveProjectSession();
    await loadRecentProjects();
    showToast(t('project.trashed'), 'success');
    return true;
  } catch (error) {
    if (previous && !moved) {
      store.projectDir = previous.projectDir;
      store.filePath = previous.filePath;
      persistSession();
    }
    if (moved) {
      if (deletingCurrent) clearActiveProjectSession();
      await loadRecentProjects();
      showToast(`文件夹已移入废纸篓，但清理部分关联数据失败：${String(error)}`);
      return true;
    }
    showToast(String(error));
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
        (project: AnyRecord) => project.filePath === store.filePath,
      );
      if (!remainsInLibrary) clearActiveProjectSession();
    }
    return false;
  }
  // The project file is authoritative on startup. A restored localStorage
  // session may point at the same directory while containing stale nodes;
  // skipping the read in that case lets the stale session overwrite disk on
  // the first touch/autosave.
  const filePath = `${projectDir.replace(/[\\/]$/, '')}/project.sqlite`;
  let timer: number | undefined;
  let project: AnyRecord;
  try {
    project = await Promise.race([
      desktopApi.project.readFile(filePath),
      new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(t("errors.3f01e4cb6f"))), 5000);
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
  return applyOpenedProject({ project, filePath, projectDir });
}

/**
 * 恢复到指定快照。
 *
 * 顺序固定：先给「当前内容」写一份 before_restore 备份，再读取目标快照并替换，
 * 最后按正常保存链路落盘。任何一步失败都不替换当前内容，避免把用户卡在半途。
 */
export async function restoreProjectSnapshot(snapshotId: string) {
  const directory = store.projectDir;
  if (!directory) return { ok: false, reason: 'no-project-dir' as const };
  if (!canChangeProjectContext()) return { ok: false, reason: 'busy' as const };
  await captureProjectSnapshot(directory, projectPersistenceSnapshot(), {
    reason: 'before_restore',
    force: true,
  });
  const payload = await readProjectSnapshot(directory, snapshotId);
  if (!payload) return { ok: false, reason: 'missing' as const };
  let next: AnyRecord;
  try {
    next = normalizeProject(payload);
  } catch {
    // 快照内容不合法（旧格式或人工改坏）时保持当前项目不动。
    return { ok: false, reason: 'invalid' as const };
  }
  stopActiveTaskPolling();
  store.project = next;
  store.selectedNodeId = null;
  store.selectedNodeIds = [];
  store.selectedEdgeId = null;
  store.connectFromId = null;
  await writeProjectFile({ updateRecent: true });
  resetProjectSnapshotCache(directory);
  return { ok: true as const };
}

async function applyOpenedProject(result: AnyRecord) {
  if (!canChangeProjectContext()) return false;
  stopActiveTaskPolling();
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
  const restoration = await restoreMissingGeneratedFiles(store.project);
  if (restoration.restored) {
    store.project.updatedAt = new Date().toISOString();
    const saved: AnyRecord = await saveProjectSerialized(
      store.projectDir,
      projectPersistenceSnapshot(),
    );
    if (saved?.filePath) store.filePath = saved.filePath;
    if (Number.isInteger(saved?.project?.storageRevision)) store.project.storageRevision = saved.project.storageRevision;
    showToast(t('project.restored', { count: restoration.restored }));
  }
  if (restoration.failures.length) {
    showErrorMessage(t('project.restoreFailed', { count: restoration.failures.length }), t('project.restorePartial'));
  }
  await desktopApi.recent.add({
    name: store.project.name,
    folderName: store.project.library?.name || '',
    seriesName: store.project.series?.name || '',
    filePath: store.filePath,
    projectDir: store.projectDir,
  });
  await loadRecentProjects();
  persistSession();
  showToast(t('project.opened'), 'success');
  return true;
}

async function focusDuplicateProject(projectDir: string) {
  if (!projectDir || store.projectDir === projectDir) return false;
  const focused = await desktopApi.project.focusOtherWindow?.(projectDir);
  if (focused) {
    showToast(t('project.openElsewhere'));
    return true;
  }
  return false;
}

export async function removeRecentProject(filePath: string) {
  store.recentProjects = await desktopApi.recent.remove(filePath);
}

export async function migrateProjectRoot(targetRoot: string) {
  const result = await desktopApi.project.migrateRoot?.(store.recentProjects, targetRoot);
  if (!result?.root) return false;
  settingsStore.projectRootDir = result.root;
  const movedCurrent = result.projects?.find(
    (project: AnyRecord) =>
      (store.filePath && project.oldFilePath === store.filePath) ||
      (store.projectDir && project.oldProjectDir === store.projectDir),
  );
  if (movedCurrent) {
    store.projectDir = movedCurrent.projectDir;
    store.filePath = movedCurrent.filePath;
    persistSession();
  }
  await loadRecentProjects();
  showToast(t('project.migrated'), 'success');
  return true;
}

async function ensureProjectRoot() {
  const root = settingsStore.projectRootDir || (await desktopApi.project.getDefaultRoot?.());
  const ensured = await desktopApi.project.ensureRoot?.(root);
  if (ensured && settingsStore.projectRootDir !== ensured) settingsStore.projectRootDir = ensured;
  return ensured || root || null;
}

function uniqueProjects(projects: AnyRecord[]) {
  const seen = new Set<string>();
  return projects
    .filter((project: AnyRecord) => {
      const key = project?.filePath;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime());
}
