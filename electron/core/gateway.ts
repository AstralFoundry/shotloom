import { isIP } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, sep } from 'node:path';
import { withDatabase } from './db';
import { errorMessage, localizedError } from './errors';
import { fileResult, type FileResult } from './files';
import { homeRoot, resolveInputFile } from './media';
import { loadSettings } from './storage';

/**
 * 厂商模型网关：对应 src-tauri/src/commands/generation_gateway.rs。
 *
 * 渲染进程只提交「端点元信息 + 请求体」，凭据与 baseUrl 始终在这里从设置库读取并注入；
 * 出网请求统一经过公网/厂商域判定，multipart 的本地文件读取复用 media_paths.rs 的边界。
 * 本文件不依赖 Electron，事件发送由命令层负责。
 */

export type HeaderPair = [string, string];

export interface GenerationAuth {
  type?: string;
  name?: string;
  prefix?: string;
}

export interface GenerationResource {
  fieldName: string;
  filePath?: string;
  url?: string;
  fileName?: string;
  mimeType?: string;
}

export interface GenerationRequestInput {
  requestId: string;
  providerId: string;
  path: string;
  scope: string;
  method: string;
  headers: HeaderPair[];
  auth?: GenerationAuth;
  body?: unknown;
  formFields: HeaderPair[];
  resources: GenerationResource[];
  responseEncoding?: string;
  timeoutMs: number;
}

export interface GenerationDownloadInput {
  requestId: string;
  providerId: string;
  url?: string;
  path?: string;
  scope?: string;
  method?: string;
  target: string;
  headers: HeaderPair[];
  auth?: GenerationAuth;
  timeoutMs: number;
}

export interface GenerationResponse {
  status: number;
  body: string;
  bodyBase64: string | null;
  contentType: string;
}

export interface GenerationStreamEventPayload {
  requestId: string;
  chunkBase64: string | null;
  error: string | null;
  done: boolean;
}

/** 命令进程与数据根目录由命令层传入，网关只按这两个位置取设置与判定输入文件边界。 */
export interface GatewayEnvironment {
  appData: string;
  settingsFile: string;
}

// ── 入参解析 ────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function headerPairs(value: unknown): HeaderPair[] {
  if (!Array.isArray(value)) return [];
  const pairs: HeaderPair[] = [];
  for (const entry of value) {
    if (Array.isArray(entry) && entry.length >= 2) pairs.push([text(entry[0]), text(entry[1])]);
  }
  return pairs;
}

function parseAuth(value: unknown): GenerationAuth | undefined {
  if (!isRecord(value)) return undefined;
  const auth: GenerationAuth = {};
  const kind = optionalText(value.type);
  const name = optionalText(value.name);
  const prefix = optionalText(value.prefix);
  if (kind !== undefined) auth.type = kind;
  if (name !== undefined) auth.name = name;
  if (prefix !== undefined) auth.prefix = prefix;
  return auth;
}

function parseResource(value: unknown): GenerationResource {
  const record = isRecord(value) ? value : {};
  const resource: GenerationResource = { fieldName: text(record.fieldName) };
  const filePath = optionalText(record.filePath);
  const url = optionalText(record.url);
  const fileName = optionalText(record.fileName);
  const mimeType = optionalText(record.mimeType);
  if (filePath !== undefined) resource.filePath = filePath;
  if (url !== undefined) resource.url = url;
  if (fileName !== undefined) resource.fileName = fileName;
  if (mimeType !== undefined) resource.mimeType = mimeType;
  return resource;
}

/** serde 的 `Option<Value>` 把 JSON null 当成 None，这里保持同样的“没有 body”。 */
function optionalBody(value: unknown): unknown {
  return value === null ? undefined : value;
}

export function parseGenerationRequest(raw: unknown): GenerationRequestInput {
  const record = isRecord(raw) ? raw : {};
  const resources = Array.isArray(record.resources) ? record.resources.map(parseResource) : [];
  return {
    requestId: text(record.requestId),
    providerId: text(record.providerId),
    path: text(record.path),
    scope: text(record.scope),
    method: text(record.method),
    headers: headerPairs(record.headers),
    auth: parseAuth(record.auth),
    body: optionalBody(record.body),
    formFields: headerPairs(record.formFields),
    resources,
    responseEncoding: optionalText(record.responseEncoding),
    timeoutMs: Number(record.timeoutMs) || 0,
  };
}

