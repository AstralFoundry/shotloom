import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { PROJECT_SESSION_KEY } from '@/utils/projectSession.mjs';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { check as checkUpdate } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { withBuiltInSkills, withoutBuiltInSkills } from './builtInSkills';
import { withBuiltInRecipes, withoutBuiltInRecipes } from './builtInRecipes';
import { modelJsonRequestBody, modelRequestEntries } from '@/utils/modelRequestBody.mjs';
import { modelResponseError, parseModelResponseText } from '@/utils/modelResponseParsing.mjs';
import { createChatCompletionStreamAccumulator, parseChatCompletionSseLine } from '@/utils/chatCompletionStream.mjs';
import { resourceFileDialogFilters } from '@/utils/resourceFileTypes.mjs';

const command = (channel, ...args) => {
  switch (channel) {
    case 'platform': return invoke('platform');
    case 'settings:get': return invoke('settings_get');
    case 'settings:set': return invoke('settings_set', { settings: args[0] });
    case 'settings:set-token-group': return invoke('settings_set_token_group', { id: args[0] });
    case 'storage:get': return invoke('storage_get', { name: args[0], fallback: args[1] });
    case 'storage:set': return invoke('storage_set', { name: args[0], value: args[1] });
    case 'file:global-asset-root': return invoke('file_global_asset_root');
    case 'file:trash': return invoke('file_trash', { path: args[0] });
    case 'file:show-item-in-folder': return invoke('file_show_item_in_folder', { path: args[0] });
    case 'file:export-resource-package': return invoke('file_export_resource_package', {
      target: args[0], manifest: args[1], files: args[2],
    });
    case 'file:import-resource-package': return invoke('file_import_resource_package', {
      source: args[0], targetDirectory: args[1],
    });
    case 'project:get-default-root': return invoke('project_get_default_root');
    case 'project:ensure-root': return invoke('project_ensure_root', { root: args[0] });
    case 'project:create-folder': return invoke('project_create_folder', { parent: args[0], name: args[1] });
    case 'project:create-library-folder': return invoke('project_create_library_folder', { parent: args[0], name: args[1] });
    case 'project:rename-entry': return invoke('project_rename_entry', { path: args[0], name: args[1] });
    case 'project:clone-folder':
    case 'project:clone-library-folder': return invoke('project_clone_entry', { path: args[0], name: args[1] || null });
    case 'project:list-root': return invoke('project_list_root', { root: args[0] });
    case 'project:save': return invoke('project_save', { directory: args[0], project: args[1] });
    case 'project:read-file': return invoke('project_read_file', { path: args[0] });
    case 'project:open-folder': return invoke('project_open_folder', { directory: args[0] });
    case 'project:export-package': return invoke('project_export_package', { source: args[0], target: args[1] });
    case 'project:import-package': return invoke('project_import_package', { source: args[0], targetRoot: args[1] });
    case 'project:create-episode-folder': return invoke('project_create_episode_folder', { parent: args[0], shared: args[1], name: args[2] });
    case 'project:trash-folder':
    case 'project:trash-library-folder': return invoke('project_trash_entry', { path: args[0] });
    case 'recent:list': return invoke('recent_list');
    case 'recent:add': return invoke('recent_add', { project: args[0] });
    case 'recent:remove': return invoke('recent_remove', { path: args[0] });
    case 'file:read-array-buffer': return invoke('file_read_array_buffer', { path: args[0] });
    case 'file:read-image-preview': return invoke('file_read_image_preview', { path: args[0], maxSize: args[1] });
    case 'file:apply-colored-pencil': return invoke('file_apply_colored_pencil', { source: args[0], target: args[1] });
    case 'file:crop-image': return invoke('file_crop_image', { source: args[0], target: args[1], crop: args[2] });
    case 'file:has-audio': return invoke('file_has_audio', { source: args[0] });
    case 'file:separate-audio': return invoke('file_separate_audio', {
      source: args[0], audioTarget: args[1], silentVideoTarget: args[2],
    });
    case 'file:write': return invoke('file_write', { path: args[0], data: args[1], append: Boolean(args[2]) });
    case 'file:copy': return invoke('file_copy', { source: args[0], target: args[1] });
    case 'file:export-video-project': return invoke('file_export_video_project', {
      target: args[0], project: args[1],
    });
    case 'file:path-exists': return invoke('file_path_exists', { path: args[0] });
    case 'file:checksum': return invoke('file_checksum', { path: args[0] });
    case 'file:resolve-unique-path': return invoke('file_resolve_unique_path', { directory: args[0], name: args[1] });
    default: return Promise.reject(new Error(`未知 Tauri command: ${channel}`));
  }
};
const platform = navigator.userAgent.includes('Windows') ? 'win32'
  : navigator.userAgent.includes('Macintosh') ? 'darwin' : 'linux';

