import { t } from '../i18n/index.ts';
import { isRecord } from '@/utils/typeGuards';
import { mediaExtension, MEDIA_MIME_BY_EXTENSION } from '@/utils/mediaType.ts';
import { projectAssetRoot as resolveProjectAssetRoot } from '@/utils/assetPaths.ts';
import { invoke as nativeInvoke, type InvokeArgs, type InvokeOptions } from '@tauri-apps/api/core';
import { localizeNativeError } from '../i18n/index.ts';

async function invoke<T>(cmd: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  try { return await nativeInvoke<T>(cmd, args, options); }
  catch (error) {
    const message = localizeNativeError(error);
    if (message === undefined) throw error;
    throw new Error(message);
  }
}

import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { check as checkUpdate, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { withBuiltInSkills, withoutBuiltInSkills } from './builtInSkills';
import { withBuiltInRecipes, withoutBuiltInRecipes } from './builtInRecipes';
import { modelJsonRequestBody, modelRequestEntries } from '@/utils/modelRequestBody.ts';
import { modelResponseError, parseModelResponseText } from '@/utils/modelResponseParsing.ts';
import { createChatCompletionStreamAccumulator, parseChatCompletionSseLine } from '@/utils/chatCompletionStream.ts';
import { createAgentProtocolAccumulator, normalizeAgentProtocolResponse } from '@/utils/agentProtocolStream.ts';
import { resourceFileDialogFilters } from '@/utils/resourceFileTypes.ts';
import type { JsonObject } from './agentTypes';

// ---------------------------------------------------------------------------
// 类型契约：只描述本文件真正读写的字段，形状与 src-tauri 的 serde 定义对齐
// （camelCase），不做任何运行时转换。
// ---------------------------------------------------------------------------

/** command() 支持的原生通道；每个字面量对应 src-tauri 的一个 #[tauri::command]。 */
type CommandChannel =
  | 'clipboard:stage-workflow'
  | 'clipboard:read-staged-sentinel'
  | 'clipboard:load-staged-payload'
  | 'platform'
  | 'settings:get'
  | 'settings:set'
  | 'settings:set-token-group'
  | 'storage:get'
  | 'storage:set'
  | 'file:global-asset-root'
  | 'file:trash'
  | 'file:show-item-in-folder'
  | 'file:open-path'
  | 'file:export-resource-package'
  | 'file:import-resource-package'
  | 'project:get-default-root'
  | 'project:ensure-root'
  | 'project:create-folder'
  | 'project:create-library-folder'
  | 'project:rename-entry'
  | 'project:clone-folder'
  | 'project:clone-library-folder'
  | 'project:list-root'
  | 'project:save'
  | 'project:snapshot-list'
  | 'project:snapshot-create'
  | 'project:snapshot-read'
  | 'diagnostics:build'
  | 'project:read-file'
  | 'project:open-folder'
  | 'project:export-package'
  | 'project:import-package'
  | 'project:create-episode-folder'
  | 'project:trash-folder'
  | 'project:trash-library-folder'
  | 'recent:list'
  | 'recent:add'
  | 'recent:remove'
  | 'file:read-array-buffer'
  | 'file:read-image-preview'
  | 'file:apply-colored-pencil'
  | 'file:crop-image'
  | 'file:probe-media'
  | 'file:has-audio'
  | 'file:separate-audio'
  | 'file:capture-video-frame'
  | 'file:concat-videos'
  | 'file:write'
  | 'file:copy'
  | 'file:export-video-project'
  | 'media:task-cancel'
  | 'harness:runtime-status'
  | 'harness:start-runtime'
  | 'harness:stop-runtime'
  | 'harness:restart-runtime'
  | 'file:path-exists'
  | 'file:checksum'
  | 'file:resolve-unique-path';

/**
 * 原生返回值里本文件需要按结构读取的字段。IPC 返回的是未知 JSON，这里只声明
 * 读取过的键；commandJson() 是 invoke<T>() 之外的同一套声明式约定，不产生额外运行时行为。
 */
interface NativeRecord { [key: string]: unknown; }
interface NativeWriteResult extends NativeRecord { path?: string; }
interface SettingsRecord extends NativeRecord {
  apiKeyValid?: boolean;
  providerConfigs?: Record<string, { apiKey?: string }>;
}
interface GlobalStorageRecord extends NativeRecord { storageVersion?: number; }
/** model.videoTask 的入参：既可能是请求对象，也可能只是 taskId。 */
interface VideoTaskRequest extends NativeRecord {
  taskId?: string | undefined;
  providerId?: string | undefined;
  endpointPath?: string | undefined;
  endpointMethod?: string | undefined;
  endpointScope?: string | undefined;
  timeoutMs?: number | undefined;
  signal?: unknown;
  headers?: unknown;
  auth?: unknown;
  body?: NativeRecord | undefined;
}
/** 交给 UI 的下载进度（update.download 的回调契约）。 */
interface UpdateDownloadProgress { received: number; total: number; percent: number; }
interface NativeFileRecord extends NativeRecord {
  id?: string;
  name?: string;
  path?: string;
  filePath?: string;
  packagePath?: string;
}
/** file:export-resource-package 的入参形状：本文件只读这些字段。 */
interface ResourcePackagePayload extends NativeRecord {
  name?: string;
  scope?: string;
  materials?: NativeFileRecord[];
  assets?: NativeRecord[];
}

/** 剪辑工程 JSON：只有贴图落盘逻辑读到的字段。 */
interface VideoProjectAsset extends NativeRecord {
  type?: string;
  sourceUrl?: string;
  sourceFile?: string;
  width?: number;
  height?: number;
}
interface SerializedVideoProject extends NativeRecord { assets?: VideoProjectAsset[]; }

type Unlisten = () => void;

interface ImagePreviewJob {
  resolve: (value: ArrayBuffer) => void;
  reject: (reason: unknown) => void;
  task: () => Promise<ArrayBuffer>;
}

// 生成网关：与 generation_gateway.rs 的 GenerationRequest / GenerationDownload 一致。
// 渲染进程只发送 providerId 和端点元信息，凭据与 baseUrl 一律由 Rust 注入。
interface ModelRequestBody extends NativeRecord {
  __providerId?: string | undefined;
  __agentProtocol?: string | undefined;
  __endpointPath?: string | undefined;
  __endpointMethod?: string | undefined;
  __endpointScope?: string | undefined;
  __responseEncoding?: string | undefined;
  __timeoutMs?: number | undefined;
  __multipart?: unknown;
  __signal?: unknown;
  __headers?: unknown;
  __auth?: unknown;
  __inputImages?: unknown;
  __imageField?: unknown;
  __maskResource?: unknown;
  __maskField?: unknown;
  stream?: unknown;
}
interface GenerationAuth {
  type?: string | undefined;
  name?: string | undefined;
  prefix?: string | undefined;
}
/** GenerationResource：filePath / url 二选一，显式 undefined 是有意义的取值。 */
interface GenerationResourcePayload {
  fieldName: string;
  filePath: string | undefined;
  url: string | undefined;
  fileName: string;
  mimeType: string;
}
interface GenerationGatewayRequest {
  requestId: string;
  providerId: string;
  path: string;
  scope: string;
  method: string;
  headers: [string, string][];
  auth: GenerationAuth | undefined;
  body: unknown;
  formFields: [string, string][];
  resources: GenerationResourcePayload[];
  responseEncoding: string;
  timeoutMs: number;
}
/** GenerationDownload：url 与 path 互斥，未设置的那一个必须是 undefined。 */
interface GenerationDownloadRequest {
  requestId: string;
  providerId: string;
  url: string | undefined;
  path: string | undefined;
  scope: string;
  method: string;
  target: string;
  headers: [string, string][];
  auth: GenerationAuth | undefined;
  timeoutMs: number;
}
type GenerationInvokeRequest = GenerationGatewayRequest | GenerationDownloadRequest;
interface GenerationResponse {
  status: number;
  body: string;
  bodyBase64: string | null;
  contentType: string;
}
interface GenerationStreamEvent {
  requestId: string;
  chunkBase64: string | null;
  error: string | null;
  done: boolean;
}
/** generation_request / generation_stream 的透传选项：未知值原样交给网关判断。 */
interface GatewayRequestOptions {
  method?: string;
  scope?: string;
  multipart?: boolean;
  timeoutMs?: unknown;
  providerId?: string;
  headers?: unknown;
  auth?: unknown;
  signal?: unknown;
  responseEncoding?: string;
}
interface DownloadAuth extends NativeRecord {
  providerId?: string;
  endpointPath?: string;
  endpointScope?: string;
  endpointMethod?: string;
  headers?: Record<string, string>;
  auth?: GenerationAuth;
}

// 流式工具的本地契约：两个累计器只声明了 `(text: string) => void` 的回调，而这里的
// onTextDelta 还会带上第二个事件参数，返回值也只用到 push/result/eventCount 三个成员，
// 所以在本文件里集中声明一次调用方真实依赖的形状。
type StreamTextDelta = (text: string, event?: JsonObject) => void;
interface StreamAccumulator {
  push: (event?: unknown) => void;
  result: () => unknown;
  readonly eventCount: number;
}
const createChatCompletionStream = createChatCompletionStreamAccumulator as unknown as (
  onTextDelta?: StreamTextDelta | undefined,
  onEvent?: ((event: JsonObject) => void) | undefined,
) => StreamAccumulator;
const createProtocolStream = createAgentProtocolAccumulator as unknown as (
  protocol: string,
  onTextDelta?: StreamTextDelta | undefined,
  onEvent?: ((event: JsonObject) => void) | undefined,
) => StreamAccumulator;
const normalizeProtocolResponse = normalizeAgentProtocolResponse as unknown as (
  protocol: string,
  data: unknown,
  onTextDelta?: StreamTextDelta | undefined,
) => unknown;

/** IPC / localStorage 返回的未知值 -> 可按键读取的记录（非对象时视为空记录）。 */
function asRecord(value: unknown): NativeRecord {
  return isRecord(value) ? value : {};
}

/** 取消信号只可能是 AbortSignal；其他值按“没有信号”处理，与原先的可选链一致。 */
function asSignal(value: unknown): AbortSignal | undefined {
  return value instanceof AbortSignal ? value : undefined;
}

function asAuth(value: unknown): GenerationAuth | undefined {
  return isRecord(value) ? value as GenerationAuth : undefined;
}

/** 未知错误的展示文案：与原先的 `error?.message || String(error)` 等价。 */
function errorMessage(value: unknown): string {
  const message = asRecord(value).message;
  return typeof message === 'string' && message ? message : String(value);
}

const command = (channel: CommandChannel, ...args: unknown[]): Promise<unknown> => {
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
    case 'file:open-path': return invoke('file_open_path', { path: args[0] });
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
    case 'project:snapshot-list': return invoke('project_snapshot_list', { directory: args[0] });
    case 'project:snapshot-create': return invoke('project_snapshot_create', { directory: args[0], record: args[1] });
    case 'project:snapshot-read': return invoke('project_snapshot_read', { directory: args[0], id: args[1] });
    case 'diagnostics:build': return invoke('diagnostics_build', { files: args[0] });
    case 'project:read-file': return invoke('project_read_file', { path: args[0] });
    case 'project:open-folder': return invoke('project_open_folder', { directory: args[0] });
    case 'project:export-package': return invoke('project_export_package', { source: args[0], target: args[1] });
    case 'project:import-package': return invoke('project_import_package', { source: args[0], targetRoot: args[1] });
    case 'project:create-episode-folder': return invoke('project_create_episode_folder', { parent: args[0], shared: args[1], name: args[2] });
    case 'project:trash-folder':
    case 'project:trash-library-folder': return invoke('project_trash_entry', { path: args[0] });
    case 'clipboard:stage-workflow': return invoke('clipboard_stage_workflow', { payload: args[0] });
    case 'clipboard:read-staged-sentinel': return invoke('clipboard_read_staged_sentinel');
    case 'clipboard:load-staged-payload': return invoke('clipboard_load_staged_payload', { snapshotId: args[0] });
    case 'recent:list': return invoke('recent_list');
    case 'recent:add': return invoke('recent_add', { project: args[0] });
    case 'recent:remove': return invoke('recent_remove', { path: args[0] });
    case 'file:read-array-buffer': return invoke('file_read_array_buffer', { path: args[0] });
    case 'file:read-image-preview': return invoke('file_read_image_preview', { path: args[0], maxSize: args[1] });
    case 'file:apply-colored-pencil': return invoke('file_apply_colored_pencil', { source: args[0], target: args[1] });
    case 'file:crop-image': return invoke('file_crop_image', { source: args[0], target: args[1], crop: args[2] });
    case 'file:probe-media': return invoke('file_probe_media', { source: args[0] });
    case 'file:has-audio': return invoke('file_has_audio', { source: args[0] });
    case 'file:separate-audio': return invoke('file_separate_audio', {
      source: args[0], audioTarget: args[1], silentVideoTarget: args[2],
    });
    case 'file:capture-video-frame': return invoke('file_capture_video_frame', { source: args[0], target: args[1], seconds: args[2] });
    case 'file:concat-videos': return invoke('file_concat_videos', { sources: args[0], target: args[1] });
    case 'file:write': return invoke('file_write', { path: args[0], data: args[1], append: Boolean(args[2]) });
    case 'file:copy': return invoke('file_copy', { source: args[0], target: args[1] });
    case 'file:export-video-project': return invoke('file_export_video_project', {
      requestId: args[2] || generationRequestId(), target: args[0], project: args[1],
    });
    case 'media:task-cancel': return invoke('media_task_cancel', { requestId: args[0] });
    case 'harness:runtime-status': return invoke('harness_runtime_status');
    case 'harness:start-runtime': return invoke('start_harness_runtime', { options: args[0] || {} });
    case 'harness:stop-runtime': return invoke('stop_harness_runtime');
    case 'harness:restart-runtime': return invoke('restart_harness_runtime', { options: args[0] || {} });
    case 'file:path-exists': return invoke('file_path_exists', { path: args[0] });
    case 'file:checksum': return invoke('file_checksum', { path: args[0] });
    case 'file:resolve-unique-path': return invoke('file_resolve_unique_path', { directory: args[0], name: args[1] });
    default: return Promise.reject(new Error(t("ui.tauriApi.text.0de5a0f2", { value0: channel })));
  }
};