export function parseGenerationDownload(raw: unknown): GenerationDownloadInput {
  const record = isRecord(raw) ? raw : {};
  return {
    requestId: text(record.requestId),
    providerId: text(record.providerId),
    url: optionalText(record.url),
    path: optionalText(record.path),
    scope: optionalText(record.scope),
    method: optionalText(record.method),
    target: text(record.target),
    headers: headerPairs(record.headers),
    auth: parseAuth(record.auth),
    timeoutMs: Number(record.timeoutMs) || 0,
  };
}

// ── 取消状态 ────────────────────────────────────────────────────────────────

export class GatewayCancelledError extends Error {
  constructor() {
    super('generation request cancelled');
    this.name = 'GatewayCancelledError';
  }
}

class GatewayTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatewayTimeoutError';
  }
}

interface CancelState {
  readonly requestId: string;
  readonly controller: AbortController;
  cancelled: boolean;
}

const pendingRequests = new Map<string, CancelState>();

/** 同一 requestId 的新请求会取消旧请求，和 Rust 的 oneshot 替换语义一致。 */
function beginRequest(requestId: string): CancelState {
  const state: CancelState = { requestId, controller: new AbortController(), cancelled: false };
  const previous = pendingRequests.get(requestId);
  pendingRequests.set(requestId, state);
  if (previous) {
    previous.cancelled = true;
    previous.controller.abort(new GatewayCancelledError());
  }
  return state;
}

function finishRequest(state: CancelState): void {
  // 只清理自己注册的条目，避免旧请求收尾时误删同 id 的新请求。
  if (pendingRequests.get(state.requestId) === state) pendingRequests.delete(state.requestId);
}

export function cancelGenerationRequest(requestId: string): boolean {
  const state = pendingRequests.get(requestId);
  if (!state) return false;
  pendingRequests.delete(requestId);
  state.cancelled = true;
  state.controller.abort(new GatewayCancelledError());
  return true;
}

function throwIfCancelled(state: CancelState): void {
  if (state.cancelled) throw new GatewayCancelledError();
}

function cancelledError(kind: 'request' | 'download'): Error {
  return new Error(kind === 'download'
    ? localizedError('native.error.153550501e', {}, '生成结果下载已取消')
    : localizedError('native.error.f25ccd81d4', {}, '模型请求已取消'));
}

// ── 厂商凭据 / URL ──────────────────────────────────────────────────────────

interface ProviderCredentials { baseUrl: string; apiKey: string }

/** 与 Rust 相同：baseUrl 只认设置里的值，缺失时报本地化错误；apiKey 可为空。 */
async function providerCredentials(providerId: string, settingsFile: string): Promise<ProviderCredentials> {
  if (!providerId) return { baseUrl: '', apiKey: '' };
  const settings = withDatabase(settingsFile, (db) => loadSettings(db, {}));
  const configs = isRecord(settings) ? settings.providerConfigs : undefined;
  const config = isRecord(configs) && isRecord(configs[providerId])
    ? configs[providerId] as Record<string, unknown>
    : {};
  const candidate = typeof config.baseUrl === 'string' ? config.baseUrl.trim() : '';
  if (!candidate) {
    throw new Error(localizedError('native.error.b9a51012cb', { provider: providerId }, `请先在设置中配置 ${providerId} API 地址和 Key`));
  }
  const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
  return { baseUrl: candidate.replace(/\/+$/, ''), apiKey };
}

/** endpoint scope：origin 丢弃 base 路径，root 保留，v1 在需要时补 /v1。 */
export function requestUrl(baseUrl: string, path: string, scope: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error(localizedError('native.error.1d513b8ee5', {}, '模型请求必须使用相对 endpoint path'));
  }
  if (scope !== 'origin' && scope !== 'root' && scope !== 'v1') {
    throw new Error(localizedError('native.error.7e17e60b95', { scope }, `模型请求 endpoint scope 无效：${scope}`));
  }
  try {
    if (scope === 'origin') return new URL(path, baseUrl).toString();
    const suffix = scope === 'root' || baseUrl.toLowerCase().endsWith('/v1') ? path : `/v1${path}`;
    return new URL(`${baseUrl}${suffix}`).toString();
  } catch (error) {
    // Rust 这里直接返回底层 URL 解析错误，不做本地化包装。
    throw new Error(errorMessage(error));
  }
}