function subscribe(register, callback) {
  let disposed = false;
  let unlisten = null;
  Promise.resolve(register(callback)).then((dispose) => {
    if (disposed) dispose?.();
    else unlisten = dispose;
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

function bytesToBase64(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || 0);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBuffer(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function rasterizeImageDataUrl(dataUrl, width = 512, height = 512) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(Number(width) || image.naturalWidth || 512));
      canvas.height = Math.max(1, Math.round(Number(height) || image.naturalHeight || 512));
      const context = canvas.getContext('2d');
      if (!context) return reject(new Error('无法创建贴图栅格化画布'));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = () => reject(new Error('无法读取剪辑工程中的内嵌贴图'));
    image.src = dataUrl;
  });
}

async function materializeVideoProjectAssets(project) {
  let prepared;
  try {
    prepared = JSON.parse(JSON.stringify(project));
  } catch (cause) {
    throw new Error(`剪辑工程无法序列化：${cause instanceof Error ? cause.message : String(cause)}`);
  }
  for (const asset of prepared?.assets || []) {
    if (asset.type !== 'image' || asset.sourceFile || !String(asset.sourceUrl || '').startsWith('data:image/')) continue;
    const dataUrl = String(asset.sourceUrl);
    const pngDataUrl = dataUrl.startsWith('data:image/png;')
      ? dataUrl
      : await rasterizeImageDataUrl(dataUrl, asset.width, asset.height);
    const safeName = String(asset.name || asset.id || 'sticker').replace(/[^\p{L}\p{N}._-]+/gu, '-');
    const result = await command(
      'file:write',
      await uniqueProjectAssetPath(`${safeName || 'sticker'}.png`),
      pngDataUrl.split(',')[1] || '',
      false,
    );
    asset.sourceFile = result?.path || '';
    if (!asset.sourceFile) throw new Error(`贴图素材落盘失败：${asset.name || asset.id}`);
  }
  return prepared;
}

const imagePreviewQueue = [];
const imagePreviewInFlight = new Map();
let activeImagePreviewReads = 0;

function drainImagePreviewQueue() {
  while (activeImagePreviewReads < 4 && imagePreviewQueue.length) {
    const job = imagePreviewQueue.shift();
    activeImagePreviewReads += 1;
    Promise.resolve()
      .then(job.task)
      .then(job.resolve, job.reject)
      .finally(() => {
        activeImagePreviewReads -= 1;
        drainImagePreviewQueue();
      });
  }
}

function readImagePreview(path, maxSize = 960) {
  const key = `${path}|${maxSize}`;
  if (imagePreviewInFlight.has(key)) return imagePreviewInFlight.get(key);
  const pending = new Promise((resolve, reject) => {
    imagePreviewQueue.push({
      resolve,
      reject,
      task: async () => base64ToBuffer(await command('file:read-image-preview', path, maxSize)),
    });
    drainImagePreviewQueue();
  }).finally(() => imagePreviewInFlight.delete(key));
  imagePreviewInFlight.set(key, pending);
  return pending;
}

function sessionProjectDir() {
  try {
    return JSON.parse(localStorage.getItem(PROJECT_SESSION_KEY) || 'null')?.projectDir || '';
  } catch {
    return '';
  }
}

function sessionProjectAssetRoot() {
  try {
    const session = JSON.parse(localStorage.getItem(PROJECT_SESSION_KEY) || 'null');
    return session?.project?.library?.assetRootDir
      || session?.project?.series?.assetRootDir
      || joinPath(session?.projectDir || '', 'assets');
  } catch {
    return '';
  }
}

function joinPath(...parts) {
  const separator = platform === 'win32' ? '\\' : '/';
  return parts.filter(Boolean).join(separator).replace(/[\\/]+/g, separator);
}

function basename(value = '') {
  return String(value).split(/[\\/]/).pop() || '';
}

function mimeType(path = '') {
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' })[
    String(path).split('.').pop()?.toLowerCase()
  ] || 'application/octet-stream';
}

async function writeBytes(path, bytes, append = false) {
  return command('file:write', path, bytesToBase64(bytes), append);
}