/**
 * 与 invoke<T>() 同一套声明式约定：只给原生已保证的返回值标注形状，
 * 不增加 await、不复制、不改写数据。
 */
function commandJson<T>(channel: CommandChannel, ...args: unknown[]): Promise<T> {
  return command(channel, ...args) as Promise<T>;
}

const platform = navigator.userAgent.includes('Windows') ? 'win32'
  : navigator.userAgent.includes('Macintosh') ? 'darwin' : 'linux';

function subscribe<H>(
  register: (handler: (value: H) => void) => Promise<Unlisten>,
  callback: (value: H) => void,
) {
  let disposed = false;
  let unlisten: Unlisten | null = null;
  Promise.resolve(register(callback)).then((dispose) => {
    if (disposed) dispose?.();
    else unlisten = dispose;
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

function bytesToBase64(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBuffer(value: unknown): ArrayBuffer {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function rasterizeImageDataUrl(dataUrl: string, width = 512, height = 512) {
  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(Number(width) || image.naturalWidth || 512));
      canvas.height = Math.max(1, Math.round(Number(height) || image.naturalHeight || 512));
      const context = canvas.getContext('2d');
      if (!context) return reject(new Error(t("ui.tauriApi.text.697b1eb0")));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = () => reject(new Error(t("ui.tauriApi.text.6dcbf81c")));
    image.src = dataUrl;
  });
}

async function materializeVideoProjectAssets(project: unknown): Promise<SerializedVideoProject> {
  let prepared: SerializedVideoProject;
  try {
    prepared = JSON.parse(JSON.stringify(project));
  } catch (cause) {
    throw new Error(t("ui.tauriApi.text.d0c4009c", { value0: cause instanceof Error ? cause.message : String(cause) }));
  }
  for (const asset of prepared?.assets || []) {
    if (asset.type !== 'image' || asset.sourceFile || !String(asset.sourceUrl || '').startsWith('data:image/')) continue;
    const dataUrl = String(asset.sourceUrl);
    const pngDataUrl = dataUrl.startsWith('data:image/png;')
      ? dataUrl
      : await rasterizeImageDataUrl(dataUrl, asset.width, asset.height);
    const safeName = String(asset.name || asset.id || 'sticker').replace(/[^\p{L}\p{N}._-]+/gu, '-');
    const result = await commandJson<NativeWriteResult>(
      'file:write',
      await uniqueProjectAssetPath(`${safeName || 'sticker'}.png`),
      pngDataUrl.split(',')[1] || '',
      false,
    );
    asset.sourceFile = result?.path || '';
    if (!asset.sourceFile) throw new Error(t("ui.tauriApi.text.3544d3dc", { value0: String(asset.name || asset.id) }));
  }
  return prepared;
}

const imagePreviewQueue: ImagePreviewJob[] = [];
const imagePreviewInFlight = new Map<string, Promise<ArrayBuffer>>();
let activeImagePreviewReads = 0;

function drainImagePreviewQueue() {
  while (activeImagePreviewReads < 4 && imagePreviewQueue.length) {
    const job = imagePreviewQueue.shift();
    if (!job) break;
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

function readImagePreview(path: string, maxSize = 960): Promise<ArrayBuffer> {
  const key = `${path}|${maxSize}`;
  const inflight = imagePreviewInFlight.get(key);
  if (inflight) return inflight;
  const pending = new Promise<ArrayBuffer>((resolve, reject) => {
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

type ProjectLocation = {
  projectDir: string | null;
  project: { library?: { assetRootDir?: string }; series?: { assetRootDir?: string } };
};

// 由项目存储绑定惰性读取，避免原生桥反向 import 项目生命周期形成初始化环。
let projectSource: (() => ProjectLocation) | undefined;
export function bindProjectSource(read: () => ProjectLocation): void {
  projectSource = read;
}

function projectAssetRoot(): string {
  const current = projectSource?.();
  return resolveProjectAssetRoot(current?.project, current?.projectDir || null);
}

function basename(value: unknown = '') {
  return String(value).split(/[\\/]/).pop() || '';
}

function mimeType(path: unknown = '') {
  return MEDIA_MIME_BY_EXTENSION[mediaExtension(String(path))] || 'application/octet-stream';
}

async function writeBytes(path: string, bytes: ArrayBuffer | Uint8Array, append = false) {
  return command('file:write', path, bytesToBase64(bytes), append);
}

async function uniqueProjectAssetPath(preferredName = 'resource.bin'): Promise<string> {
  const assetRoot = projectAssetRoot();
  if (!assetRoot) throw new Error(t("ui.tauriApi.text.c090e133"));
  return commandJson<string>('file:resolve-unique-path', assetRoot, preferredName);
}

function packageFileName(value: unknown = 'resources') {
  const base = String(value || 'resources').replace(/[\\/:*?"<>|]+/g, '-').replace(/\.zip$/i, '');
  return `${base}.shotloom-resources.zip`;
}

function projectPackageFileName(value: unknown = 'project') {
  const base = String(value || 'project').replace(/[\\/:*?"<>|]+/g, '-').replace(/\.zip$/i, '');
  return `${base}.shotloom-project.zip`;
}

async function exportProjectPackage(directory: string, name = '') {
  const fileName = projectPackageFileName(name || basename(directory) || 'project');
  const target = await saveDialog({
    defaultPath: fileName,
    filters: [{ name: 'Shotloom Project', extensions: ['zip'] }],
  });
  if (!target) return null;
  return command('project:export-package', directory, target);
}

async function importProjectPackage(targetRoot: string) {
  const source = await openDialog({
    title: t("ui.tauriApi.text.3015ae0e"),
    multiple: false,
    directory: false,
    filters: [{ name: 'Shotloom Project', extensions: ['zip'] }],
  });
  if (!source) return null;
  return command('project:import-package', source, targetRoot);
}

async function resourcePackageTarget(name: unknown): Promise<string | null> {
  const fileName = packageFileName(name);
  const downloadDir = await invoke<string>('download_directory_get');
  if (downloadDir) return commandJson<string>('file:resolve-unique-path', downloadDir, fileName);
  return saveDialog({
    defaultPath: fileName,
    filters: [{ name: 'Shotloom Resources', extensions: ['zip'] }],
  });
}

function generationRequestId() {
  return `generation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function generationResource(resource: unknown = {}, fieldName = 'image', fallbackName = 'input.bin'): GenerationResourcePayload {
  const source = asRecord(resource);
  const filePath = String(source.filePath || source.path || '');
  return {
    fieldName: String(source.fieldName || fieldName),
    filePath: filePath || undefined,
    url: String(source.url || source.previewUrl || source.dataUrl || '') || undefined,
    fileName: String(source.name || source.fileName || basename(filePath) || fallbackName),
    mimeType: String(source.mimeType || mimeType(filePath)),
  };
}

function generationGatewayRequest(path: string, body: ModelRequestBody | undefined, {
  method = 'POST', scope = 'v1', multipart = false, timeoutMs = 120000,
  providerId: requestedProviderId = '', headers: requestedHeaders = {}, auth, responseEncoding = 'json',
}: GatewayRequestOptions = {}): GenerationGatewayRequest {
  const providerId = requestedProviderId || String(body?.__providerId || '');
  const headers = Object.entries(asRecord(requestedHeaders))
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  const resources: GenerationResourcePayload[] = [];
  const formFields: [string, string][] = [];
  let requestBody: unknown;
  if (multipart) {
    modelRequestEntries(body, { multipart: true }).forEach(([key, value]) => {
      if (value === null || value === '') return;
      formFields.push([key, typeof value === 'object' ? JSON.stringify(value) : String(value)]);
    });
    const inputImages = Array.isArray(body?.__inputImages) ? body.__inputImages : [];
    inputImages.forEach((resource: unknown, index: number) => {
      resources.push(generationResource(
        resource,
        String(asRecord(resource).fieldName || body?.__imageField || 'image'),
        `input-${index + 1}.png`,
      ));
    });
    if (body?.__maskResource) {
      resources.push(generationResource(body.__maskResource, String(body.__maskField || 'mask'), 'mask.png'));
    }
  } else if (method !== 'GET') {
    requestBody = modelJsonRequestBody(body);
  }
  return {
    requestId: generationRequestId(), providerId, path, scope, method,
    headers, auth: asAuth(auth) || { type: 'bearer' }, body: requestBody,
    formFields, resources, responseEncoding, timeoutMs: Math.max(1000, Number(timeoutMs) || 120000),
  };
}

async function invokeGeneration(
  commandName: string,
  request: GenerationInvokeRequest,
  signal?: unknown,
): Promise<GenerationResponse> {
  const abortSignal = asSignal(signal);
  let cancelRetry: number | undefined;
  const cancelOnce = () => invoke('generation_cancel', { requestId: request.requestId }).catch(() => undefined);
  const cancel = () => {
    cancelOnce();
    cancelRetry = window.setTimeout(cancelOnce, 25);
  };
  if (abortSignal?.aborted) {
    cancel();
    throw new DOMException(t("ui.tauriApi.text.f25ccd81"), 'AbortError');
  }
  abortSignal?.addEventListener('abort', cancel, { once: true });
  try {
    return await invoke<GenerationResponse>(commandName, { request });
  } catch (error) {
    if (abortSignal?.aborted) throw new DOMException(t("ui.tauriApi.text.f25ccd81"), 'AbortError');
    throw error;
  } finally {
    if (cancelRetry) window.clearTimeout(cancelRetry);
    abortSignal?.removeEventListener('abort', cancel);
  }
}

async function modelRequest(path: string, body: ModelRequestBody | undefined, {
  method = 'POST', scope = 'v1', multipart = false, signal, timeoutMs = 120000, providerId: requestedProviderId = '',
  headers: requestedHeaders = {}, auth: requestedAuth, responseEncoding = 'json',
}: GatewayRequestOptions = {}): Promise<unknown> {
  const request = generationGatewayRequest(path, body, {
    method, scope, multipart, timeoutMs, providerId: requestedProviderId,
    headers: { accept: responseEncoding === 'binary' ? '*/*' : 'application/json', ...asRecord(requestedHeaders) },
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
  if (responseEncoding === 'binary' && !data.__responseBodyBase64) throw new Error(t("ui.tauriApi.text.533f8c36"));
  if (!data) throw new Error(t("ui.tauriApi.text.4f183c31"));
  return data;
}

async function modelStreamRequest(path: string, body: ModelRequestBody, onTextDelta?: StreamTextDelta, {
  method = 'POST', scope = 'v1', signal, timeoutMs = 180000,
  headers: requestedHeaders = {}, auth: requestedAuth,
}: GatewayRequestOptions = {}): Promise<unknown> {
  const providerId = String(body?.__providerId || '');
  const protocol = String(body?.__agentProtocol || 'openai-chat-completions');
  const request = generationGatewayRequest(path, { ...body, stream: true }, {
    method, scope, timeoutMs, providerId,
    headers: { accept: 'text/event-stream', ...asRecord(requestedHeaders) }, auth: requestedAuth,
  });
  const decoder = new TextDecoder();
  const accumulator = protocol === 'openai-chat-completions'
    ? createChatCompletionStream(onTextDelta, (_event: JsonObject) => onTextDelta?.('', _event))
    : createProtocolStream(protocol, onTextDelta, (_event: JsonObject) => onTextDelta?.('', _event));
  let pending = '';
  let streamError = '';
  const unlisten = await listen<GenerationStreamEvent>('generation-stream-event', ({ payload: event }) => {
    if (event.requestId !== request.requestId) return;
    if (event.error) streamError = localizeNativeError(event.error) ?? event.error;
    if (!event.chunkBase64) return;
    const text = decoder.decode(base64ToBuffer(event.chunkBase64), { stream: true });
    // 原始 SSE 不再整段留在渲染进程：accumulator 已累积内容，网关回执里也有完整 body，
    // 两份额外的完整副本只会让长回复的峰值内存翻倍。
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
    pending += decodedTail;
    if (pending) {
      const event = parseChatCompletionSseLine(pending);
      if (event) accumulator.push(event);
    }
    if (accumulator.eventCount) return accumulator.result();
    // 没有解析出 SSE 事件时用网关回执的完整 body 兜底；pending 只保留最后一个未换行的片段。
    const data = parseModelResponseText(response.body || pending);
    if (!data) throw new Error(t("ui.tauriApi.text.4f183c31"));
    if (protocol !== 'openai-chat-completions') return normalizeProtocolResponse(protocol, data, onTextDelta);
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content) onTextDelta?.(content);
    return data;
  } finally {
    unlisten();
  }
}

/**
 * 桌面桥对消费方呈现的契约。两个实现各有占位差异：浏览器替身里
 * `confirmClose: async () => true`、`selectParent: async () => 'browser'` 这类
 * 无参兜底签名，和调用方实际传给原生实现的参数个数并不一致（原生侧
 * `confirmClose(action)`、`selectParent` 带选项）。直接把 BrowserFallback 换成
 * `ReturnType<typeof createBrowserFallback>` 会让 projectStore、canvasAdapter、
 * assetStore 等 200 处调用点报错，而报错原因是替身签名太窄，不是调用方的 bug。
 * 因此入参与返回保持同一份动态契约；要收敛成单一声明，必须先统一两套实现的
 * 方法签名，那是独立于 JS→TS 迁移的一步。模块内部仍逐处显式标注类型。
 */
interface BrowserFallback { [key: string]: any; }

export function createTauriApi(browserFallback: BrowserFallback): BrowserFallback {
  // 仅在确认 Tauri 环境后才读取当前窗口。模块也会被浏览器预览和契约测试导入，
  // 顶层调用 getCurrentWindow 会让非 Tauri 环境在初始化阶段直接崩溃。
  const currentWindow = getCurrentWindow();
  let pendingUpdate: Update | null = null;
  let pendingUpdateDownloaded = false;
  let updateOperationGeneration = 0;
  const unsupported = (feature: string) => async () => { throw new Error(t("ui.tauriApi.text.939c904b", { value0: feature })); };
  const projectDialog = async (directoryOnly = false) => {
    const selected = await openDialog({
      title: directoryOnly ? t("ui.tauriApi.text.6f5750ae") : t("ui.tauriApi.text.f157254b"),
      directory: directoryOnly,
      multiple: false,
      recursive: directoryOnly,
      // exactOptionalPropertyTypes：非文件夹选择时让 filters 字段整体缺席，
      // 语义与原来的 undefined 一致（JSON 序列化时 undefined 本来就会被丢弃）。
      ...(directoryOnly ? {} : { filters: [{ name: 'Shotloom Project', extensions: ['sqlite'] }] }),
    });
    if (!selected) return null;
    if (directoryOnly) return command('project:open-folder', selected);
    const project = await command('project:read-file', selected);
    return { project, filePath: selected, projectDir: String(selected).split(/[\\/]/).slice(0, -1).join(platform === 'win32' ? '\\' : '/') };
  };

  return {
    ...browserFallback,
    platform,
    clipboard: {
      ...browserFallback.clipboard,
      stageWorkflow: (payload: NativeRecord) => command('clipboard:stage-workflow', payload),
      readStagedSentinel: () => command('clipboard:read-staged-sentinel'),
      loadStagedPayload: (snapshotId: string) => command('clipboard:load-staged-payload', snapshotId),
    },
    harness: {
      status: () => commandJson<{ running: boolean; ready: boolean; error?: string | null }>('harness:runtime-status'),
      start: (options: { sourceRoot?: string; dataRoot?: string } = {}) => commandJson<{ running: boolean; ready: boolean; error?: string | null }>('harness:start-runtime', options),
      stop: () => commandJson<{ running: boolean; ready: boolean; error?: string | null }>('harness:stop-runtime'),
      restart: (options: { sourceRoot?: string; dataRoot?: string } = {}) => commandJson<{ running: boolean; ready: boolean; error?: string | null }>('harness:restart-runtime', options),
      onReady: (callback: () => void) => subscribe<void>((handler) => listen<void>('harness://ready', () => handler()), callback),
    },
    window: {
      minimize: () => currentWindow.minimize(),
      maximize: async () => { await currentWindow.toggleMaximize(); return currentWindow.isMaximized(); },
      close: () => currentWindow.close(),
      confirmClose: () => currentWindow.destroy(),
      cancelClose: async () => true,
      isMaximized: () => currentWindow.isMaximized(),
      getTitle: () => currentWindow.title(),
      createNew: async () => false,
      onMaximizedChange: (callback: (maximized: boolean) => void) => subscribe<boolean>((handler) => currentWindow.onResized(async () => handler(await currentWindow.isMaximized())), callback),
      onCloseRequested: (callback: (reason: string) => void) => subscribe<string>((handler) => currentWindow.onCloseRequested((event) => { event.preventDefault(); handler('close'); }), callback),
    },
    project: {
      ...browserFallback.project,
      selectParent: () => openDialog({ title: t("ui.tauriApi.text.11ba8b10"), directory: true, recursive: true }),
      createFolder: (parent: string, name: string) => command('project:create-folder', parent, name),
      createLibraryFolder: (parent: string, name: string) => command('project:create-library-folder', parent, name),
      renameEntry: (path: string, name: string) => command('project:rename-entry', path, name),
      cloneLibraryFolder: (path: string) => command('project:clone-library-folder', path),
      trashLibraryFolder: (path: string) => command('project:trash-library-folder', path),
      createEpisodeFolder: (parent: string, shared: unknown, name: string) => command('project:create-episode-folder', parent, shared, name),
      save: (directory: string, project: unknown) => command('project:save', directory, project),
      snapshotList: (directory: string) => command('project:snapshot-list', directory),
      snapshotCreate: (directory: string, record: unknown) => command('project:snapshot-create', directory, record),
      snapshotRead: (directory: string, id: string) => command('project:snapshot-read', directory, id),
      getDefaultRoot: () => command('project:get-default-root'),
      ensureRoot: (root: string) => command('project:ensure-root', root),
      selectRoot: () => openDialog({ title: t("ui.tauriApi.text.15bcf5e5"), directory: true, recursive: true }),
      listRoot: (root: string) => command('project:list-root', root),
      openDialog: () => projectDialog(false),
      openFolderDialog: () => projectDialog(true),
      openFolder: (directory: string) => command('project:open-folder', directory),
      readFile: (path: string) => command('project:read-file', path),
      getEditorSnapshot: (directory: string, nodeId: string) => invoke("editor_snapshot_get", { directory, nodeId }),
      setEditorSnapshot: (directory: string, nodeId: string, snapshot: unknown) => invoke("editor_snapshot_set", { directory, nodeId, snapshot }),
      getEditorRecord: (directory: string, nodeId: string, key: string) => invoke("editor_record_get", { directory, nodeId, key }),
      setEditorRecord: (directory: string, nodeId: string, key: string, value: unknown) => invoke("editor_record_set", { directory, nodeId, key, value }),
      syncCurrent: async (snapshot: { projectDir?: string | null }) => { await invoke('workspace_project_set', {directory: snapshot.projectDir || null}); return true; },
      getWindowProjectDir: () => invoke<string | null>('workspace_project_get'),
      setWindowProjectDir: async (directory: string | null) => { await invoke('workspace_project_set', { directory }); return true; },
      setWindowProjectName: (name: string) => currentWindow.setTitle(name ? `${name} - Shotloom` : 'Shotloom'),
      focusExistingWindow: async () => false,
      focusOtherWindow: async () => false,
      showInFolder: (path: string) => command('file:open-path', path),
      cloneFolder: (path: string, name: string) => command('project:clone-folder', path, name),
      trashFolder: (path: string) => command('project:trash-folder', path),
      onCloneProgress: () => () => {},
      exportPackage: exportProjectPackage,
      importPackage: importProjectPackage,
      exportLibraryFolder: unsupported(t("ui.tauriApi.text.afb2fe48")),
      migrateRoot: async (projects: unknown, root: unknown) => ({ projects, root, recent: projects }),
    },
    recent: {
      list: () => command('recent:list'),
      add: (project: unknown) => command('recent:add', project),
      remove: (path: string) => command('recent:remove', path),
    },
    file: {
      ...browserFallback.file,
      pathForFile: (file: unknown) => asRecord(file).path || '',
      importAsset: async () => {
        const paths = await openDialog({
          title: t("ui.MaterialsView.text.ddd18922"),
          multiple: true,
          directory: false,
        });
        return (Array.isArray(paths) ? paths : paths ? [paths] : []).map((path) => ({ path, filePath: path, name: basename(path) }));
      },
      pickResource: async (resourceType: string) => {
        const filters = resourceFileDialogFilters(resourceType);
        const resourceLabel = filters?.[0]?.name || t("ui.ResourcePreview.text.c5ca3950");
        const path = await openDialog({
          title: t("ui.tauriApi.text.992acac3", { value0: resourceLabel }),
          multiple: false,
          directory: false,
          ...(filters ? { filters } : {}),
        });
        return path ? { path, filePath: path, name: basename(path) } : null;
      },
      saveJson: async (defaultName: string, data: unknown) => {
        const path = await saveDialog({ defaultPath: defaultName, filters: [{ name: 'JSON', extensions: ['sqlite'] }] });
        if (!path) return null;
        await writeBytes(path, new TextEncoder().encode(JSON.stringify(data, null, 2)));
        return { path };
      },
      saveBinary: async (defaultName: string, bytes: Uint8Array) => {
        const path = await saveDialog({
          defaultPath: defaultName,
          filters: [{ name: 'ZIP', extensions: ['zip'] }],
        });
        if (!path) return null;
        await writeBytes(path, bytes);
        return { path, fileName: String(path).split(/[\\/]/).pop() || defaultName };
      },
      readArrayBuffer: async (path: string) => base64ToBuffer(await command('file:read-array-buffer', path)),
      readImagePreview,
      applyColoredPencil: async (source: string, preferredName = 'colored-pencil.png') => command(
        'file:apply-colored-pencil',
        source,
        await uniqueProjectAssetPath(preferredName),
      ),
      cropImageToProject: async (source: string, preferredName = 'cropped-image.png', crop?: unknown) => command(
        'file:crop-image',
        source,
        await uniqueProjectAssetPath(preferredName),
        crop,
      ),
      hasAudio: (source: string) => command('file:has-audio', source),
      separateAudioToProject: async (source: string, audioName = 'extracted-audio.m4a', videoName = 'silent-video.mp4') => command(
        'file:separate-audio',
        source,
        await uniqueProjectAssetPath(audioName),
        await uniqueProjectAssetPath(videoName),
      ),
      captureVideoFrameToProject: async (source: string, seconds: unknown, preferredName = 'video-frame.png') => command(
        'file:capture-video-frame', source, await uniqueProjectAssetPath(preferredName), seconds,
      ),
      checksum: (path: string) => command('file:checksum', path),
      getGlobalAssetRoot: () => command('file:global-asset-root'),
      trash: (path: string) => command('file:trash', path),
      pathExists: (path: string) => command('file:path-exists', path),
      resolveUniqueFilePath: (directory: string, name: string) => command('file:resolve-unique-path', directory, name),
      writeFileToPath: (path: string, buffer: ArrayBuffer | Uint8Array) => writeBytes(path, buffer),
      writeFileChunk: (path: string, buffer: ArrayBuffer | Uint8Array, append = true) => writeBytes(path, buffer, append),
      copyToProject: async (source: string, preferredName: string) => command('file:copy', source, await uniqueProjectAssetPath(preferredName || basename(source))),
      copyToDirectory: async (source: string, directory: string, preferredName: string) => {
        const target = await command('file:resolve-unique-path', directory, preferredName || basename(source));
        return command('file:copy', source, target);
      },
      saveDataUrlToProject: async (dataUrl: unknown, preferredName = 'resource.png') => {
        const payload = String(dataUrl).split(',')[1] || '';
        return command('file:write', await uniqueProjectAssetPath(preferredName), payload, false);
      },
      downloadUrlToProject: async (url: string, preferredName: string, downloadAuth: DownloadAuth | null = null) => {
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
      saveArrayBuffer: async (defaultName: string, buffer: ArrayBuffer | Uint8Array) => {
        const path = await saveDialog({ defaultPath: defaultName });
        return path ? writeBytes(path, buffer) : null;
      },
      getDownloadDir: async () => await invoke<string>('download_directory_get'),
      selectDownloadDir: async () => {
        const path = await openDialog({ directory: true, recursive: true });
        if (path) await invoke('download_directory_set', { directory: path });
        return path || await invoke<string>('download_directory_get');
      },
      clearDownloadDir: async () => { await invoke('download_directory_set', { directory: '' }); return ''; },
      openFolderPath: (path: string) => command('file:open-path', path),
      openProjectAssets: () => command('file:open-path', projectAssetRoot()),
      showItemInFolder: (path: string) => command('file:show-item-in-folder', path),
      openPath: (path: string) => command('file:open-path', path),
      newMediaTaskId: () => generationRequestId(),
      cancelMediaTask: (requestId: string) => command('media:task-cancel', requestId),
      exportVideoProject: async (project: unknown, defaultName = 'video-project.mp4', requestId = '') => {
        const selected = await saveDialog({
          defaultPath: defaultName,
          filters: [{ name: t("ui.tauriApi.text.bc3f7306"), extensions: ['mp4'] }],
        });
        if (!selected) return null;
        const path = String(selected).toLowerCase().endsWith('.mp4') ? selected : `${selected}.mp4`;
        return command('file:export-video-project', path, await materializeVideoProjectAssets(project), requestId);
      },
      renderVideoProjectToCanvas: async (project: unknown, preferredName = 'clip.mp4', requestId = '') => {
        const target = await uniqueProjectAssetPath(preferredName);
        return command('file:export-video-project', target, await materializeVideoProjectAssets(project), requestId);
      },
      trimVideo: unsupported(t("ui.tauriApi.text.e6104933")),
      concatVideos: async (sources: unknown, options: unknown = {}) => {
        if (!Array.isArray(sources) || sources.length < 2) {
          throw new Error(t("ui.tauriApi.text.f6df00df"));
        }
        return command(
          'file:concat-videos',
          sources.map((item: unknown) => String(item)),
          await uniqueProjectAssetPath(String(asRecord(options).name || 'merged.mp4')),
        );
      },
      probeMedia: (
        source: string | null | undefined,
      ): Promise<{ duration: number | null; width: number | null; height: number | null }> => source
        ? commandJson('file:probe-media', source)
        : Promise.resolve({ duration: null, width: null, height: null }),
      exportResourcePackage: async (payload: ResourcePackagePayload = {}) => {
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
        const byId = new Map((payload.materials || []).map((item): [string | undefined, NativeFileRecord] => [item.id, item]));
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
        const target = projectAssetRoot();
        if (!target) throw new Error(t("ui.tauriApi.text.c090e133"));
        return command('file:import-resource-package', source, target);
      },
      exportFilesPackage: async (paths: string[] = [], name = 'selected-assets') => {
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
      exportFile: async (source: string, preferredName = '') => {
        const fileName = basename(preferredName || source) || 'resource.bin';
        const downloadDir = await invoke<string>('download_directory_get');
        const target = downloadDir
          ? await command('file:resolve-unique-path', downloadDir, fileName)
          : await saveDialog({ defaultPath: fileName });
        if (!target) return null;
        const result = asRecord(await command('file:copy', source, target));
        return { ...result, ok: true, count: 1, direct: true };
      },
    },
    localAssets: {
      getCatalog: () => commandJson<GlobalStorageRecord>('storage:get', 'assets', {
        storageVersion: 1, materials: [], assets: [], references: [],
      }),
      setCatalog: (catalog: unknown) => command('storage:set', 'assets', catalog),
    },
    skills: {
      getGlobal: async () => withBuiltInSkills(await commandJson<GlobalStorageRecord>('storage:get', 'skills', { storageVersion: 1, skills: [] })),
      setGlobal: async (storage: GlobalStorageRecord) => withBuiltInSkills(await commandJson<GlobalStorageRecord>('storage:set', 'skills', withoutBuiltInSkills(storage))),
    },
    recipes: {
      getGlobal: async () => withBuiltInRecipes(await commandJson<GlobalStorageRecord>('storage:get', 'recipes', { storageVersion: 1, recipes: [] })),
      setGlobal: async (storage: GlobalStorageRecord) => withBuiltInRecipes(await commandJson<GlobalStorageRecord>('storage:set', 'recipes', withoutBuiltInRecipes(storage))),
    },
    workflowTemplates: {
      // 模板跨项目复用，与 skills/recipes 一样存应用级 JSON；不含媒体文件。
      getGlobal: () => commandJson<GlobalStorageRecord>('storage:get', 'workflow-templates', { storageVersion: 1, templates: [] }),
      setGlobal: (storage: GlobalStorageRecord) => commandJson<GlobalStorageRecord>('storage:set', 'workflow-templates', storage),
    },
    settings: {
      // Tauri settings must be sourced exclusively from the native store. Merging the
      // browser fallback here used to leak values such as `browser/projects` into the
      // desktop app and made real projects resolve relative to the dev working dir.
      get: () => commandJson<SettingsRecord>('settings:get'),
      set: (settings: SettingsRecord) => command('settings:set', settings),
      refreshBalance: async () => {
        const settings = await commandJson<SettingsRecord>('settings:get');
        const configs: Record<string, { apiKey?: string }> = settings.providerConfigs || {};
        const hasKey = Object.values(configs).some((c) => c?.apiKey?.trim());
        return command('settings:set', { ...settings, apiKeyValid: hasKey, accountSyncError: '' });
      },
      setTokenGroup: (id: string) => command('settings:set-token-group', id),
    },
    model: {
      chatCompletion: (body: ModelRequestBody) => modelRequest(body.__endpointPath || '/chat/completions', body, { method: body.__endpointMethod || 'POST', scope: body.__endpointScope || 'v1', signal: body.__signal, timeoutMs: body.__timeoutMs, headers: body.__headers, auth: asAuth(body.__auth), responseEncoding: body.__responseEncoding || 'json' }),
      chatCompletionStream: (body: ModelRequestBody, onTextDelta?: StreamTextDelta) => modelStreamRequest(body.__endpointPath || '/chat/completions', body, onTextDelta, { method: body.__endpointMethod || 'POST', scope: body.__endpointScope || 'v1', signal: body.__signal, timeoutMs: body.__timeoutMs, headers: body.__headers, auth: asAuth(body.__auth) }),
      imageGeneration: (body: ModelRequestBody) => modelRequest(body.__endpointPath || '/images/generations', body, { method: body.__endpointMethod || 'POST', scope: body.__endpointScope || 'v1', multipart: Boolean(body.__multipart), signal: body.__signal, timeoutMs: body.__timeoutMs, headers: body.__headers, auth: asAuth(body.__auth), responseEncoding: body.__responseEncoding || 'json' }),
      videoGeneration: (body: ModelRequestBody) => modelRequest(body.__endpointPath || '/contents/generations/tasks', body, { method: body.__endpointMethod || 'POST', scope: body.__endpointScope || 'root', signal: body.__signal, timeoutMs: body.__timeoutMs, headers: body.__headers, auth: asAuth(body.__auth), responseEncoding: body.__responseEncoding || 'json' }),
      videoTask: (request: VideoTaskRequest | string) => {
        const value: VideoTaskRequest = typeof request === 'object' ? request : { taskId: request };
        return modelRequest(String(value.endpointPath || '/contents/generations/tasks/{taskId}').replace('{taskId}', encodeURIComponent(String(value.taskId))), value.body, { method: value.endpointMethod || 'GET', scope: value.endpointScope || 'root', signal: value.signal, timeoutMs: value.timeoutMs || 60000, providerId: value.providerId || '', headers: value.headers, auth: asAuth(value.auth) });
      },
    },
    diagnostics: {
      build: (files: Record<string, string>) => command('diagnostics:build', files) as Promise<string>,
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
          return { hasUpdate: false, downloaded: false, info: null, error: errorMessage(error) };
        }
      },
      download: async (onProgress?: (progress: UpdateDownloadProgress) => void) => {
        if (!pendingUpdate) return { ok: false, error: t("ui.tauriApi.text.6338983e") };
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
            return { ok: false, cancelled: true, error: t("ui.tauriApi.text.ffe58dd8") };
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
            return { ok: false, cancelled: true, error: t("ui.tauriApi.text.ffe58dd8") };
          }
          return { ok: false, error: errorMessage(error) };
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
          const parts = (value: string) => String(value).split(/[.-]/).map((part) => Number(part) || 0);
          const left = parts(candidate.version);
          const right = parts(downloadedVersion);
          // noUncheckedIndexedAccess：越界下标是 undefined。原逻辑 `undefined > n` 恒为 false，
          // 所以“两侧都存在”是原表达式的隐含前提，这里显式写出来，语义完全一致
          // （不能改成 ?? 0：那会把“新版本段数更多”误判成更新）。
          const newer = Array.from({ length: Math.max(left.length, right.length) })
            .some((_, index) => {
              const leftPart = left[index];
              const rightPart = right[index];
              return leftPart !== rightPart
                && leftPart !== undefined && rightPart !== undefined
                && leftPart > rightPart
                && left.slice(0, index).every((value, prefix) => value === right[prefix]);
            });
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
          return { superseded: false, warning: errorMessage(error) };
        }
      },
      executeRestart: async () => {
        if (!pendingUpdate || !pendingUpdateDownloaded) {
          return { ok: false, error: t("ui.tauriApi.text.3813a9ee") };
        }
        try {
          await pendingUpdate.install();
          await relaunch();
          return { ok: true };
        } catch (error) {
          return { ok: false, error: errorMessage(error) };
        }
      },
    },
    notifyTask: async () => ({ shown: false, reason: 'tauri-notification-plugin-not-installed' }),
  };
}
