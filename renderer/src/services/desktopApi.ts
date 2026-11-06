import { t } from '../i18n/index.ts';
import { projectCoverSource } from '../utils/projectCover';
import { createTauriApi } from './tauriApi';
import { withBuiltInSkills, withoutBuiltInSkills } from './builtInSkills';
import { withBuiltInRecipes, withoutBuiltInRecipes } from './builtInRecipes';
import { defaultGenerationModel } from '@/utils/defaultGenerationModels';

// 浏览器替身把项目、素材和设置都存成 localStorage 里的 JSON，结构与桌面实现
// 一样是松散记录；项目树节点按 kind 区分，形状不固定，只按键值记录传递。
type AnyRecord = Record<string, any>;
type BrowserProjectRecord = {
  filePath: string;
  projectDir: string;
  project: AnyRecord;
};

function createBrowserFallback() {
  const recentKey = 'shotloom-recent';
  const browserProjectsKey = 'shotloom-browser-projects';
  const browserFoldersKey = 'shotloom-browser-folders';
  const browserSnapshotsKey = (directory: string) => `shotloom-browser-snapshots:${normalizeBrowserPath(directory)}`;

  const normalizeBrowserPath = (value: unknown) => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const parentBrowserPath = (value: unknown) => normalizeBrowserPath(value).replace(/\/[^/]+$/, '');
  const browserBaseName = (value: unknown) => normalizeBrowserPath(value).split('/').pop() || '';
  const readBrowserProjects = (): Record<string, BrowserProjectRecord> => JSON.parse(localStorage.getItem(browserProjectsKey) || '{}');
  const writeBrowserProjects = (projects: Record<string, BrowserProjectRecord>) => {
    localStorage.setItem(browserProjectsKey, JSON.stringify(projects));
  };
  const readBrowserFolders = (): string[] => JSON.parse(localStorage.getItem(browserFoldersKey) || '[]');
  const writeBrowserFolders = (folders: string[]) => {
    localStorage.setItem(browserFoldersKey, JSON.stringify([...new Set(folders.map(normalizeBrowserPath).filter(Boolean))]));
  };
  const rememberBrowserFolder = (folderDir: string) => {
    const normalized = normalizeBrowserPath(folderDir);
    if (!normalized) return;
    writeBrowserFolders([...readBrowserFolders(), normalized]);
  };
  const uniqueBrowserFolder = (parentDir: string, preferredName: string) => {
    const parent = normalizeBrowserPath(parentDir) || 'browser/projects';
    const name = String(preferredName || t("ui.ProjectCard.text.060f1435")).trim() || t("ui.ProjectCard.text.060f1435");
    const projects = Object.values(readBrowserProjects());
    const occupied = new Set([
      ...readBrowserFolders(),
      ...projects.map((record) => record.projectDir),
    ].map(normalizeBrowserPath));
    let candidate = `${parent}/${name}`;
    let suffix = 2;
    while (occupied.has(candidate)) candidate = `${parent}/${name}-${suffix++}`;
    rememberBrowserFolder(candidate);
    return candidate;
  };
  const listBrowserProjectTree = (rootDir: string) => {
    const root = normalizeBrowserPath(rootDir) || 'browser/projects';
    const projects = Object.values(readBrowserProjects());
    const projectDirs = new Set(projects.map((record) => normalizeBrowserPath(record.projectDir)));
    const folders = new Set(readBrowserFolders().map(normalizeBrowserPath));
    for (const record of projects) {
      let directory = parentBrowserPath(record.projectDir);
      while (directory && directory.startsWith(root)) {
        folders.add(directory);
        if (directory === root) break;
        directory = parentBrowserPath(directory);
      }
    }
    const build = (directory: string): AnyRecord[] => {
      const childProjects: AnyRecord[] = projects
        .filter((record) => parentBrowserPath(record.projectDir) === directory)
        .map((record) => ({
          kind: 'project',
          name: record.project?.name || browserBaseName(record.projectDir),
          filePath: record.filePath,
          projectDir: record.projectDir,
          updatedAt: record.project?.updatedAt,
          coverSource: projectCoverSource(record.project),
        }));
      const childFolders: AnyRecord[] = [...folders]
        .filter((folderDir) =>
          folderDir !== root &&
          parentBrowserPath(folderDir) === directory &&
          !projectDirs.has(folderDir)
        )
        .map((folderDir) => ({
          kind: 'folder',
          name: browserBaseName(folderDir),
          folderDir,
          children: build(folderDir),
        }));
      return [...childFolders, ...childProjects];
    };
    return build(root);
  };

  return {
    platform: 'browser',

    window: {
      minimize: async () => false,
      maximize: async () => false,
      close: async () => false,
      confirmClose: async () => true,
      cancelClose: async () => true,
      isMaximized: async () => false,
      getTitle: async () => document.title,
      createNew: async () => false,
      onMaximizedChange: () => () => {},
      onCloseRequested: () => () => {},
    },
    project: {
      getEditorSnapshot: async (directory: string, nodeId: string): Promise<unknown> => {
        const record = readBrowserProjects()[`${directory}/project.sqlite`];
        return record?.project.editorSnapshots?.[nodeId] ?? null;
      },
      setEditorSnapshot: async (directory: string, nodeId: string, snapshot: unknown) => {
        const projects = readBrowserProjects();
        const record = projects[`${directory}/project.sqlite`];
        if (!record) throw new Error(t("errors.340fefdbc0"));
        record.project.editorSnapshots ||= {};
        record.project.editorSnapshots[nodeId] = snapshot;
        writeBrowserProjects(projects);
        return {saved: true};
      },
      selectParent: async () => 'browser',
      getEditorRecord: async (directory: string, nodeId: string, key: string) => {
        const record = readBrowserProjects()[`${directory}/project.sqlite`];
        return record?.project.editorRecords?.[nodeId]?.[key] ?? null;
      },
      setEditorRecord: async (directory: string, nodeId: string, key: string, value: unknown) => {
        const projects = readBrowserProjects();
        const record = projects[`${directory}/project.sqlite`];
        if (!record) throw new Error(t("errors.340fefdbc0"));
        record.project.editorRecords ||= {};
        const records = record.project.editorRecords[nodeId] ||= {};
        if (value == null) delete records[key]; else records[key] = value;
        writeBrowserProjects(projects);
      },
      // 浏览器预览没有 SQLite：快照按项目目录存在 localStorage，结构保持与桌面一致。
      snapshotList: async (directory: string) => {
        try {
          const rows = JSON.parse(localStorage.getItem(browserSnapshotsKey(directory)) || '[]');
          return (Array.isArray(rows) ? rows : []).map(({ payload: _payload, ...meta }: AnyRecord) => meta);
        } catch { return []; }
      },
      snapshotCreate: async (directory: string, record: AnyRecord) => {
        const key = browserSnapshotsKey(directory);
        let rows: AnyRecord[] = [];
        try { rows = JSON.parse(localStorage.getItem(key) || '[]'); } catch { rows = []; }
        const next = [record, ...(Array.isArray(rows) ? rows : [])].slice(0, 20);
        localStorage.setItem(key, JSON.stringify(next));
        return { saved: true };
      },
      snapshotRead: async (directory: string, id: string) => {
        try {
          const rows = JSON.parse(localStorage.getItem(browserSnapshotsKey(directory)) || '[]');
          return (Array.isArray(rows) ? rows : []).find((row: AnyRecord) => row.id === id)?.payload ?? null;
        } catch { return null; }
      },
      createFolder: async (parentDir: string, folderName: string) => uniqueBrowserFolder(parentDir, folderName),
      createLibraryFolder: async (parentDir: string, folderName: string) => {
        const folderDir = uniqueBrowserFolder(parentDir, folderName);
        return { kind: 'folder', name: browserBaseName(folderDir), folderDir };
      },
      renameEntry: async (entryDir: string, name: string) => {
        const oldDir = normalizeBrowserPath(entryDir);
        const newDir = `${parentBrowserPath(oldDir)}/${String(name || '').trim() || browserBaseName(oldDir)}`;
        const projects = readBrowserProjects();
        const renamedProjects: Record<string, BrowserProjectRecord> = {};
        for (const record of Object.values(projects)) {
          const projectDir = normalizeBrowserPath(record.projectDir);
          const nextProjectDir = projectDir === oldDir || projectDir.startsWith(`${oldDir}/`)
            ? `${newDir}${projectDir.slice(oldDir.length)}`
            : projectDir;
          const filePath = `${nextProjectDir}/project.sqlite`;
          const project = nextProjectDir === newDir
            ? { ...record.project, name: browserBaseName(newDir) }
            : record.project;
          renamedProjects[filePath] = { ...record, projectDir: nextProjectDir, filePath, project };
        }
        writeBrowserProjects(renamedProjects);
        writeBrowserFolders(readBrowserFolders().map((folderDir: string) =>
          folderDir === oldDir || folderDir.startsWith(`${oldDir}/`)
            ? `${newDir}${folderDir.slice(oldDir.length)}`
            : folderDir
        ));
        return { oldDir, newDir, name: browserBaseName(newDir) };
      },
      cloneLibraryFolder: async (folderDir: string) => ({ ok: true, folderDir: `${folderDir}-copy` }),
      exportLibraryFolder: async () => ({ ok: false }),
      trashLibraryFolder: async () => ({ ok: true }),
      createWorkFolder: async (_rootDir: string, workName: string) => ({ kind: 'work', name: workName, workDir: `browser/projects/${workName}` }),
      createSeasonFolder: async (workDir: string, seasonName: string) => ({ kind: 'season', name: seasonName, seasonDir: `${workDir}/${seasonName}`, workDir }),
      createEpisodeFolder: async (parentDir: string, workDir: string, episodeName: string) => ({
        projectDir: `${parentDir}/${episodeName}`,
        seriesDir: workDir,
        assetRootDir: `${workDir}/assets`,
      }),
      save: async (directory: string, project: AnyRecord) => {
        const projectDir = normalizeBrowserPath(directory) || uniqueBrowserFolder('browser/projects', project?.name);
        const filePath = `${projectDir}/project.sqlite`;
        const projects = readBrowserProjects();
        projects[filePath] = {
          filePath,
          projectDir,
          project: JSON.parse(JSON.stringify(project)),
        };
        writeBrowserProjects(projects);
        rememberBrowserFolder(projectDir);
        return { filePath, projectDir, project };
      },
      getDefaultRoot: async () => 'browser/projects',
      ensureRoot: async (rootDir: string) => rootDir || 'browser/projects',
      selectRoot: async () => 'browser/projects',
      listRoot: async (rootDir: string) => listBrowserProjectTree(rootDir),
      migrateRoot: async (projects: AnyRecord[], targetRoot: string) => ({ root: targetRoot || 'browser/projects', projects, recent: projects || [] }),
      exportPackage: async () => ({ ok: false, error: t("browser.unsupported.exportPackage") }),
      importPackage: async () => null,
      openDialog: async () => null,
      openFolderDialog: async () => ({ ok: false, error: t("browser.unsupported.chooseProjectFolder") }),
      openFolder: async () => null,
      readFile: async (filePath: string) => {
        const record = readBrowserProjects()[normalizeBrowserPath(filePath)];
        return record?.project ? JSON.parse(JSON.stringify(record.project)) : null;
      },
      syncCurrent: async () => true,
      getWindowProjectDir: async () => null,
      setWindowProjectDir: async () => true,
      setWindowProjectName: async () => true,
      focusExistingWindow: async () => false,
      focusOtherWindow: async () => false,
      showInFolder: async () => ({ ok: false, error: t("browser.unsupported.openFolder") }),
      cloneFolder: async () => null,
      onCloneProgress: () => () => {},
      trashFolder: async () => ({ ok: false, error: t("browser.unsupported.deleteProjectFolder") }),
    },
    recent: {
      list: async () => JSON.parse(localStorage.getItem(recentKey) || '[]'),
      add: async (project: AnyRecord) => {
        const current = JSON.parse(localStorage.getItem(recentKey) || '[]');
        const next = [project, ...current.filter((item: AnyRecord) => item.filePath !== project.filePath)].slice(0, 20);
        localStorage.setItem(recentKey, JSON.stringify(next));
        return next;
      },
      remove: async (filePath: string) => {
        const next = JSON.parse(localStorage.getItem(recentKey) || '[]')
          .filter((item: AnyRecord) => item.filePath !== filePath);
        localStorage.setItem(recentKey, JSON.stringify(next));
        return next;
      },
    },
    file: {
      pathForFile: (file: AnyRecord) => file?.path || '',
      importAsset: async () => [],
      pickResource: async (_resourceType: string) => null,
      saveJson: async (defaultName: string, data: unknown) => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = defaultName;
        link.click();
        URL.revokeObjectURL(url);
        return { fileName: defaultName };
      },
      saveBinary: async (defaultName: string, bytes: Uint8Array) => {
        const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = defaultName;
        link.click();
        URL.revokeObjectURL(url);
        return { fileName: defaultName };
      },
      exportResourcePackage: async () => ({ ok: false }),
      importResourcePackage: async () => null,
      exportFile: async () => ({ ok: false }),
      exportFilesPackage: async () => ({ ok: false }),
      trimVideo: async () => null,
      exportVideoProject: async () => {
        throw new Error(t("errors.e786f06a66"));
      },
      renderVideoProjectToCanvas: async () => {
        throw new Error(t("errors.d7fe7594ae"));
      },
      newMediaTaskId: () => '',
      cancelMediaTask: async () => false,
      concatVideos: async () => null,
      // 浏览器预览没有 FFmpeg，读不到真实元数据；调用方按 null 走失败路径。
      probeMedia: async (
        _source: string | null | undefined,
      ): Promise<{ duration: number | null; width: number | null; height: number | null }> =>
        ({ duration: null, width: null, height: null }),
      readArrayBuffer: async () => new ArrayBuffer(0),
      readImagePreview: async () => new ArrayBuffer(0),
      applyColoredPencil: async () => {
        throw new Error(t("errors.0aa2072862"));
      },
      cropImageToProject: async () => {
        throw new Error(t("errors.b7e90e14ec"));
      },
      hasAudio: async () => false,
      separateAudioToProject: async () => {
        throw new Error(t("errors.1f1c3baaa7"));
      },
      captureVideoFrameToProject: async () => {
        throw new Error(t("errors.aca0018390"));
      },
      checksum: async () => ({ checksum: '', checksumAlgorithm: 'sha256', size: 0 }),
      getGlobalAssetRoot: async () => 'browser/local-asset-library/blobs',
      trash: async () => ({ ok: false, error: t("browser.unsupported.trash") }),
      getDownloadDir: async () => '',
      selectDownloadDir: async () => '',
      clearDownloadDir: async () => '',
      openFolderPath: async () => ({ ok: false, error: t("browser.unsupported.openFolder") }),
      openProjectAssets: async () => ({ ok: false, error: t("browser.unsupported.openAssets") }),
      showItemInFolder: async () => ({ ok: false, error: t("browser.unsupported.revealFile") }),
      openPath: async () => ({ ok: false, error: t("browser.unsupported.openFile") }),
      pathExists: async () => false,
      resolveUniqueFilePath: async (_dir: string, fileName: string) => fileName,
      writeFileToPath: async (filePath: string, buffer: ArrayBuffer | Uint8Array) => ({ filePath, size: buffer?.byteLength || 0 }),
      copyToProject: async (sourcePath: string, preferredName?: string) => ({
        filePath: sourcePath,
        path: sourcePath,
        name: preferredName || String(sourcePath || '').split(/[\\/]/).pop() || '',
        size: 0,
      }),
      copyToDirectory: async (sourcePath: string, _directory: string, preferredName?: string) => ({
        filePath: sourcePath,
        path: sourcePath,
        name: preferredName || String(sourcePath || '').split(/[/\\]/).pop() || '',
        size: 0,
      }),
      saveDataUrlToProject: async (_dataUrl: string, preferredName?: string) => ({
        filePath: '',
        path: '',
        name: preferredName || 'resource.png',
        size: 0,
      }),
      writeFileChunk: async () => {
        throw new Error(t("errors.3fe609b867"));
      },
      saveArrayBuffer: async () => null,
      downloadUrlToProject: async () => null,
    },
    localAssets: {
      getCatalog: async () => JSON.parse(localStorage.getItem('shotloom-local-assets') || 'null') || {
        storageVersion: 1, materials: [], assets: [], references: [],
      },
      setCatalog: async (catalog: AnyRecord) => {
        localStorage.setItem('shotloom-local-assets', JSON.stringify(catalog));
        return catalog;
      },
    },
    clipboard: {
      stageWorkflow: async (_payload: AnyRecord) => {
        throw new Error(t("errors.5ba0915f4d"));
      },
      readStagedSentinel: async () => null,
      loadStagedPayload: async () => null,
      readMedia: async () => null,
    },
    skills: {
      getGlobal: async () => withBuiltInSkills(JSON.parse(localStorage.getItem('shotloom-global-skills') || 'null') || { storageVersion: 1, skills: [] }),
      setGlobal: async (storage: AnyRecord) => { localStorage.setItem('shotloom-global-skills', JSON.stringify(withoutBuiltInSkills(storage))); return storage; },
    },
    recipes: {
      getGlobal: async () => withBuiltInRecipes(JSON.parse(localStorage.getItem('shotloom-global-recipes') || 'null') || { storageVersion: 1, recipes: [] }),
      setGlobal: async (storage: AnyRecord) => { localStorage.setItem('shotloom-global-recipes', JSON.stringify(withoutBuiltInRecipes(storage))); return withBuiltInRecipes(storage); },
    },
    workflowTemplates: {
      getGlobal: async () => {
        try {
          return JSON.parse(localStorage.getItem('shotloom:workflow-templates') || 'null') || { storageVersion: 1, templates: [] };
        } catch {
          return { storageVersion: 1, templates: [] };
        }
      },
      setGlobal: async (storage: AnyRecord) => {
        localStorage.setItem('shotloom:workflow-templates', JSON.stringify(storage));
        return storage;
      },
    },
    settings: {
      get: async () => JSON.parse(localStorage.getItem('shotloom-settings') || 'null') || {
        storageVersion: 7,
        providerConfigs: {},
        balance: 0,
        rawQuota: 0,
        usedQuota: 0,
        tokenGroups: [],
        activeTokenGroupId: '',
        apiKeyValid: false,
        accountSyncError: '',
        projectRootDir: 'browser/projects',
        modelPollIntervalMs: 1500,
        agentAutoEval: true,
        agentAutoLayout: true,
        agentCanRunNodes: false,
        agentPreferredTextModel: defaultGenerationModel('textGeneration'),
        agentPreferredImageModel: defaultGenerationModel('imageGeneration'),
          agentPreferredVideoModel: defaultGenerationModel('videoGeneration'),
          runtimeProtection: {
            healthIntervalMs: 10000, failureThreshold: 3, failureWindowMs: 300000,
            circuitCooldownMs: 120000, stallWarningMs: 180000, hardCapMs: 1800000,
          },
        canvasActionShortcuts: {
          fitView: { type: 'mouse', button: 'middle', gesture: 'singleClick' },
          autoLayout: { type: 'mouse', button: 'middle', gesture: 'doubleClick' },
        },
        layoutAlgorithm: 'grid-aligned',
        updatedAt: new Date().toISOString(),
      },
      set: async (settings: AnyRecord) => {
        const next = { ...settings, updatedAt: new Date().toISOString() };
        localStorage.setItem('shotloom-settings', JSON.stringify(next));
        return next;
      },
      refreshBalance: async () => {
        const current = JSON.parse(localStorage.getItem('shotloom-settings') || 'null') || {};
        const next = {
          storageVersion: 7,
          providerConfigs: current.providerConfigs || {},
          balance: current.balance || 0,
          rawQuota: current.rawQuota || 0,
          usedQuota: current.usedQuota || 0,
          tokenGroups: current.tokenGroups || [],
          activeTokenGroupId: current.activeTokenGroupId || '',
          apiKeyValid: Object.values((current.providerConfigs || {}) as Record<string, AnyRecord>).some((c) => c?.apiKey?.trim()),
          accountSyncError: '',
          projectRootDir: current.projectRootDir || 'browser/projects',
          modelPollIntervalMs: current.modelPollIntervalMs || 1500,
          agentAutoEval: current.agentAutoEval !== false,
          agentAutoLayout: current.agentAutoLayout !== false,
          agentCanRunNodes: current.agentCanRunNodes === true,
          agentPreferredTextModel: current.agentPreferredTextModel || defaultGenerationModel('textGeneration'),
          agentPreferredImageModel: current.agentPreferredImageModel || defaultGenerationModel('imageGeneration'),
          agentPreferredVideoModel: current.agentPreferredVideoModel || defaultGenerationModel('videoGeneration'),
          runtimeProtection: current.runtimeProtection || {
            healthIntervalMs: 10000, failureThreshold: 3, failureWindowMs: 300000,
            circuitCooldownMs: 120000, stallWarningMs: 180000, hardCapMs: 1800000,
          },
          updatedAt: new Date().toISOString(),
        };
        localStorage.setItem('shotloom-settings', JSON.stringify(next));
        return next;
      },
      setTokenGroup: async (groupId: string) => {
        const current = JSON.parse(localStorage.getItem('shotloom-settings') || 'null') || {};
        const next = { ...current, activeTokenGroupId: groupId, updatedAt: new Date().toISOString() };
        localStorage.setItem('shotloom-settings', JSON.stringify(next));
        return next;
      },
    },
    model: {
      chatCompletion: async () => {
        throw new Error(t("errors.83126b77ac"));
      },
      chatCompletionStream: async () => {
        throw new Error(t("errors.83126b77ac"));
      },
      imageGeneration: async () => {
        throw new Error(t("errors.83126b77ac"));
      },
      videoGeneration: async () => {
        throw new Error(t("errors.83126b77ac"));
      },
      videoTask: async () => {
        throw new Error(t("errors.c53bc7311f"));
      },
    },
    diagnostics: {
      build: async () => {
        throw new Error(t("browser.unsupported.diagnostics"));
      },
    },
    update: {
      check: async () => ({ hasUpdate: false, downloaded: false, info: null }),
      download: async () => ({ ok: false, error: t("browser.unsupported.downloadUpdate") }),
      cancelDownload: async () => ({ ok: true }),
      checkFreshness: async () => ({ superseded: false }),
      executeRestart: async () => ({ ok: false, error: t("browser.unsupported.installUpdate") }),
    },
    notifyTask: async () => ({ shown: false, reason: 'browser' }),
  };
}

const browserFallback = createBrowserFallback();
const isTauri = typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);

export const desktopApi = isTauri ? createTauriApi(browserFallback) : browserFallback;