async function uniqueProjectAssetPath(preferredName = 'resource.bin') {
  const assetRoot = sessionProjectAssetRoot();
  if (!assetRoot) throw new Error('请先创建或打开项目');
  return command('file:resolve-unique-path', assetRoot, preferredName);
}

function packageFileName(value = 'resources') {
  const base = String(value || 'resources').replace(/[\\/:*?"<>|]+/g, '-').replace(/\.zip$/i, '');
  return `${base}.shotloom-resources.zip`;
}

function projectPackageFileName(value = 'project') {
  const base = String(value || 'project').replace(/[\\/:*?"<>|]+/g, '-').replace(/\.zip$/i, '');
  return `${base}.shotloom-project.zip`;
}

async function exportProjectPackage(directory, name = '') {
  const fileName = projectPackageFileName(name || basename(directory) || 'project');
  const target = await saveDialog({
    defaultPath: fileName,
    filters: [{ name: 'Shotloom Project', extensions: ['zip'] }],
  });
  if (!target) return null;
  return command('project:export-package', directory, target);
}

async function importProjectPackage(targetRoot) {
  const source = await openDialog({
    title: '导入 Shotloom 项目包',
    multiple: false,
    directory: false,
    filters: [{ name: 'Shotloom Project', extensions: ['zip'] }],
  });
  if (!source) return null;
  return command('project:import-package', source, targetRoot);
}

async function resourcePackageTarget(name) {
  const fileName = packageFileName(name);
  const downloadDir = localStorage.getItem('shotloom-download-dir') || '';
  if (downloadDir) return command('file:resolve-unique-path', downloadDir, fileName);
  return saveDialog({
    defaultPath: fileName,
    filters: [{ name: 'Shotloom Resources', extensions: ['zip'] }],
  });
}

function generationRequestId() {
  return `generation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function generationResource(resource = {}, fieldName = 'image', fallbackName = 'input.bin') {
  const filePath = String(resource.filePath || resource.path || '');
  return {
    fieldName: String(resource.fieldName || fieldName),
    filePath: filePath || undefined,
    url: String(resource.url || resource.previewUrl || resource.dataUrl || '') || undefined,
    fileName: String(resource.name || resource.fileName || basename(filePath) || fallbackName),
    mimeType: String(resource.mimeType || mimeType(filePath)),
  };
}

function generationGatewayRequest(path, body, {
  method = 'POST', scope = 'v1', multipart = false, timeoutMs = 120000,
  providerId: requestedProviderId = '', headers: requestedHeaders = {}, auth, responseEncoding = 'json',
} = {}) {
  const providerId = requestedProviderId || body?.__providerId || '';
  const headers = Object.entries(requestedHeaders || {})
    .filter(([, value]) => typeof value === 'string');
  const resources = [];
  const formFields = [];
  let requestBody;
  if (multipart) {
    modelRequestEntries(body, { multipart: true }).forEach(([key, value]) => {
      if (value === null || value === '') return;
      formFields.push([key, typeof value === 'object' ? JSON.stringify(value) : String(value)]);
    });
    (body.__inputImages || []).forEach((resource, index) => {
      resources.push(generationResource(
        resource,
        resource.fieldName || body.__imageField || 'image',
        `input-${index + 1}.png`,
      ));
    });
    if (body.__maskResource) {
      resources.push(generationResource(body.__maskResource, body.__maskField || 'mask', 'mask.png'));
    }
  } else if (method !== 'GET') {
    requestBody = modelJsonRequestBody(body);
  }
  return {
    requestId: generationRequestId(), providerId, path, scope, method,
    headers, auth: auth || { type: 'bearer' }, body: requestBody,
    formFields, resources, responseEncoding, timeoutMs: Math.max(1000, Number(timeoutMs) || 120000),
    baseUrl: body?.__baseUrl || undefined, apiKey: body?.__apiKey || undefined,
  };
}

async function invokeGeneration(commandName, request, signal) {
  let cancelRetry;
  const cancelOnce = () => invoke('generation_cancel', { requestId: request.requestId }).catch(() => undefined);
  const cancel = () => {
    cancelOnce();
    cancelRetry = window.setTimeout(cancelOnce, 25);
  };
  if (signal?.aborted) {
    cancel();
    throw new DOMException('模型请求已取消', 'AbortError');
  }
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    return await invoke(commandName, { request });
  } catch (error) {
    if (signal?.aborted) throw new DOMException('模型请求已取消', 'AbortError');
    throw error;
  } finally {
    if (cancelRetry) window.clearTimeout(cancelRetry);
    signal?.removeEventListener('abort', cancel);
  }
}

async function modelRequest(path, body, {
  method = 'POST', scope = 'v1', multipart = false, signal, timeoutMs = 120000, providerId: requestedProviderId = '',
  headers: requestedHeaders = {}, auth: requestedAuth, responseEncoding = 'json',
} = {}) {
  const request = generationGatewayRequest(path, body, {
    method, scope, multipart, timeoutMs, providerId: requestedProviderId,
    headers: { accept: responseEncoding === 'binary' ? '*/*' : 'application/json', ...requestedHeaders },
    auth: requestedAuth, responseEncoding,
  });
  const response = await invokeGeneration('generation_request', request, signal);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(modelResponseError(parseModelResponseText(response.body), response.status));
  }
  const data = responseEncoding === 'binary'
    ? {
      __responseBodyBase64: response.bodyBase64 || '',
      __responseContentType: response.contentType || '',
    }
    : parseModelResponseText(response.body);
  if (responseEncoding === 'binary' && !data.__responseBodyBase64) throw new Error('模型服务返回了空的二进制响应');
  if (!data) throw new Error('模型服务返回了无法识别的响应');
  return data;
}

async function modelStreamRequest(path, body, onTextDelta, {
  method = 'POST', scope = 'v1', signal, timeoutMs = 180000,
  headers: requestedHeaders = {}, auth: requestedAuth,
} = {}) {
  const providerId = body?.__providerId || '';
  const request = generationGatewayRequest(path, { ...body, stream: true }, {
    method, scope, timeoutMs, providerId,
    headers: { accept: 'text/event-stream', ...requestedHeaders }, auth: requestedAuth,
  });
  const decoder = new TextDecoder();
  const accumulator = createChatCompletionStreamAccumulator(onTextDelta, (_event) => {
    onTextDelta?.('', _event);
  });
  let pending = '';
  let raw = '';
  let streamError = '';
  const unlisten = await listen('generation-stream-event', ({ payload: event }) => {
    if (event.requestId !== request.requestId) return;
    if (event.error) streamError = event.error;
    if (!event.chunkBase64) return;
    const text = decoder.decode(base64ToBuffer(event.chunkBase64), { stream: true });
    raw += text;
    pending += text;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || '';
    lines.forEach((line) => {
      const parsed = parseChatCompletionSseLine(line);
      if (parsed) accumulator.push(parsed);
    });
  });
  try {
    const response = await invokeGeneration('generation_stream', request, signal);
    if (response.status < 200 || response.status >= 300) {
      const data = parseModelResponseText(response.body);
      throw new Error(modelResponseError(data, response.status));
    }
    if (streamError) throw new Error(streamError);
    const decodedTail = decoder.decode();
    raw += decodedTail;
    pending += decodedTail;
    if (pending) {
      const event = parseChatCompletionSseLine(pending);
      if (event) accumulator.push(event);
    }
    if (accumulator.eventCount) return accumulator.result();
    const data = parseModelResponseText(raw || response.body);
    if (!data) throw new Error('模型服务返回了无法识别的响应');
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content) onTextDelta?.(content);
    return data;
  } finally {
    unlisten();
  }
}

export function createTauriApi(browserFallback) {
  // 仅在确认 Tauri 环境后才读取当前窗口。模块也会被浏览器预览和契约测试导入，
  // 顶层调用 getCurrentWindow 会让非 Tauri 环境在初始化阶段直接崩溃。
  const currentWindow = getCurrentWindow();
  let pendingUpdate = null;
  let pendingUpdateDownloaded = false;
  let updateOperationGeneration = 0;
  const unsupported = (feature) => async () => { throw new Error(`${feature} 尚未迁移到 Tauri 原生层`); };
  const projectDialog = async (directoryOnly = false) => {
    const selected = await openDialog({
      title: directoryOnly ? '打开 Shotloom 画布文件夹' : '打开 Shotloom 画布',
      directory: directoryOnly,
      multiple: false,
      recursive: directoryOnly,
      filters: directoryOnly ? undefined : [{ name: 'Shotloom Project', extensions: ['json'] }],
    });
    if (!selected) return null;
    if (directoryOnly) return command('project:open-folder', selected);
    const project = await command('project:read-file', selected);
    return { project, filePath: selected, projectDir: String(selected).split(/[\\/]/).slice(0, -1).join(platform === 'win32' ? '\\' : '/') };
  };

  return {
    ...browserFallback,
    platform,
    window: {
      minimize: () => currentWindow.minimize(),
      maximize: async () => { await currentWindow.toggleMaximize(); return currentWindow.isMaximized(); },
      close: () => currentWindow.close(),
      confirmClose: () => currentWindow.destroy(),
      cancelClose: async () => true,
      isMaximized: () => currentWindow.isMaximized(),
      getTitle: () => currentWindow.title(),
      createNew: async () => false,
      onMaximizedChange: (callback) => subscribe((handler) => currentWindow.onResized(async () => handler(await currentWindow.isMaximized())), callback),
      onCloseRequested: (callback) => subscribe((handler) => currentWindow.onCloseRequested((event) => { event.preventDefault(); handler('close'); }), callback),
    },
    project: {
      ...browserFallback.project,
      selectParent: () => openDialog({ title: '选择项目保存位置', directory: true, recursive: true }),
      createFolder: (parent, name) => command('project:create-folder', parent, name),
      createLibraryFolder: (parent, name) => command('project:create-library-folder', parent, name),
      renameEntry: (path, name) => command('project:rename-entry', path, name),
      cloneLibraryFolder: (path) => command('project:clone-library-folder', path),
      trashLibraryFolder: (path) => command('project:trash-library-folder', path),
      createEpisodeFolder: (parent, shared, name) => command('project:create-episode-folder', parent, shared, name),
      save: (directory, project) => command('project:save', directory, project),
      getDefaultRoot: () => command('project:get-default-root'),
      ensureRoot: (root) => command('project:ensure-root', root),
      selectRoot: () => openDialog({ title: '选择项目默认保存位置', directory: true, recursive: true }),
      listRoot: (root) => command('project:list-root', root),
      openDialog: () => projectDialog(false),
      openFolderDialog: () => projectDialog(true),
      openFolder: (directory) => command('project:open-folder', directory),
      readFile: (path) => command('project:read-file', path),
      syncCurrent: async () => true,
      getWindowProjectDir: async () => sessionProjectDir() || null,
      setWindowProjectDir: async () => true,
      setWindowProjectName: (name) => currentWindow.setTitle(name ? `${name} - Shotloom` : 'Shotloom'),
      focusExistingWindow: async () => false,
      focusOtherWindow: async () => false,
      showInFolder: (path) => shellOpen(path).then(() => ({ ok: true })),
      cloneFolder: (path, name) => command('project:clone-folder', path, name),
      trashFolder: (path) => command('project:trash-folder', path),
      onCloneProgress: () => () => {},
      exportPackage: exportProjectPackage,
      importPackage: importProjectPackage,
      exportLibraryFolder: unsupported('文件夹 ZIP 导出'),
      migrateRoot: async (projects, root) => ({ projects, root, recent: projects }),
    },
    recent: {
      list: () => command('recent:list'),
      add: (project) => command('recent:add', project),
      remove: (path) => command('recent:remove', path),
    },
    file: {
      ...browserFallback.file,
      pathForFile: (file) => file?.path || '',
      importAsset: async () => {
        const paths = await openDialog({
          title: '导入素材文件',
          multiple: true,
          directory: false,
        });
        return (Array.isArray(paths) ? paths : paths ? [paths] : []).map((path) => ({ path, filePath: path, name: basename(path) }));
      },
      pickResource: async (resourceType) => {
        const filters = resourceFileDialogFilters(resourceType);
        const resourceLabel = filters?.[0]?.name || '资源';
        const path = await openDialog({
          title: `选择${resourceLabel}文件`,
          multiple: false,
          directory: false,
          filters,
        });
        return path ? { path, filePath: path, name: basename(path) } : null;
      },
      saveJson: async (defaultName, data) => {
        const path = await saveDialog({ defaultPath: defaultName, filters: [{ name: 'JSON', extensions: ['json'] }] });
        if (!path) return null;
        await writeBytes(path, new TextEncoder().encode(JSON.stringify(data, null, 2)));
        return { path };
      },
      readArrayBuffer: async (path) => base64ToBuffer(await command('file:read-array-buffer', path)),
      readImagePreview,
      applyColoredPencil: async (source, preferredName = 'colored-pencil.png') => command(
        'file:apply-colored-pencil',
        source,
        await uniqueProjectAssetPath(preferredName),
      ),
      cropImageToProject: async (source, preferredName = 'cropped-image.png', crop) => command(
        'file:crop-image',
        source,
        await uniqueProjectAssetPath(preferredName),
        crop,
      ),
      hasAudio: (source) => command('file:has-audio', source),
      separateAudioToProject: async (source, audioName = 'extracted-audio.m4a', videoName = 'silent-video.mp4') => command(
        'file:separate-audio',
        source,
        await uniqueProjectAssetPath(audioName),
        await uniqueProjectAssetPath(videoName),
      ),
      checksum: (path) => command('file:checksum', path),
      getGlobalAssetRoot: () => command('file:global-asset-root'),
      trash: (path) => command('file:trash', path),
      pathExists: (path) => command('file:path-exists', path),
      resolveUniqueFilePath: (directory, name) => command('file:resolve-unique-path', directory, name),
      writeFileToPath: (path, buffer) => writeBytes(path, buffer),
      writeFileChunk: (path, buffer, append = true) => writeBytes(path, buffer, append),
      copyToProject: async (source, preferredName) => command('file:copy', source, await uniqueProjectAssetPath(preferredName || basename(source))),
      copyToDirectory: async (source, directory, preferredName) => {
        const target = await command('file:resolve-unique-path', directory, preferredName || basename(source));
        return command('file:copy', source, target);
      },
      saveDataUrlToProject: async (dataUrl, preferredName = 'resource.png') => {
        const payload = String(dataUrl).split(',')[1] || '';
        return command('file:write', await uniqueProjectAssetPath(preferredName), payload, false);
      },
      downloadUrlToProject: async (url, preferredName, downloadAuth = null) => {
        const remoteName = url ? basename(new URL(url).pathname) : '';
        const target = await uniqueProjectAssetPath(preferredName || remoteName || 'download.bin');
        return invokeGeneration('generation_download', {
          requestId: generationRequestId(), providerId: downloadAuth?.providerId || '',
          url: url || undefined,
          path: downloadAuth?.endpointPath || undefined,
          scope: downloadAuth?.endpointScope || 'root',
          method: downloadAuth?.endpointMethod || 'GET',
          target, headers: Object.entries(downloadAuth?.headers || {}),
          auth: downloadAuth?.auth || { type: 'none' }, timeoutMs: 900000,
        });
      },
      saveArrayBuffer: async (defaultName, buffer) => {
        const path = await saveDialog({ defaultPath: defaultName });
        return path ? writeBytes(path, buffer) : null;
      },
      getDownloadDir: async () => localStorage.getItem('shotloom-download-dir') || '',
      selectDownloadDir: async () => {
        const path = await openDialog({ directory: true, recursive: true });
        if (path) localStorage.setItem('shotloom-download-dir', path);
        return path || localStorage.getItem('shotloom-download-dir') || '';
      },
      clearDownloadDir: async () => { localStorage.removeItem('shotloom-download-dir'); return ''; },
      openFolderPath: (path) => shellOpen(path).then(() => ({ ok: true })),
      openProjectAssets: () => shellOpen(sessionProjectAssetRoot()).then(() => ({ ok: true })),
      showItemInFolder: (path) => command('file:show-item-in-folder', path),
      openPath: (path) => shellOpen(path).then(() => ({ ok: true })),
      exportVideoProject: async (project, defaultName = 'video-project.mp4') => {
        const selected = await saveDialog({
          defaultPath: defaultName,
          filters: [{ name: 'MP4 视频', extensions: ['mp4'] }],
        });
        if (!selected) return null;
        const path = String(selected).toLowerCase().endsWith('.mp4') ? selected : `${selected}.mp4`;
        return command('file:export-video-project', path, await materializeVideoProjectAssets(project));
      },
      trimVideo: unsupported('FFmpeg 视频裁剪'),
      concatVideos: unsupported('FFmpeg 视频拼接'),
      probeMedia: async () => ({ duration: null, width: null, height: null }),
      exportResourcePackage: async (payload = {}) => {
        const target = await resourcePackageTarget(payload.name || 'resources');
        if (!target) return null;
        const materials = (payload.materials || []).filter((item) => item.path || item.filePath).map((item) => {
          const { localLibraryMaterialId: _localMaterial, localLibraryAssetId: _localAsset, ...portable } = item;
          return {
            ...portable,
            packagePath: `files/${item.id}-${basename(item.name || item.path || 'resource.bin')}`,
            path: '',
            filePath: '',
            storageScope: 'project',
          };
        });
        const manifest = {
          schema: 'shotloom-resources',
          version: 1,
          scope: payload.scope || 'materials',
          createdAt: new Date().toISOString(),
          materials,
          assets: (payload.assets || []).map((item) => {
            const { localLibraryAssetId: _localAsset, ...portable } = item;
            return portable;
          }),
        };
        const byId = new Map((payload.materials || []).map((item) => [item.id, item]));
        const files = materials.map((item) => ({
          source: byId.get(item.id)?.path || byId.get(item.id)?.filePath || '',
          archiveName: item.packagePath,
        }));
        return command('file:export-resource-package', target, manifest, files);
      },
      importResourcePackage: async () => {
        const source = await openDialog({
          multiple: false,
          directory: false,
          filters: [{ name: 'Shotloom Resources', extensions: ['zip'] }],
        });
        if (!source) return null;
        const target = sessionProjectAssetRoot();
        if (!target) throw new Error('请先创建或打开项目');
        return command('file:import-resource-package', source, target);
      },
      exportFilesPackage: async (paths = [], name = 'selected-assets') => {
        const target = await resourcePackageTarget(name);
        if (!target) return null;
        const files = [...new Set(paths)].map((source, index) => ({
          source,
          archiveName: `files/${index + 1}-${basename(source) || 'resource.bin'}`,
        }));
        return command('file:export-resource-package', target, {
          schema: 'shotloom-resource-files', version: 1, createdAt: new Date().toISOString(),
        }, files);
      },
      exportFile: async (source, preferredName = '') => {
        const fileName = basename(preferredName || source) || 'resource.bin';
        const downloadDir = localStorage.getItem('shotloom-download-dir') || '';
        const target = downloadDir
          ? await command('file:resolve-unique-path', downloadDir, fileName)
          : await saveDialog({ defaultPath: fileName });
        if (!target) return null;
        const result = await command('file:copy', source, target);
        return { ...result, ok: true, count: 1, direct: true };
      },
    },
    localAssets: {
      getCatalog: () => command('storage:get', 'local-asset-library.json', {
        storageVersion: 1, materials: [], assets: [], references: [],
      }),
      setCatalog: (catalog) => command('storage:set', 'local-asset-library.json', catalog),
    },
    skills: {
      getGlobal: async () => withBuiltInSkills(await command('storage:get', 'global-skills.json', { storageVersion: 1, skills: [] })),
      setGlobal: async (storage) => withBuiltInSkills(await command('storage:set', 'global-skills.json', withoutBuiltInSkills(storage))),
    },
    recipes: {
      getGlobal: async () => withBuiltInRecipes(await command('storage:get', 'global-recipes.json', { storageVersion: 1, recipes: [] })),
      setGlobal: async (storage) => withBuiltInRecipes(await command('storage:set', 'global-recipes.json', withoutBuiltInRecipes(storage))),
    },
    settings: {
      // Tauri settings must be sourced exclusively from the native store. Merging the
      // browser fallback here used to leak values such as `browser/projects` into the
      // desktop app and made real projects resolve relative to the dev working dir.
      get: () => command('settings:get'),
      set: (settings) => command('settings:set', settings),
      refreshBalance: async () => {
        const settings = await command('settings:get');
        const configs = settings.providerConfigs || {};
        const hasKey = Object.values(configs).some((c) => c?.apiKey?.trim());
        return command('settings:set', { ...settings, apiKeyValid: hasKey, accountSyncError: '' });
      },
      setTokenGroup: (id) => command('settings:set-token-group', id),
    },
    model: {
      chatCompletion: (body) => modelRequest(body.__endpointPath || '/chat/completions', body, { method: body.__endpointMethod || 'POST', scope: body.__endpointScope || 'v1', signal: body.__signal, timeoutMs: body.__timeoutMs, headers: body.__headers, auth: body.__auth, responseEncoding: body.__responseEncoding || 'json' }),
      chatCompletionStream: (body, onTextDelta) => modelStreamRequest(body.__endpointPath || '/chat/completions', body, onTextDelta, { method: body.__endpointMethod || 'POST', scope: body.__endpointScope || 'v1', signal: body.__signal, timeoutMs: body.__timeoutMs, headers: body.__headers, auth: body.__auth }),
      imageGeneration: (body) => modelRequest(body.__endpointPath || '/images/generations', body, { method: body.__endpointMethod || 'POST', scope: body.__endpointScope || 'v1', multipart: Boolean(body.__multipart), signal: body.__signal, timeoutMs: body.__timeoutMs, headers: body.__headers, auth: body.__auth, responseEncoding: body.__responseEncoding || 'json' }),
      videoGeneration: (body) => modelRequest(body.__endpointPath || '/contents/generations/tasks', body, { method: body.__endpointMethod || 'POST', scope: body.__endpointScope || 'root', signal: body.__signal, timeoutMs: body.__timeoutMs, headers: body.__headers, auth: body.__auth, responseEncoding: body.__responseEncoding || 'json' }),
      videoTask: (request) => {
        const value = typeof request === 'object' ? request : { taskId: request };
        return modelRequest(String(value.endpointPath || '/contents/generations/tasks/{taskId}').replace('{taskId}', encodeURIComponent(value.taskId)), null, { method: value.endpointMethod || 'GET', scope: value.endpointScope || 'root', signal: value.signal, timeoutMs: value.timeoutMs || 60000, providerId: value.providerId || '', headers: value.headers, auth: value.auth });
      },
    },
    update: {
      check: async () => {
        try {
          const update = await checkUpdate();
          if (pendingUpdate && pendingUpdate !== update) {
            await pendingUpdate.close().catch(() => {});
          }
          pendingUpdate = update;
          pendingUpdateDownloaded = false;
          return {
            hasUpdate: Boolean(update),
            downloaded: false,
            info: update ? { version: update.version, releaseNotes: update.body || '' } : null,
          };
        } catch (error) {
          if (pendingUpdate) await pendingUpdate.close().catch(() => {});
          pendingUpdate = null;
          pendingUpdateDownloaded = false;
          return { hasUpdate: false, downloaded: false, info: null, error: error?.message || String(error) };
        }
      },
      download: async (onProgress) => {
        if (!pendingUpdate) return { ok: false, error: '请先检查更新。' };
        const operationGeneration = ++updateOperationGeneration;
        const update = pendingUpdate;
        let received = 0;
        let total = 0;
        try {
          await update.download((event) => {
            if (operationGeneration !== updateOperationGeneration || update !== pendingUpdate) return;
            if (event.event === 'Started') {
              received = 0;
              total = Number(event.data.contentLength || 0);
            } else if (event.event === 'Progress') {
              received += Number(event.data.chunkLength || 0);
            } else if (event.event === 'Finished' && total > 0) {
              received = total;
            }
            onProgress?.({
              received,
              total,
              percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0,
            });
          });
          if (operationGeneration !== updateOperationGeneration || update !== pendingUpdate) {
            return { ok: false, cancelled: true, error: '下载已取消' };
          }
          pendingUpdateDownloaded = true;
          return {
            ok: true,
            info: {
              version: pendingUpdate.version,
              releaseNotes: pendingUpdate.body || '',
              fileSize: total || undefined,
            },
          };
        } catch (error) {
          if (operationGeneration !== updateOperationGeneration) {
            return { ok: false, cancelled: true, error: '下载已取消' };
          }
          return { ok: false, error: error?.message || String(error) };
        }
      },
      cancelDownload: async () => {
        updateOperationGeneration += 1;
        const update = pendingUpdate;
        pendingUpdate = null;
        pendingUpdateDownloaded = false;
        if (update) await update.close().catch(() => {});
        return { ok: true };
      },
      checkFreshness: async () => {
        if (!pendingUpdate || !pendingUpdateDownloaded) return { superseded: false };
        const downloadedVersion = String(pendingUpdate.version || '0');
        try {
          const candidate = await checkUpdate();
          if (!candidate) return { superseded: false };
          const parts = (value) => String(value).split(/[.-]/).map((part) => Number(part) || 0);
          const left = parts(candidate.version);
          const right = parts(downloadedVersion);
          const newer = Array.from({ length: Math.max(left.length, right.length) })
            .some((_, index) => left[index] !== right[index]
              && left[index] > right[index]
              && left.slice(0, index).every((value, prefix) => value === right[prefix]));
          if (!newer) {
            await candidate.close().catch(() => {});
            return { superseded: false };
          }
          await pendingUpdate.close().catch(() => {});
          pendingUpdate = candidate;
          pendingUpdateDownloaded = false;
          updateOperationGeneration += 1;
          return {
            superseded: true,
            info: { version: candidate.version, releaseNotes: candidate.body || '' },
          };
        } catch (error) {
          // Freshness probing is fail-open: an intermittent network error must not
          // make an already verified package impossible to install.
          return { superseded: false, warning: error?.message || String(error) };
        }
      },
      executeRestart: async () => {
        if (!pendingUpdate || !pendingUpdateDownloaded) {
          return { ok: false, error: '更新尚未下载完成。' };
        }
        try {
          await pendingUpdate.install();
          await relaunch();
          return { ok: true };
        } catch (error) {
          return { ok: false, error: error?.message || String(error) };
        }
      },
    },
    notifyTask: async () => ({ shown: false, reason: 'tauri-notification-plugin-not-installed' }),
  };
}