function ipv4IsPublic(octets: number[]): boolean {
  const [a, b, c, d] = octets;
  const isPrivate = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  const isLoopback = a === 127;
  const isLinkLocal = a === 169 && b === 254;
  const isUnspecified = a === 0 && b === 0 && c === 0 && d === 0;
  const isBroadcast = a === 255 && b === 255 && c === 255 && d === 255;
  const isDocumentation = (a === 192 && b === 0 && c === 2)
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113);
  const isMulticast = a >= 224 && a <= 239;
  return !(isPrivate || isLoopback || isLinkLocal || isUnspecified || isBroadcast || isDocumentation || isMulticast);
}

function parseIpv6(value: string): number[] | null {
  let host = value.split('%')[0];
  // 末尾内嵌 IPv4（::ffff:1.2.3.4）先折算成两个 16 位分组。
  const lastDot = host.lastIndexOf('.');
  if (lastDot >= 0) {
    const lastColon = host.lastIndexOf(':');
    const octets = host.slice(lastColon + 1).split('.').map(Number);
    if (lastColon < 0 || octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    host = `${host.slice(0, lastColon + 1)}${high}:${low}`;
  }
  const halves = host.split('::');
  if (halves.length > 2) return null;
  const groups = (part: string): number[] | null => {
    if (!part) return [];
    const parsed: number[] = [];
    for (const group of part.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      parsed.push(Number.parseInt(group, 16));
    }
    return parsed;
  };
  const head = groups(halves[0]);
  if (!head) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = groups(halves[1]);
  if (!tail) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...Array.from({ length: missing }, () => 0), ...tail];
}

function ipv6IsPublic(segments: number[]): boolean {
  if (segments.slice(0, 5).every((part) => part === 0) && segments[5] === 0xffff) {
    return ipv4IsPublic([segments[6] >> 8, segments[6] & 0xff, segments[7] >> 8, segments[7] & 0xff]);
  }
  const isLoopback = segments.every((part, index) => (index === 7 ? part === 1 : part === 0));
  const isUnspecified = segments.every((part) => part === 0);
  const isMulticast = (segments[0] & 0xff00) === 0xff00;
  const isUniqueLocal = (segments[0] & 0xfe00) === 0xfc00;
  const isLinkLocal = segments[0] === 0xfe80;
  return !(isLoopback || isUnspecified || isMulticast || isUniqueLocal || isLinkLocal);
}

/** 公网主机判定；回环、内网、链路本地与 metadata 域名都不算厂商之外的可访问地址。 */
function isPublicHost(host: string): boolean {
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return false;
  }
  let bare = host;
  if (bare.startsWith('[')) bare = bare.slice(1);
  if (bare.endsWith(']')) bare = bare.slice(0, -1);
  const version = isIP(bare);
  if (version === 4) return ipv4IsPublic(bare.split('.').map(Number));
  if (version === 6) {
    const segments = parseIpv6(bare);
    return segments ? ipv6IsPublic(segments) : false;
  }
  return true;
}

function hostOfBase(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** 厂商的结果下载常落在同主机或父子域 CDN 上，按“同主机或父子域”而非 origin 比较。 */
function hostBelongsToBase(host: string, baseHost: string): boolean {
  if (!host || !baseHost) return false;
  return host === baseHost || host.endsWith(`.${baseHost}`) || baseHost.endsWith(`.${host}`);
}

/**
 * 出网请求的统一边界：厂商域名之外不得访问内网，凭证也只在厂商域名内注入。
 * 返回 true 表示目标属于厂商域名（可以携带 apiKey）。
 */
export function guardOutboundUrl(url: URL, baseUrl: string): boolean {
  const host = url.hostname.toLowerCase();
  const provider = hostBelongsToBase(host, hostOfBase(baseUrl));
  if (!provider && !isPublicHost(host)) {
    throw new Error(localizedError('native.error.149d3b51a9', { host }, `模型请求目标 ${host} 不是厂商配置的公网地址，已被网关拒绝`));
  }
  return provider;
}

// ── 请求头 / 鉴权 ───────────────────────────────────────────────────────────

const BLOCKED_HEADERS = new Set([
  'authorization', 'proxy-authorization', 'host', 'origin', 'cookie',
  'content-length', 'connection',
]);

/** RFC 7230 token：HeaderName 与 Method 都用它收口。 */
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function isValidHeaderValue(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code !== 0x09 && (code < 0x20 || code > 0x7e)) return false;
  }
  return true;
}

