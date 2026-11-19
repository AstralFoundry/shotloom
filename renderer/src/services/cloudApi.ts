import type { createTauriApi } from './tauriApi';
import type { ModelPublication } from '../../../shared/modelPublications';
import { cloudOrigin, cloudRequest, cloudUserHeaders, verifyCloudSession } from './cloudRequest';
import { mediaFileUrl } from '../utils/mediaFileUrl';
import { mediaExtension, MEDIA_MIME_BY_EXTENSION } from '../utils/mediaType';
import { withBuiltInSkills, withoutBuiltInSkills } from './builtInSkills';
import { withBuiltInRecipes, withoutBuiltInRecipes } from './builtInRecipes';
import { modelJsonRequestBody, modelRequestEntries, multipartArrayFieldName } from '../utils/modelRequestBody';
import { modelResponseError, parseModelResponseText } from '../utils/modelResponseParsing';
import { createChatCompletionStreamAccumulator, parseChatCompletionSseLine } from '../utils/chatCompletionStream';
import { createAgentProtocolAccumulator, normalizeAgentProtocolResponse } from '../utils/agentProtocolStream';
import { probeEditorMedia, inferEditorMediaType } from '../utils/editorMediaImport';
import { captureVideoFrame, cropImage, type CropRect } from './browserMedia';
import { projectBundle, mapProjectMedia, exportProjectPackage, readProjectPackage, type ProjectBundle } from './cloudProjectPackage';
import { createCloudDirectorModels } from './cloudDirectorModels';

type RecordValue = Record<string, unknown>;
type PlatformApi = ReturnType<typeof createTauriApi>;
const root = 'cloud/projects';

export async function loadCloudPreferences() {
  return { ...await cloudRequest<RecordValue>('/settings'), projectRootDir: root, apiKeyValid: false };
}

export async function loadCloudAccountSettings() {
  const errors: string[] = [];
  const unavailable = (cause: unknown) => { errors.push(cause instanceof Error ? cause.message : String(cause)); return null; };
  const [{ getProviderAdapters }, account, models, { getCatalogModels, modelCatalog }, { parseUpstreamModels }, { compilePublication }] = await Promise.all([
    import('../domain/provider/adapters'), cloudRequest<RecordValue>('/auth/account').catch(unavailable),
    cloudRequest<{ publications: ModelPublication[]; upstreamModels: unknown }>('/models').catch(unavailable), import('../domain/catalog/ModelCatalog'),
    import('../domain/provider/UpstreamModels'), import('../../../shared/modelPublications'),
  ]);
  const upstreamModels = models ? parseUpstreamModels(models.upstreamModels) : [];
  modelCatalog.replacePublishedModels((models?.publications || []).map(compilePublication).filter(model => model !== null) as import('../domain/catalog/ModelCatalog').CatalogModel[]);
  const available = new Set(upstreamModels.map(model => model.id));
  return {
    apiKeyValid: errors.length === 0, accountSyncError: errors.join('\n'),
    rawQuota: Number(account?.app_quota || 0), usedQuota: Number(account?.app_used_quota || 0), upstreamModels,
    providerConfigs: Object.fromEntries(getProviderAdapters().map(adapter => [adapter.id, {
      apiKey: '', baseUrl: adapter.baseUrl, serverManaged: true,
      allowedModelIds: getCatalogModels(adapter.id).filter(model => available.has(model.upstreamModel || model.id)).map(model => model.id),
    }])),
  };
}

export function cloudProjectId(path: string): string {
  const id = path.replace(/\\/g, '/').replace(/\/project\.sqlite$/, '').split('/').at(-1) || '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid cloud project reference');
  return id;
}

function projectLocation(id: string, folderId?: string | null) {
  const projectDir = folderId ? `${root}/folders/${folderId}/${id}` : `${root}/${id}`;
  return { projectDir, filePath: `${projectDir}/project.sqlite` };
}

