import { createTauriApi } from './tauriApi';
import { withBuiltInSkills, withoutBuiltInSkills } from './builtInSkills';
import { withBuiltInRecipes, withoutBuiltInRecipes } from './builtInRecipes';

function createBrowserFallback() {
  const recentKey = 'shotloom-recent';
  const browserProjectsKey = 'shotloom-browser-projects';
  const browserFoldersKey = 'shotloom-browser-folders';

  const normalizeBrowserPath = (value) => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const parentBrowserPath = (value) => normalizeBrowserPath(value).replace(/\/[^/]+$/, '');
  const browserBaseName = (value) => normalizeBrowserPath(value).split('/').pop() || '';
  const readBrowserProjects = () => JSON.parse(localStorage.getItem(browserProjectsKey) || '{}');
  const writeBrowserProjects = (projects) => {
    localStorage.setItem(browserProjectsKey, JSON.stringify(projects));
  };
  const readBrowserFolders = () => JSON.parse(localStorage.getItem(browserFoldersKey) || '[]');
  const writeBrowserFolders = (folders) => {
    localStorage.setItem(browserFoldersKey, JSON.stringify([...new Set(folders.map(normalizeBrowserPath).filter(Boolean))]));
  };
  const rememberBrowserFolder = (folderDir) => {
    const normalized = normalizeBrowserPath(folderDir);
    if (!normalized) return;
    writeBrowserFolders([...readBrowserFolders(), normalized]);
  };
  const uniqueBrowserFolder = (parentDir, preferredName) => {
    const parent = normalizeBrowserPath(parentDir) || 'browser/projects';
    const name = String(preferredName || '未命名项目').trim() || '未命名项目';
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
  const listBrowserProjectTree = (rootDir) => {
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
    const build = (directory) => {
      const childProjects = projects
        .filter((record) => parentBrowserPath(record.projectDir) === directory)
        .map((record) => ({
          kind: 'project',
          name: record.project?.name || browserBaseName(record.projectDir),
          filePath: record.filePath,
          projectDir: record.projectDir,
          updatedAt: record.project?.updatedAt,
        }));
      const childFolders = [...folders]
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
      selectParent: async () => 'browser',
      createFolder: async (parentDir, folderName) => uniqueBrowserFolder(parentDir, folderName),
      createLibraryFolder: async (parentDir, folderName) => {
        const folderDir = uniqueBrowserFolder(parentDir, folderName);
        return { kind: 'folder', name: browserBaseName(folderDir), folderDir };
      },
      renameEntry: async (entryDir, name) => {
        const oldDir = normalizeBrowserPath(entryDir);
        const newDir = `${parentBrowserPath(oldDir)}/${String(name || '').trim() || browserBaseName(oldDir)}`;
        const projects = readBrowserProjects();
        const renamedProjects = {};
        for (const record of Object.values(projects)) {
          const projectDir = normalizeBrowserPath(record.projectDir);
          const nextProjectDir = projectDir === oldDir || projectDir.startsWith(`${oldDir}/`)
            ? `${newDir}${projectDir.slice(oldDir.length)}`
            : projectDir;
          const filePath = `${nextProjectDir}/project.shotloom.json`;
          const project = nextProjectDir === newDir
            ? { ...record.project, name: browserBaseName(newDir) }
            : record.project;
          renamedProjects[filePath] = { ...record, projectDir: nextProjectDir, filePath, project };
        }
        writeBrowserProjects(renamedProjects);
        writeBrowserFolders(readBrowserFolders().map((folderDir) =>
          folderDir === oldDir || folderDir.startsWith(`${oldDir}/`)
            ? `${newDir}${folderDir.slice(oldDir.length)}`
            : folderDir
        ));
        return { oldDir, newDir, name: browserBaseName(newDir) };
      },
      cloneLibraryFolder: async (folderDir) => ({ ok: true, folderDir: `${folderDir}-copy` }),
      exportLibraryFolder: async () => ({ ok: false }),
      trashLibraryFolder: async () => ({ ok: true }),
      createWorkFolder: async (_rootDir, workName) => ({ kind: 'work', name: workName, workDir: `browser/projects/${workName}` }),
      createSeasonFolder: async (workDir, seasonName) => ({ kind: 'season', name: seasonName, seasonDir: `${workDir}/${seasonName}`, workDir }),
      createEpisodeFolder: async (parentDir, workDir, episodeName) => ({
        projectDir: `${parentDir}/${episodeName}`,
        seriesDir: workDir,
        assetRootDir: `${workDir}/assets`,
      }),
      save: async (directory, project) => {
        const projectDir = normalizeBrowserPath(directory) || uniqueBrowserFolder('browser/projects', project?.name);
        const filePath = `${projectDir}/project.shotloom.json`;
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
      ensureRoot: async (rootDir) => rootDir || 'browser/projects',
      selectRoot: async () => 'browser/projects',
      listRoot: async (rootDir) => listBrowserProjectTree(rootDir),
      migrateRoot: async (projects, targetRoot) => ({ root: targetRoot || 'browser/projects', projects, recent: projects || [] }),
      exportPackage: async () => ({ ok: false, error: '浏览器预览不支持导出项目包。' }),
      importPackage: async () => null,
      openDialog: async () => null,
      openFolderDialog: async () => ({ ok: false, error: '浏览器预览不支持选择项目文件夹。' }),
      openFolder: async () => null,
      readFile: async (filePath) => {
        const record = readBrowserProjects()[normalizeBrowserPath(filePath)];
        return record?.project ? JSON.parse(JSON.stringify(record.project)) : null;
      },
      syncCurrent: async () => true,
      getWindowProjectDir: async () => null,
      setWindowProjectDir: async () => true,
      setWindowProjectName: async () => true,
      focusExistingWindow: async () => false,
      focusOtherWindow: async () => false,
      showInFolder: async () => ({ ok: false, error: '浏览器预览不支持打开目录。' }),
      cloneFolder: async () => null,
      onCloneProgress: () => () => {},
      trashFolder: async () => ({ ok: false, error: '浏览器预览不支持删除项目目录。' }),
    },
    recent: {
      list: async () => JSON.parse(localStorage.getItem(recentKey) || '[]'),
      add: async (project) => {
        const current = JSON.parse(localStorage.getItem(recentKey) || '[]');
        const next = [project, ...current.filter((item) => item.filePath !== project.filePath)].slice(0, 20);
        localStorage.setItem(recentKey, JSON.stringify(next));
        return next;
      },
      remove: async (filePath) => {
        const next = JSON.parse(localStorage.getItem(recentKey) || '[]')
          .filter((item) => item.filePath !== filePath);
        localStorage.setItem(recentKey, JSON.stringify(next));
        return next;
      },
    },
    file: {
      pathForFile: (file) => file?.path || '',
      importAsset: async () => [],
      pickResource: async (_resourceType) => null,
      saveJson: async (defaultName, data) => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
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
        throw new Error('浏览器预览不支持多轨视频导出，请在桌面应用中使用。');
      },
      concatVideos: async () => null,
      probeMedia: async () => ({ duration: null, width: null, height: null }),
      readArrayBuffer: async () => new ArrayBuffer(0),
      readImagePreview: async () => new ArrayBuffer(0),
      applyColoredPencil: async () => {
        throw new Error('浏览器预览不支持本地彩铅处理，请在桌面应用中使用。');
      },
      cropImageToProject: async () => {
        throw new Error('浏览器预览不支持图片裁剪，请在桌面应用中使用。');
      },
      hasAudio: async () => false,
      separateAudioToProject: async () => {
        throw new Error('浏览器预览不支持音频分离，请在桌面应用中使用。');
      },
      checksum: async () => ({ checksum: '', checksumAlgorithm: 'sha256', size: 0 }),
      getGlobalAssetRoot: async () => 'browser/local-asset-library/blobs',
      trash: async () => ({ ok: false, error: '浏览器预览不支持移入回收站。' }),
      getDownloadDir: async () => '',
      selectDownloadDir: async () => '',
      clearDownloadDir: async () => '',
      openFolderPath: async () => ({ ok: false, error: '浏览器预览不支持打开目录。' }),
      openProjectAssets: async () => ({ ok: false, error: '浏览器预览不支持打开项目资源目录。' }),
      showItemInFolder: async () => ({ ok: false, error: '浏览器预览不支持定位文件。' }),
      openPath: async () => ({ ok: false, error: '浏览器预览不支持打开文件。' }),
      pathExists: async () => false,
      resolveUniqueFilePath: async (_dir, fileName) => fileName,
      writeFileToPath: async (filePath, buffer) => ({ filePath, size: buffer?.byteLength || 0 }),
      copyToProject: async (sourcePath, preferredName) => ({
        filePath: sourcePath,
        path: sourcePath,
        name: preferredName || String(sourcePath || '').split(/[\\/]/).pop() || '',
        size: 0,
      }),
      copyToDirectory: async (sourcePath, _directory, preferredName) => ({
        filePath: sourcePath,
        path: sourcePath,
        name: preferredName || String(sourcePath || '').split(/[/\\]/).pop() || '',
        size: 0,
      }),
      saveDataUrlToProject: async (_dataUrl, preferredName) => ({
        filePath: '',
        path: '',
        name: preferredName || 'resource.png',
        size: 0,
      }),
      writeFileChunk: async (filePath, chunk) => ({ filePath, size: chunk?.byteLength || 0 }),
      saveArrayBuffer: async () => null,
      downloadUrlToProject: async () => null,
    },
    localAssets: {
      getCatalog: async () => JSON.parse(localStorage.getItem('shotloom-local-assets') || 'null') || {
        storageVersion: 1, materials: [], assets: [], references: [],
      },
      setCatalog: async (catalog) => {
        localStorage.setItem('shotloom-local-assets', JSON.stringify(catalog));
        return catalog;
      },
    },
    clipboard: {
      stageWorkflow: async (payload) => ({
        snapshotId: payload.snapshotId,
        stagingDir: 'browser',
        filesCopied: 0,
      }),
      readStagedSentinel: async () => null,
      loadStagedPayload: async () => null,
      readMedia: async () => null,
    },
    skills: {
      getGlobal: async () => withBuiltInSkills(JSON.parse(localStorage.getItem('shotloom-global-skills') || 'null') || { storageVersion: 1, skills: [] }),
      setGlobal: async (storage) => { localStorage.setItem('shotloom-global-skills', JSON.stringify(withoutBuiltInSkills(storage))); return storage; },
    },
    recipes: {
      getGlobal: async () => withBuiltInRecipes(JSON.parse(localStorage.getItem('shotloom-global-recipes') || 'null') || { storageVersion: 1, recipes: [] }),
      setGlobal: async (storage) => { localStorage.setItem('shotloom-global-recipes', JSON.stringify(withoutBuiltInRecipes(storage))); return withBuiltInRecipes(storage); },
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
        agentPreferredTextModel: 'gpt-5.4',
        agentPreferredImageModel: 'gpt-image-2',
          agentPreferredVideoModel: 'grok-imagine-video',
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
      set: async (settings) => {
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
          apiKeyValid: Object.values(current.providerConfigs || {}).some((c) => c?.apiKey?.trim()),
          accountSyncError: '',
          projectRootDir: current.projectRootDir || 'browser/projects',
          modelPollIntervalMs: current.modelPollIntervalMs || 1500,
          agentAutoEval: current.agentAutoEval !== false,
          agentAutoLayout: current.agentAutoLayout !== false,
          agentCanRunNodes: current.agentCanRunNodes === true,
          agentPreferredTextModel: current.agentPreferredTextModel || 'gpt-5.4',
          agentPreferredImageModel: current.agentPreferredImageModel || 'gpt-image-2',
          agentPreferredVideoModel: current.agentPreferredVideoModel || 'grok-imagine-video',
          runtimeProtection: current.runtimeProtection || {
            healthIntervalMs: 10000, failureThreshold: 3, failureWindowMs: 300000,
            circuitCooldownMs: 120000, stallWarningMs: 180000, hardCapMs: 1800000,
          },
          updatedAt: new Date().toISOString(),
        };
        localStorage.setItem('shotloom-settings', JSON.stringify(next));
        return next;
      },
      setTokenGroup: async (groupId) => {
        const current = JSON.parse(localStorage.getItem('shotloom-settings') || 'null') || {};
        const next = { ...current, activeTokenGroupId: groupId, updatedAt: new Date().toISOString() };
        localStorage.setItem('shotloom-settings', JSON.stringify(next));
        return next;
      },
    },
    model: {
      chatCompletion: async () => {
        throw new Error('浏览器预览不支持直接调用模型接口，请在 Tauri 桌面应用中使用。');
      },
      chatCompletionStream: async () => {
        throw new Error('浏览器预览不支持直接调用模型接口，请在 Tauri 桌面应用中使用。');
      },
      imageGeneration: async () => {
        throw new Error('浏览器预览不支持直接调用模型接口，请在 Tauri 桌面应用中使用。');
      },
      videoGeneration: async () => {
        throw new Error('浏览器预览不支持直接调用模型接口，请在 Tauri 桌面应用中使用。');
      },
      videoTask: async () => {
        throw new Error('浏览器预览不支持查询视频任务，请在 Tauri 桌面应用中使用。');
      },
    },
    update: {
      check: async () => ({ hasUpdate: false, downloaded: false, info: null }),
      download: async () => ({ ok: false, error: '浏览器预览不支持下载安装包。' }),
      cancelDownload: async () => ({ ok: true }),
      checkFreshness: async () => ({ superseded: false }),
      executeRestart: async () => ({ ok: false, error: '浏览器预览不支持安装更新。' }),
    },
    notifyTask: async () => ({ shown: false, reason: 'browser' }),
  };
}

const browserFallback = createBrowserFallback();
const isTauri = typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);

export const desktopApi = isTauri ? createTauriApi(browserFallback) : browserFallback;