function safeHeaders(values: HeaderPair[]): Headers {
  const headers = new Headers();
  for (const [rawName, value] of values) {
    const name = rawName.toLowerCase();
    if (BLOCKED_HEADERS.has(name)) continue;
    if (!TOKEN.test(rawName)) {
      throw new Error(localizedError('native.error.4c67e1f713', { name: rawName }, `非法模型请求头：${rawName}`));
    }
    if (!isValidHeaderValue(value)) {
      throw new Error(localizedError('native.error.5e967cccf9', { name }, `非法模型请求头内容：${name}`));
    }
    headers.set(name, value);
  }
  return headers;
}

/** 渲染进程不得自带凭证；apiKey 只按厂商适配器声明的 auth 形态注入。 */
function applyAuth(headers: Headers, auth: GenerationAuth | undefined, apiKey: string): void {
  const kind = auth?.type ?? 'bearer';
  if (!apiKey || kind === 'none' || kind === 'body') return;
  const prefix = auth?.prefix ?? (kind === 'header' ? '' : 'Bearer ');
  const value = `${prefix}${apiKey}`;
  if (!isValidHeaderValue(value)) {
    throw new Error(localizedError('native.error.3fa3180be6', {}, '模型 API Key 无法写入请求头'));
  }
  if (kind === 'header') {
    const name = auth?.name;
    if (!name) throw new Error(localizedError('native.error.f5e4b43bf6', {}, '模型鉴权缺少 header 名称'));
    if (!TOKEN.test(name)) throw new Error(localizedError('native.error.ae79cced61', {}, '模型鉴权 header 名称非法'));
    headers.set(name.toLowerCase(), value);
    return;
  }
  headers.set('authorization', value);
}

/** body 鉴权：把 apiKey 写进 JSON 对象字段，不改动渲染进程提交的原始对象。 */
function bodyWithAuth(body: unknown, auth: GenerationAuth | undefined, apiKey: string): unknown {
  if (auth?.type !== 'body' || !apiKey) return body;
  const field = auth.name && auth.name.length > 0 ? auth.name : 'apiKey';
  if (!isRecord(body)) {
    throw new Error(localizedError('native.error.86ee5cfe82', {}, 'Body 鉴权要求 JSON 对象请求体'));
  }
  return { ...body, [field]: apiKey };
}

/**
 * 模型输入文件的读取边界复用 electron/core/media.ts（对应 media_paths.rs），
 * 这里只保留 Data URL 解码，因为网关是唯一接受 data: 输入的地方。
 */
function decodeDataUrlBase64(encoded: string): Buffer {
  // 与 Rust base64 STANDARD 一样只接受规范 base64，不做空白/URL-safe 容错。
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    const message = 'Invalid base64 data';
    throw new Error(localizedError('native.error.67c6e0e72b', { error: message }, `无法解析模型输入 Data URL: ${message}`));
  }
  return Buffer.from(encoded, 'base64');
}