export function createCloudApi(local: PlatformApi): PlatformApi {
  let currentProject: string | null = null;
  const requestedProject = typeof window === 'undefined' ? null : new URLSearchParams(window.location?.search).get('project');
  if (requestedProject) {
    try {
      const folder = requestedProject.match(/^cloud\/projects\/folders\/([^/]+)\//)?.[1];
      currentProject = projectLocation(cloudProjectId(requestedProject), folder ? cloudProjectId(folder) : undefined).projectDir;
    }
    catch { /* Invalid links open the project library. */ }
  }
  const readBlob = async (source: string): Promise<Blob> => {
    if (source.startsWith('cloud://')) {
      const ref = new URL(source);
      const { url } = await cloudRequest<{ url: string }>(`/files/sign?bucket=${encodeURIComponent(ref.hostname)}&key=${encodeURIComponent(ref.pathname.slice(1))}`);
      const response = await fetch(url, { credentials: 'omit' });
      if (!response.ok) throw new Error(`Media download failed: ${response.status}`);
      return response.blob();
    }
    if (/^(https?:|blob:|data:)/.test(source)) {
      const remote = /^https?:/.test(source);
      const response = await fetch(mediaFileUrl(source), {
        credentials: remote ? 'include' : 'omit',
        ...(remote ? { headers: cloudUserHeaders() } : {}),
      });
      if (!response.ok) throw new Error(`Media download failed: ${response.status}`);
      return response.blob();
    }
    return new Blob([await local.file.readArrayBuffer(source)], { type: MEDIA_MIME_BY_EXTENSION[mediaExtension(source)] || 'application/octet-stream' });
  };
  const upload = async (blob: Blob, name: string) => {
    const extension = mediaExtension(name);
    const key = `${crypto.randomUUID()}${extension ? `.${extension}` : ''}`;
    const { url } = await cloudRequest<{ url: string }>('/files/upload-url', 'POST', { bucket: 'media', key });
    const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob, credentials: 'omit' });
    if (!response.ok) throw new Error(`Media upload failed: ${response.status}`);
    const path = `cloud://media/${key}`;
    return { path, filePath: path, bucket: 'media', storagePath: key, name, size: blob.size, mimeType: blob.type };
  };
  const directorModels = createCloudDirectorModels(upload, readBlob);
  const uploadLocal = async (source: string, name: string) => {
    const extension = mediaExtension(name);
    const key = `${crypto.randomUUID()}${extension ? `.${extension}` : ''}`;
    const mimeType = MEDIA_MIME_BY_EXTENSION[extension] || 'application/octet-stream';
    const { url } = await cloudRequest<{ url: string }>('/files/upload-url', 'POST', { bucket: 'media', key });
    const result = await local.nativeMedia.upload(source, url, mimeType);
    const path = `cloud://media/${key}`;
    return { ...result, path, filePath: path, bucket: 'media', storagePath: key, name, mimeType };
  };
  const nativeJob = async <T>(run: (directory: string, stage: (source: string) => Promise<string>) => Promise<T>) => {
    if (!local.nativeMedia) throw new Error('This media operation requires the desktop client');
    const workspace = await local.nativeMedia.workspace();
    const stage = async (source: string): Promise<string> => {
      if (/^https?:/.test(source)) return (await local.nativeMedia.download(workspace.id, mediaFileUrl(source), mediaExtension(source) || 'bin')).path;
      if (!source.startsWith('cloud://')) return source;
      const ref = new URL(source);
      const { url } = await cloudRequest<{ url: string }>(`/files/sign?bucket=${encodeURIComponent(ref.hostname)}&key=${encodeURIComponent(ref.pathname.slice(1))}`);
      const result = await local.nativeMedia.download(workspace.id, url, mediaExtension(source) || 'bin');
      return result.path;
    };
    try { return await run(workspace.path, stage); }
    finally { await local.nativeMedia.release(workspace.id); }
  };
  const copy = async (source: string, name = source.split(/[\\/]/).at(-1)?.split('?')[0] || 'media.bin') => {
    if (source.startsWith('cloud://')) return { path: source, filePath: source, name };
    if (local.nativeMedia && /^https?:/.test(source)) return nativeJob(async (_directory, stage) => uploadLocal(await stage(source), name));
    if (local.nativeMedia && !/^(blob:|data:)/.test(source)) return uploadLocal(source, name);
    return upload(await readBlob(source), name);
  };
  const pickFiles = (accept = '', multiple = false): Promise<File[]> => new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.multiple = multiple;
    input.addEventListener('change', () => resolve(Array.from(input.files || [])), { once: true });
    input.addEventListener('cancel', () => resolve([]), { once: true });
    input.click();
  });
  const download = async (name: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { name, size: blob.size };
  };
  const importBundle = async (bundle: ProjectBundle, resolve: (source: string) => Promise<string>) => {
    const uploaded: string[] = [];
    const id = crypto.randomUUID();
    let submitted = false;
    try {
      const mapped = await mapProjectMedia(bundle, async source => {
        const saved = await resolve(source);
        if (saved !== source) uploaded.push(saved);
        return saved;
      });
      mapped.project = { ...mapped.project, id, storageRevision: 0, cloudFolderId: null };
      delete mapped.project.library;
      delete mapped.project.series;
      submitted = true;
      const project = await directorModels.load(await cloudRequest<RecordValue>(`/project/${id}/bundle`, 'PUT', await directorModels.save(mapped)));
      return { ...projectLocation(id), project, count: 1 };
    } catch (error) {
      // A lost response may follow a successful commit; never delete its media.
      if (submitted) {
        const project = await cloudRequest<RecordValue>(`/project/${id}`).then(value => directorModels.load(value)).catch(() => null);
        if (project) return { ...projectLocation(id), project, count: 1 };
      }
      const status = (error as { status?: number })?.status;
      if (!submitted || (status && status >= 400 && status < 500)) {
        for (const path of uploaded) {
          const ref = new URL(path);
          await cloudRequest(`/files?bucket=${encodeURIComponent(ref.hostname)}&key=${encodeURIComponent(ref.pathname.slice(1))}`, 'DELETE').catch(() => {});
        }
      }
      // shortcut: uncertain commits retain private uploads; reconcile them before any orphan cleanup.
      throw error;
    }
  };
  const importLegacy = async (opened: RecordValue) => {
    const directory = String(opened.projectDir || '');
    const bundle = projectBundle(await local.project.readBundle(directory));
    if (opened.project) bundle.project = opened.project as RecordValue;
    return importBundle(bundle, async source => {
      const path = /^(?:[a-z][a-z0-9+.-]*:|[\\/])/i.test(source) ? source : `${directory}/${source}`;
      return (await copy(path)).filePath;
    });
  };
  const openCloudProject = async () => {
    if (local.nativeMedia) {
      const opened = await local.project.openFolderDialog();
      return opened ? importLegacy(opened as RecordValue) : null;
    }
    const files = await pickFiles('.zip');
    if (!files[0]) return null;
    const { bundle, files: media } = await readProjectPackage(files[0]);
    return importBundle(bundle, async source => {
      if (!source.startsWith('package://media/')) throw new Error('项目包包含外部媒体引用');
      const path = source.slice('package://'.length);
      const file = media.get(path);
      if (!file) throw new Error(`项目包缺少媒体：${path}`);
      return (await upload(file, path)).filePath;
    });
  };
  const requestModel = async (path: string, body: RecordValue = {}, onTextDelta?: (text: string) => void) => {
    const endpoint = String(body.__endpointPath || path);
    const method = String(body.__endpointMethod || 'POST').toUpperCase();
    let payload: BodyInit | undefined;
    const headers = new Headers(cloudUserHeaders());
    headers.set('x-shotloom-provider', String(body.__providerId || ''));
    headers.set('x-shotloom-scope', String(body.__endpointScope || 'v1'));
    for (const [key, value] of Object.entries((body.__headers || {}) as RecordValue)) {
      if (['accept', 'openai-beta', 'anthropic-version', 'anthropic-beta'].includes(key.toLowerCase())) headers.set(key, String(value));
    }
    if (!['GET', 'HEAD'].includes(method)) {
      if (body.__multipart) {
        const form = new FormData();
        for (const [key, value] of modelRequestEntries(body, { multipart: true })) {
          if (value !== null && value !== '') form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
        }
        const images = Array.isArray(body.__inputImages) ? body.__inputImages as RecordValue[] : [];
        for (const resource of images) {
          const source = String(resource.filePath || resource.path || resource.url || resource.dataUrl || '');
          form.append(multipartArrayFieldName(String(resource.fieldName || body.__imageField || 'image'), images.length), await readBlob(source), String(resource.name || 'image.png'));
        }
        if (body.__maskResource) {
          const mask = body.__maskResource as RecordValue;
          form.append(String(body.__maskField || 'mask'), await readBlob(String(mask.filePath || mask.path || mask.url || mask.dataUrl || '')), String(mask.name || 'mask.png'));
        }
        payload = form;
      } else {
        headers.set('Content-Type', 'application/json');
        payload = JSON.stringify(modelJsonRequestBody(body));
      }
    }
    const timeout = AbortSignal.timeout(Number(body.__timeoutMs) > 0 ? Number(body.__timeoutMs) : 180_000);
    const signal = body.__signal instanceof AbortSignal ? AbortSignal.any([body.__signal, timeout]) : timeout;
    const response = await fetch(`${cloudOrigin}/api/relay${endpoint}`, {
      method, credentials: 'include', headers,
      ...(payload === undefined ? {} : { body: payload }),
      signal,
    });
    if (response.status === 401 || response.status === 409) await verifyCloudSession();
    if (!response.ok) throw new Error(modelResponseError(parseModelResponseText(await response.text()), response.status));
    if (onTextDelta && response.body && response.headers.get('content-type')?.includes('text/event-stream')) {
      const protocol = String(body.__agentProtocol || 'openai-chat-completions');
      const accumulator = protocol === 'openai-chat-completions' ? createChatCompletionStreamAccumulator(onTextDelta) : createAgentProtocolAccumulator(protocol, onTextDelta);
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let pending = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          pending += value;
          const lines = pending.split(/\r?\n/); pending = lines.pop() || '';
          for (const line of lines) { const event = parseChatCompletionSseLine(line); if (event) accumulator.push(event); }
        }
        if (pending) { const event = parseChatCompletionSseLine(pending); if (event) accumulator.push(event); }
        return accumulator.result();
      } finally { reader.releaseLock(); }
    }
    if (body.__responseEncoding === 'binary') {
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return { __responseBodyBase64: btoa(binary), __responseContentType: response.headers.get('content-type') || '' };
    }
    const data = parseModelResponseText(await response.text());
    if (onTextDelta && body.__agentProtocol && body.__agentProtocol !== 'openai-chat-completions') return normalizeAgentProtocolResponse(String(body.__agentProtocol), data, onTextDelta);
    const text = data?.choices?.[0]?.message?.content;
    if (onTextDelta && typeof text === 'string') onTextDelta(text);
    return data;
  };
  const catalog = (kind: string) => cloudRequest<RecordValue>(`/catalog/${kind}`);
  const settings = async () => {
    const [preferences, account] = await Promise.all([loadCloudPreferences(), loadCloudAccountSettings()]);
    return { ...preferences, ...account };
  };
  const snapshotPath = (dir: string, node: string) => `/project/${cloudProjectId(dir)}/snapshot/${encodeURIComponent(node)}`;
  const editorPath = (dir: string, node: string, key: string) => `/project/${cloudProjectId(dir)}/editor/${encodeURIComponent(node)}/${encodeURIComponent(key)}`;
  const folderId = (directory: string) => directory === root ? null : cloudProjectId(directory);
  const createFolder = async (parent: string, name: string) => {
    const saved = await cloudRequest<{ id: string }>('/library-folders', 'POST', { parentId: folderId(parent), name });
    return { kind: 'folder', name, folderDir: `${root}/folders/${saved.id}` };
  };
  const listTree = async (): Promise<RecordValue[]> => {
    const [folders, projects] = await Promise.all([cloudRequest<Array<{ id: string; parentId: string | null; name: string }>>('/library-folders'), cloudRequest<RecordValue[]>('/projects')]);
    const children = (parentId: string | null): RecordValue[] => [
      ...folders.filter(folder => folder.parentId === parentId).map(folder => ({ kind: 'folder', name: folder.name, folderDir: `${root}/folders/${folder.id}`, children: children(folder.id) })),
      ...projects.filter(project => (project.cloudFolderId || null) === parentId).map(project => ({ ...project, kind: 'project', ...projectLocation(String(project.id), parentId) })),
    ];
    return children(null);
  };
  const cloneProject = async (directory: string, changes: RecordValue) => {
    const bundle = projectBundle(await cloudRequest(`/project/${cloudProjectId(directory)}/bundle`));
    const id = crypto.randomUUID();
    bundle.project = { ...bundle.project, ...changes, id, storageRevision: 0 };
    // Host sessions belong to the source project; copies bind independent conversations.
    for (const field of ['harnessSessions', 'trashedHarnessSessions']) {
      const sessions = bundle.project[field];
      if (Array.isArray(sessions)) bundle.project[field] = sessions.map(({ harnessSessionId: _source, ...session }) => session);
    }
    const project = await directorModels.load(await cloudRequest(`/project/${id}/bundle`, 'PUT', await directorModels.save(bundle)));
    return { ...projectLocation(id, bundle.project.cloudFolderId as string | null), project };
  };
  const cloneTree = async (directory: string, parent: string, entries: RecordValue[]): Promise<RecordValue> => {
    const source = entries.find(entry => entry.folderDir === directory);
    if (!source) {
      for (const entry of entries) {
        if (entry.kind === 'folder') {
          const found = await cloneTree(directory, parent, entry.children as RecordValue[]);
          if (found.ok) return found;
        }
      }
      return { ok: false };
    }
    const copy = await createFolder(parent, `${source.name} (copy)`);
    try {
      for (const entry of source.children as RecordValue[]) {
        if (entry.kind === 'folder') await cloneTree(String(entry.folderDir), copy.folderDir, source.children as RecordValue[]);
        else {
          await cloneProject(String(entry.projectDir), { cloudFolderId: folderId(copy.folderDir) });
        }
      }
      return { ...copy, ok: true };
    } catch (error) {
      await cloudRequest(`/library-folders/${folderId(copy.folderDir)}`, 'DELETE');
      throw error;
    }
  };

  return {
    ...local,
    clipboard: {
      ...local.clipboard,
      stageWorkflow: async (payload: RecordValue) => {
        const id = String(payload.snapshotId || '');
        if (!/^[a-z0-9_-]+$/i.test(id) || !Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) throw new Error('Invalid clipboard snapshot');
        const resources = [];
        for (const resource of (payload.resources || []) as RecordValue[]) {
          const source = String(resource.path || resource.filePath || resource.localPath || '');
          resources.push({ ...resource, ...(source ? { stagedPath: (await copy(source, String(resource.name || resource.fileName || 'media.bin'))).filePath } : {}) });
        }
        await cloudRequest(`/clipboard/${encodeURIComponent(id)}`, 'PUT', await directorModels.save({ ...payload, resources }));
        if (local.nativeMedia) await local.nativeMedia.clipboardWrite(id);
        else await navigator.clipboard.writeText(`shotloom-workflow:${id}`);
        return { snapshotId: id, filesCopied: resources.length, summary: payload.summary };
      },
      readStagedSentinel: async () => {
        if (local.nativeMedia) return local.clipboard.readStagedSentinel();
        const text = await navigator.clipboard.readText();
        const id = text.match(/^shotloom-workflow:([a-z0-9_-]+)$/i)?.[1];
        return id ? { snapshotId: id } : null;
      },
      loadStagedPayload: (id: string) => cloudRequest(`/clipboard/${encodeURIComponent(id)}`).then(value => directorModels.load(value)),
    },
    project: {
      ...local.project,
      openDialog: openCloudProject,
      openFolderDialog: openCloudProject,
      getDefaultRoot: async () => root, ensureRoot: async () => root, selectRoot: async () => root,
      createFolder: async (parent: string = root) => `${parent}/${crypto.randomUUID()}`,
      createLibraryFolder: createFolder,
      createWorkFolder: async (parent: string, name: string) => { const folder = await createFolder(parent, name); return { ...folder, kind: 'work', workDir: folder.folderDir }; },
      createSeasonFolder: async (parent: string, name: string) => { const folder = await createFolder(parent, name); return { ...folder, kind: 'season', seasonDir: folder.folderDir, workDir: parent }; },
      createEpisodeFolder: async (parent: string, workDir: string) => ({ projectDir: `${parent}/${crypto.randomUUID()}`, seriesDir: workDir, assetRootDir: 'cloud://media' }),
      cloneLibraryFolder: async (directory: string) => cloneTree(directory, root, await listTree()),
      trashLibraryFolder: async (directory: string) => { await cloudRequest(`/library-folders/${folderId(directory)}`, 'DELETE'); return { ok: true }; },
      save: async (directory: string, project: RecordValue) => {
        const id = directory ? cloudProjectId(directory) : crypto.randomUUID();
        const parent = directory.match(/\/folders\/([0-9a-f-]+)\//i)?.[1] || project.cloudFolderId || null;
        const saved = await directorModels.load(await cloudRequest<RecordValue>(`/project/${id}`, 'PUT', await directorModels.save({ ...project, cloudFolderId: parent })));
        return { ...projectLocation(id, parent as string | null), project: saved };
      },
      readFile: (path: string) => cloudRequest(`/project/${cloudProjectId(path)}`).then(value => directorModels.load(value)),
      readBundle: (dir: string) => cloudRequest(`/project/${cloudProjectId(dir)}/bundle`).then(value => directorModels.load(value)),
      listRoot: listTree,
      openFolder: async (dir: string) => {
        const project = await directorModels.load(await cloudRequest<RecordValue>(`/project/${cloudProjectId(dir)}`));
        return { ...projectLocation(cloudProjectId(dir), project.cloudFolderId as string | undefined), project };
      },
      getEditorSnapshot: (dir: string, node: string) => cloudRequest(snapshotPath(dir, node)).then(value => directorModels.load(value)),
      setEditorSnapshot: async (dir: string, node: string, value: unknown) => { await cloudRequest(snapshotPath(dir, node), 'PUT', await directorModels.save(value)); return true; },
      getEditorRecord: (dir: string, node: string, key: string) => cloudRequest(editorPath(dir, node, key)).then(value => directorModels.load(value)),
      setEditorRecord: async (dir: string, node: string, key: string, value: unknown) => cloudRequest(editorPath(dir, node, key), 'PUT', await directorModels.save(value)),
      syncCurrent: async (snapshot: { projectDir?: string }) => { currentProject = snapshot.projectDir || null; return true; },
      getWindowProjectDir: async () => currentProject,
      setWindowProjectDir: async (directory: string | null) => { currentProject = directory; return true; },
      renameEntry: async (directory: string, name: string) => {
        const id = cloudProjectId(directory);
        if (directory === `${root}/folders/${id}`) {
          await cloudRequest(`/library-folders/${id}`, 'PATCH', { name });
          return { oldDir: directory, newDir: directory, name };
        }
        const project = await cloudRequest<RecordValue>(`/project/${id}`);
        const saved = await cloudRequest<RecordValue>(`/project/${id}`, 'PUT', { ...project, name });
        return { oldDir: directory, newDir: directory, name, storageRevision: saved.storageRevision };
      },
      trashFolder: async (directory: string) => { await cloudRequest(`/project/${cloudProjectId(directory)}`, 'DELETE'); return { ok: true }; },
      cloneFolder: (directory: string, name: string) => cloneProject(directory, { name }),
      exportPackage: async (directory: string, name = 'project') => download(`${name.replace(/[\\/:*?"<>|]/g, '-')}.zip`,
        await exportProjectPackage(projectBundle(await directorModels.load(await cloudRequest(`/project/${cloudProjectId(directory)}/bundle`))), readBlob)),
      importPackage: async () => {
        if (!local.nativeMedia) return openCloudProject();
        const workspace = await local.nativeMedia.workspace();
        try {
          const opened = await local.project.importPackage(workspace.path);
          if (opened && typeof opened === 'object' && 'bundle' in opened) {
            const { bundle, mediaRoot } = opened as { bundle: unknown; mediaRoot: string };
            return importBundle(projectBundle(bundle), async source => {
              if (!/^package:\/\/media\/[a-zA-Z0-9_.-]+$/.test(source)) throw new Error('项目包包含外部媒体引用');
              return (await copy(`${mediaRoot}/${source.slice('package://'.length)}`)).filePath;
            });
          }
          return opened ? importLegacy(opened as RecordValue) : null;
        } finally { await local.nativeMedia.release(workspace.id); }
      },
    },
    recent: {
      list: () => cloudRequest('/recent'),
      add: (project: RecordValue) => cloudRequest('/recent', 'POST', { ...project, projectId: cloudProjectId(String(project.projectDir || project.filePath)) }),
      remove: (path: string) => cloudRequest(`/recent/${cloudProjectId(path)}`, 'DELETE'),
    },
    settings: { ...local.settings, get: settings,
      set: async (value: RecordValue) => { const { providerConfigs: _providers, upstreamModels: _models, ...preferences } = value; await cloudRequest('/settings', 'PUT', preferences); return settings(); },
      setTokenGroup: async (id: string) => { await cloudRequest('/settings/token-group', 'PUT', { activeTokenGroupId: id }); return settings(); },
      refreshBalance: settings,
    },
    localAssets: { getCatalog: () => catalog('assets'), setCatalog: async (value: RecordValue) => { await cloudRequest('/catalog/assets', 'PUT', value); return value; } },
    skills: {
      getGlobal: async () => withBuiltInSkills(await catalog('skills')),
      setGlobal: async (value: RecordValue) => { await cloudRequest('/catalog/skills', 'PUT', withoutBuiltInSkills(value)); return withBuiltInSkills(value); },
    },
    recipes: {
      getGlobal: async () => withBuiltInRecipes(await catalog('recipes')),
      setGlobal: async (value: RecordValue) => { await cloudRequest('/catalog/recipes', 'PUT', withoutBuiltInRecipes(value)); return withBuiltInRecipes(value); },
    },
    file: {
      ...local.file,
      importAsset: async () => {
        if (local.nativeMedia) {
          const files = await local.file.importAsset();
          const results = [];
          for (const file of files) results.push(await uploadLocal(file.path || file.filePath, file.name));
          return results;
        }
        const results = [];
        for (const file of await pickFiles('', true)) results.push(await upload(file, file.name));
        return results;
      },
      pickResource: async (type: string) => {
        if (local.nativeMedia) { const file = await local.file.pickResource(type); return file ? uploadLocal(file.path || file.filePath, file.name) : null; }
        const [file] = await pickFiles(`${type}/*`); return file ? upload(file, file.name) : null;
      },
      readArrayBuffer: async (path: string) => (await readBlob(path)).arrayBuffer(),
      readImagePreview: async (path: string) => (await readBlob(path)).arrayBuffer(),
      cropImageToProject: async (path: string, name = 'cropped-image.png', crop: CropRect) => upload(await cropImage(await readBlob(path), crop), name),
      captureVideoFrameToProject: async (path: string, seconds: number, name = 'frame.png') => upload(await captureVideoFrame(mediaFileUrl(path), seconds), name),
      applyColoredPencil: (source: string, name = 'colored-pencil.png') => nativeJob(async (directory, stage) => {
        const result = await local.nativeMedia.pencil(await stage(source), `${directory}/pencil.png`);
        return uploadLocal(result.path, name);
      }),
      hasAudio: (source: string) => nativeJob(async (_directory, stage) => local.nativeMedia.hasAudio(await stage(source))),
      separateAudioToProject: (source: string, audioName = 'audio.m4a', videoName = 'silent.mp4') => nativeJob(async (directory, stage) => {
        const result = await local.nativeMedia.separate(await stage(source), `${directory}/audio.m4a`, `${directory}/silent.mp4`);
        return { audio: await uploadLocal(result.audio.path, audioName), video: await uploadLocal(result.video.path, videoName) };
      }),
      concatVideos: (sources: string[], options: RecordValue = {}) => nativeJob(async (directory, stage) => {
        const inputs = [];
        for (const source of sources) inputs.push(await stage(source));
        const result = await local.nativeMedia.concat(inputs, `${directory}/merged.mp4`);
        return uploadLocal(result.path, String(options.name || 'merged.mp4'));
      }),
      renderVideoProjectToCanvas: (project: RecordValue, name = 'clip.mp4', requestId = '') => nativeJob(async (directory, stage) => {
        const assets = [];
        for (const entry of (project.assets || []) as RecordValue[]) {
          const source = String(entry.sourceFile || entry.sourceUrl || '');
          const sourceFile = await stage(source);
          assets.push({ ...entry, sourceFile });
        }
        const result = await local.nativeMedia.render({ ...project, assets }, `${directory}/clip.mp4`, requestId);
        return uploadLocal(result.path, name);
      }),
      getGlobalAssetRoot: async () => 'cloud://media',
      pathExists: async (path: string) => {
        try {
          if (path.startsWith('cloud://')) {
            const ref = new URL(path);
            const { url } = await cloudRequest<{ url: string }>(`/files/sign?bucket=${encodeURIComponent(ref.hostname)}&key=${encodeURIComponent(ref.pathname.slice(1))}`);
            return (await fetch(url, { method: 'HEAD', credentials: 'omit' })).ok;
          }
          return (await fetch(mediaFileUrl(path), { method: 'HEAD', credentials: 'include' })).ok;
        } catch { return false; }
      },
      copyToProject: copy,
      copyToDirectory: (source: string, _directory: string, name?: string) => copy(source, name),
      saveDataUrlToProject: async (url: string, name = 'image.png') => upload(await readBlob(url), name),
      downloadUrlToProject: async (url: string, name = 'media.bin') => copy(url, name),
      writeFileToPath: (path: string, bytes: ArrayBuffer | Uint8Array<ArrayBuffer>) => upload(new Blob([bytes]), path.split('/').at(-1) || 'media.bin'),
      saveArrayBuffer: (name: string, bytes: ArrayBuffer | Uint8Array<ArrayBuffer>) => download(name, new Blob([bytes])),
      exportFile: async (source: string, name?: string) => download(name || source.split('/').at(-1) || 'media.bin', await readBlob(source)),
      probeMedia: async (source: string) => probeEditorMedia({ type: inferEditorMediaType(source), sourceFile: source, sourceUrl: mediaFileUrl(source) }),
      checksum: async (source: string) => {
        const bytes = await (await readBlob(source)).arrayBuffer();
        const hash = await crypto.subtle.digest('SHA-256', bytes);
        return { checksum: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''), checksumAlgorithm: 'sha256', size: bytes.byteLength };
      },
      trash: async (source: string) => {
        const value = new URL(source);
        if (value.protocol !== 'cloud:') throw new Error('Invalid cloud media reference');
        await cloudRequest(`/files?bucket=${encodeURIComponent(value.hostname)}&key=${encodeURIComponent(value.pathname.slice(1))}`, 'DELETE');
        return { ok: true };
      },
    },
    model: {
      chatCompletion: (body: RecordValue) => requestModel('/chat/completions', body),
      chatCompletionStream: (body: RecordValue, delta?: (text: string) => void) => requestModel('/chat/completions', { ...body, stream: true }, delta),
      imageGeneration: (body: RecordValue) => requestModel('/images/generations', body),
      videoGeneration: (body: RecordValue) => requestModel('/videos', body),
      videoTask: (value: RecordValue | string) => {
        const request = typeof value === 'string' ? { taskId: value } : value;
        return requestModel(`/videos/${encodeURIComponent(String(request.taskId))}`, {
          ...(request.body as RecordValue || {}), __endpointMethod: request.endpointMethod || 'GET',
          __endpointPath: String(request.endpointPath || `/videos/${encodeURIComponent(String(request.taskId))}`).replace('{taskId}', encodeURIComponent(String(request.taskId))),
          __signal: request.signal,
          __providerId: request.providerId, __endpointScope: request.endpointScope,
          __timeoutMs: request.timeoutMs, __headers: request.headers, __responseEncoding: request.responseEncoding,
        });
      },
    },
  };
}