async function resourceBytes(
  appData: string,
  home: string | null,
  baseUrl: string,
  resource: GenerationResource,
  timeoutMs: number,
): Promise<Buffer> {
  const filePath = resource.filePath;
  if (filePath) {
    const resolved = await resolveInputFile(appData, home, filePath);
    try {
      return await readFile(resolved);
    } catch (error) {
      throw new Error(localizedError('native.error.6fd93f3505',
        { path: filePath, error: errorMessage(error) }, `无法读取模型输入文件 ${filePath}: ${errorMessage(error)}`));
    }
  }
  const url = resource.url ?? '';
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',');
    if (comma >= 0) return decodeDataUrlBase64(url.slice(comma + 1));
  }
  if (url.startsWith('https://') || url.startsWith('http://')) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (error) {
      throw new Error(localizedError('native.error.665564b3f1', { error: errorMessage(error) }, `模型输入 URL 无效：${errorMessage(error)}`));
    }
    guardOutboundUrl(parsed, baseUrl);
    let opened: OpenResponse;
    try {
      opened = await openResponse({ method: 'GET', url: parsed.toString(), headers: new Headers(), body: undefined }, timeoutMs);
    } catch (error) {
      throw new Error(localizedError('native.error.ffe3bd1546', { error: errorMessage(error) }, `无法下载模型输入：${errorMessage(error)}`));
    }
    try {
      if (opened.status < 200 || opened.status >= 300) {
        throw new Error(localizedError('native.error.db3a1e507b',
          { status: String(opened.status) }, `无法下载模型输入（HTTP ${opened.status}）`));
      }
      try {
        return await opened.readAll();
      } catch (error) {
        throw new Error(errorMessage(readFailureOf(opened, error)));
      }
    } finally {
      opened.dispose();
    }
  }
  throw new Error(localizedError('native.error.5d56c3b00a', {}, '模型 multipart 输入缺少有效文件或 URL'));
}

// ── HTTP 传输 ───────────────────────────────────────────────────────────────

const CONNECT_TIMEOUT_MS = 15_000;

function clampTimeout(timeoutMs: number): number {
  const whole = Number.isFinite(timeoutMs) ? Math.trunc(timeoutMs) : 0;
  return Math.min(Math.max(whole, 1_000), 1_800_000);
}

interface OutgoingRequest {
  method: string;
  url: string;
  headers: Headers;
  body: RequestInit['body'];
}

interface OpenResponse {
  status: number;
  contentType: string;
  response: Response;
  readAll(): Promise<Buffer>;
  markConsumed(): void;
  failure(): Error | null;
  dispose(): void;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(errorMessage(value));
}

function readFailureOf(opened: OpenResponse, error: unknown): Error {
  return opened.failure() ?? asError(error);
}

/**
 * 单次出网请求：连接超时 15s、总超时按 Rust 的 clamp(1s, 30min) 处理；
 * 取消与超时都通过 AbortController 终止在途 HTTP，响应体由调用方流式读取。
 */
async function openResponse(outgoing: OutgoingRequest, timeoutMs: number, cancel?: CancelState): Promise<OpenResponse> {
  const controller = new AbortController();
  let abortFailure: Error | null = null;
  const abortWith = (reason: Error): void => {
    if (controller.signal.aborted) return;
    abortFailure = reason;
    controller.abort(reason);
  };
  const connectTimer = setTimeout(() => abortWith(new GatewayTimeoutError('连接超时')), CONNECT_TIMEOUT_MS);
  const totalTimer = setTimeout(() => abortWith(new GatewayTimeoutError('请求超时')), clampTimeout(timeoutMs));
  const onCancel = (): void => abortWith(new GatewayCancelledError());
  const cleanup = (): void => {
    clearTimeout(connectTimer);
    clearTimeout(totalTimer);
    cancel?.controller.signal.removeEventListener('abort', onCancel);
  };
  if (cancel) {
    if (cancel.cancelled) {
      cleanup();
      throw new GatewayCancelledError();
    }
    cancel.controller.signal.addEventListener('abort', onCancel, { once: true });
  }
  let response: Response;
  try {
    response = await fetch(outgoing.url, {
      method: outgoing.method,
      headers: outgoing.headers,
      body: outgoing.body,
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch (error) {
    cleanup();
    throw abortFailure ?? asError(error);
  }
  clearTimeout(connectTimer);

  let consumed = false;
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    cleanup();
    if (controller.signal.aborted) return;
    if (!consumed) {
      // 没读完 body（例如响应非 2xx 直接报错）就主动断流，避免连接一直挂着。
      try {
        void response.body?.cancel().catch(() => undefined);
      } catch {
        /* 响应体已结束或已锁定 */
      }
    }
    controller.abort();
  };
  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    response,
    readAll: async () => {
      const buffer = Buffer.from(await response.arrayBuffer());
      consumed = true;
      return buffer;
    },
    markConsumed: () => { consumed = true; },
    failure: () => abortFailure,
    dispose,
  };
}

// ── 请求构建 ────────────────────────────────────────────────────────────────

async function buildMultipart(
  input: GenerationRequestInput,
  environment: GatewayEnvironment,
  baseUrl: string,
): Promise<FormData> {
  const form = new FormData();
  for (const [name, value] of input.formFields) form.append(name, value);
  const home = homeRoot();
  for (const resource of input.resources) {
    const bytes = await resourceBytes(environment.appData, home, baseUrl, resource, input.timeoutMs);
    const fallback = basename(resource.filePath ?? '') || 'input.bin';
    const fileName = resource.fileName ?? fallback;
    const mimeType = resource.mimeType && resource.mimeType.length > 0 ? resource.mimeType : undefined;
    form.append(resource.fieldName, new Blob([bytes], mimeType ? { type: mimeType } : undefined), fileName);
  }
  return form;
}

async function buildRequest(input: GenerationRequestInput, environment: GatewayEnvironment): Promise<OutgoingRequest> {
  const { baseUrl, apiKey } = await providerCredentials(input.providerId, environment.settingsFile);
  const url = requestUrl(baseUrl, input.path, input.scope);
  if (!TOKEN.test(input.method)) {
    throw new Error(localizedError('native.error.c38b49368d', { method: input.method }, `非法模型请求方法：${input.method}`));
  }
  const headers = safeHeaders(input.headers);
  applyAuth(headers, input.auth, apiKey);
  let body: RequestInit['body'];
  if (input.formFields.length > 0 || input.resources.length > 0) {
    // multipart 的 boundary 必须由 FormData 自己声明，调用方传来的 content-type 会让位。
    headers.delete('content-type');
    body = await buildMultipart(input, environment, baseUrl);
  } else if (input.body !== undefined) {
    body = Buffer.from(JSON.stringify(bodyWithAuth(input.body, input.auth, apiKey)), 'utf8');
    headers.set('content-type', 'application/json');
  }
  return { method: input.method, url, headers, body };
}

// ── 命令实现 ────────────────────────────────────────────────────────────────

function networkFailure(key: string, prefix: string, error: unknown): Error {
  const message = errorMessage(error);
  return new Error(localizedError(key, { error: message }, `${prefix}：${message}`));
}

export async function runGenerationRequest(
  input: GenerationRequestInput,
  environment: GatewayEnvironment,
): Promise<GenerationResponse> {
  const cancel = beginRequest(input.requestId);
  try {
    const outgoing = await buildRequest(input, environment);
    throwIfCancelled(cancel);
    let opened: OpenResponse;
    try {
      opened = await openResponse(outgoing, input.timeoutMs, cancel);
    } catch (error) {
      if (cancel.cancelled) throw cancelledError('request');
      throw networkFailure('native.error.5d1854bdb4', '模型网络请求失败', error);
    }
    try {
      const status = opened.status;
      const binary = input.responseEncoding === 'binary' && status >= 200 && status < 300;
      let bytes: Buffer;
      try {
        bytes = await opened.readAll();
      } catch (error) {
        if (cancel.cancelled) throw cancelledError('request');
        throw networkFailure('native.error.78e1f1f568', '模型响应读取失败', readFailureOf(opened, error));
      }
      return {
        status,
        body: binary ? '' : bytes.toString('utf8'),
        bodyBase64: binary ? bytes.toString('base64') : null,
        contentType: opened.contentType,
      };
    } finally {
      opened.dispose();
    }
  } finally {
    finishRequest(cancel);
  }
}

export async function runGenerationStream(
  input: GenerationRequestInput,
  environment: GatewayEnvironment,
  emit: (event: GenerationStreamEventPayload) => void,
): Promise<GenerationResponse> {
  const cancel = beginRequest(input.requestId);
  let failure: string | null = null;
  try {
    const outgoing = await buildRequest(input, environment);
    throwIfCancelled(cancel);
    let opened: OpenResponse;
    try {
      opened = await openResponse(outgoing, input.timeoutMs, cancel);
    } catch (error) {
      if (cancel.cancelled) throw cancelledError('request');
      throw networkFailure('native.error.5d1854bdb4', '模型网络请求失败', error);
    }
    try {
      const status = opened.status;
      const contentType = opened.contentType;
      if (status < 200 || status >= 300) {
        let body: string;
        try {
          body = (await opened.readAll()).toString('utf8');
        } catch (error) {
          if (cancel.cancelled) throw cancelledError('request');
          throw new Error(errorMessage(readFailureOf(opened, error)));
        }
        return { status, body, bodyBase64: null, contentType };
      }
      const chunks: Buffer[] = [];
      const stream = opened.response.body;
      if (stream) {
        const reader = stream.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            // 取消后立即停止回推，不再把残余分片发给渲染进程。
            if (cancel.cancelled) throw new GatewayCancelledError();
            const chunk = Buffer.from(value);
            chunks.push(chunk);
            emit({
              requestId: input.requestId,
              chunkBase64: chunk.toString('base64'),
              error: null,
              done: false,
            });
          }
          opened.markConsumed();
        } catch (error) {
          if (cancel.cancelled) throw cancelledError('request');
          throw networkFailure('native.error.9022ebe72c', '模型流读取失败', readFailureOf(opened, error));
        }
      }
      return { status, body: Buffer.concat(chunks).toString('utf8'), bodyBase64: null, contentType };
    } finally {
      opened.dispose();
    }
  } catch (error) {
    failure = errorMessage(error);
    throw error;
  } finally {
    // 与 Rust 一致：无论成功、失败还是取消都补一个 done 事件。
    emit({ requestId: input.requestId, chunkBase64: null, error: failure, done: true });
    finishRequest(cancel);
  }
}

function parseDownloadUrl(value: string): URL {
  try {
    return new URL(value);
  } catch (error) {
    throw new Error(errorMessage(error));
  }
}

export async function runGenerationDownload(
  input: GenerationDownloadInput,
  environment: GatewayEnvironment,
): Promise<FileResult> {
  const { baseUrl, apiKey } = await providerCredentials(input.providerId, environment.settingsFile);
  let url: URL;
  if (input.url) {
    url = parseDownloadUrl(input.url);
  } else {
    const path = input.path;
    if (!path) {
      throw new Error(localizedError('native.error.715379073d', {}, '生成结果下载缺少 URL 或 endpoint path'));
    }
    url = parseDownloadUrl(requestUrl(baseUrl, path, input.scope ?? 'root'));
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(localizedError('native.error.eedb6e6f1f', {}, '生成结果下载只允许 HTTP(S) URL'));
  }
  // 结果 URL 来自厂商响应，属于外部输入：跨出厂商域名时不得访问内网，也不再携带 Key。
  const fromProvider = guardOutboundUrl(url, baseUrl);
  const scopedKey = fromProvider ? apiKey : '';
  const method = input.method ?? 'GET';
  if (!TOKEN.test(method)) {
    throw new Error(localizedError('native.error.06d9112d74', {}, '生成结果下载 method 非法'));
  }
  const headers = safeHeaders(input.headers);
  applyAuth(headers, input.auth, scopedKey);
  const cancel = beginRequest(input.requestId);
  try {
    let opened: OpenResponse;
    try {
      opened = await openResponse({ method, url: url.toString(), headers, body: undefined }, input.timeoutMs, cancel);
    } catch (error) {
      if (cancel.cancelled) throw cancelledError('download');
      throw networkFailure('native.error.56e76e0148', '生成结果下载失败', error);
    }
    try {
      const status = opened.status;
      if (status < 200 || status >= 300) {
        throw new Error(localizedError('native.error.09e95a731f',
          { status: String(status) }, `生成结果下载失败（HTTP ${status}）`));
      }
      let bytes: Buffer;
      try {
        bytes = await opened.readAll();
      } catch (error) {
        if (cancel.cancelled) throw cancelledError('download');
        throw networkFailure('native.error.26a1a61233', '生成结果读取失败', readFailureOf(opened, error));
      }
      const parent = dirname(input.target);
      if (parent && parent !== '.' && parent !== sep) {
        try {
          await mkdir(parent, { recursive: true });
        } catch (error) {
          throw new Error(errorMessage(error));
        }
      }
      try {
        await writeFile(input.target, bytes);
      } catch (error) {
        throw new Error(errorMessage(error));
      }
      return await fileResult(input.target);
    } finally {
      opened.dispose();
    }
  } finally {
    finishRequest(cancel);
  }
}
