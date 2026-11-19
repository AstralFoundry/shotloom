import { pluginI18nErrors } from '../../shared/pluginI18n';
import { withNpmPluginIcons } from '../../shared/npmPluginIcons';
import { pluginIconPath, pluginIconSource, packagedPluginIcon } from '../../shared/pluginIcon';
import { migrateVendorPlugins, vendorInstallState, vendorMigrationErrors, type VendorMigrationState, type VendorMigrationSettings } from '../../shared/vendorPluginMigration';
import { pluginCapabilityErrors, capabilityParameterErrors } from '../../shared/pluginCapabilities';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { crc32, gunzipSync, inflateRawSync } from 'node:zlib';
import { parse as parseSemver, satisfies as rangeSatisfies, validRange } from 'semver';
import { withDatabase, transaction } from './db';
import { errorMessage } from './errors';
import { loadCatalog, loadSettings, saveCatalog, saveSettings } from './storage';

/**
 * 厂商插件领域实现，旧协议包身份仅用于兼容历史任务。
 *
 * 产品边界：
 * - 检查包永不执行代码；只有显式信任的 code 插件才会在独立 Node 子进程中运行。
 * - 安装只写入应用数据目录下的 provider-plugins/<id>/<version>-<sha256>/，包内路径在解析阶段
 *   已拒绝越界、隐藏文件、node_modules 与链接，绝不允许包内容写到目录之外。
 * - 插件状态与提交回执沿用 app.sqlite 的 catalog_metadata（provider-plugins /
 *   provider-plugin-submissions），与 Rust 是同一份数据，不新增存储。
 * - 本文件不依赖 Electron：事件与窗口由 electron/ipc/commands/plugins.ts 发送。
 */

export type JsonObject = Record<string, unknown>;

export interface PluginEnvironment {
  /** 用户数据目录（与 Tauri 相同的 com.shotloom.app）。 */
  appData: string;
  /** app.sqlite 绝对路径。 */
  databaseFile: string;
  /** 发行包内置的默认插件目录（含 index.json 与 .shotloom-plugin）。 */
  distributionDir: string;
  /** 内置 Node 运行时目录（包含 node / node.exe）。 */
  runtimeRoot: string;
  /** 应用版本，用于 manifest.shotloom 兼容范围校验。 */
  appVersion: string;
}

interface ParsedPackage {
  manifest: JsonObject;
  digest: string;
  files: Array<[string, Buffer]>;
}

interface NpmSpec { name: string; version: string }

interface TarEntry { name: string; declaredSize: number; type: 'file' | 'directory' | 'other'; data: Buffer }

const MAX_PACKAGE = 20 * 1024 * 1024;
const MAX_EXPANDED = 40 * 1024 * 1024;
const MAX_DOCUMENTATION = 512 * 1024;
const MAX_PLUGIN_RESPONSE = 10 * 1024 * 1024;
const MAX_PLUGIN_FILES = 256;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 4;
const MIN_CALL_TIMEOUT_MS = 1_000;
const MAX_CALL_TIMEOUT_MS = 600_000;

const PLUGIN_CATALOG = 'provider-plugins';
const SUBMISSION_CATALOG = 'provider-plugin-submissions';

/**
 * 与 scripts/provider-plugin-host.mjs 完全一致：Rust 用 include_str! 编译进二进制，
 * Electron 侧同样内嵌，避免安装包缺少一份运行时脚本。stdout 只留给 JSON 回执。
 */
const PLUGIN_HOST_SOURCE = `// One trusted provider invocation per process. stdout is reserved for its JSON reply.
import { pathToFileURL } from 'node:url';
for (const name of ['log', 'info', 'warn', 'debug', 'error']) console[name] = () => {};
let body = '';
for await (const chunk of process.stdin) body += chunk;
try {
  const { input, config } = JSON.parse(body);
  const exports = await import(pathToFileURL(process.argv[1]).href);
  const method = process.argv[2];
  const implementation = exports[method] ?? exports.default?.[method];
  if (typeof implementation !== 'function') throw new Error(\`Plugin does not implement \${method}\`);
  const result = await implementation(input, { config: config || {}, signal: new AbortController().signal });
  process.stdout.write(JSON.stringify({ result: result ?? null }));
} catch (error) {
  process.stdout.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
}
`;

// ── 通用 JSON / 状态工具 ─────────────────────────────────────────────────────

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: unknown, key: string): boolean {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function text(value: unknown, key: string): string {
  const candidate = field(value, key);
  return typeof candidate === 'string' ? candidate : '';
}

function listField(value: unknown, key: string): unknown[] | undefined {
  const candidate = field(value, key);
  return Array.isArray(candidate) ? candidate : undefined;
}

function assign(value: unknown, key: string, next: unknown): void {
  if (isRecord(value)) value[key] = next;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function errorText(error: unknown): string {
  return errorMessage(error);
}

function chronoStamp(): string {
  return String(Date.now());
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => jsonEqual(item, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && jsonEqual(left[key], right[key]));
  }
  return false;
}

function decodeUtf8Strict(bytes: Buffer): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function parseJsonBytes(bytes: Buffer): unknown {
  let body: string;
  try {
    body = decodeUtf8Strict(bytes);
  } catch (error) {
    throw new Error(errorText(error));
  }
  try {
    return JSON.parse(body) as unknown;
  } catch (error) {
    throw new Error(errorText(error));
  }
}

function emptyState(): JsonObject {
  return { plugins: [], disabledBuiltins: [], connections: [], registryUrl: '' };
}

/**
 * 串行化状态变更：Rust 用 MUTATIONS: Mutex 保护 read-modify-write；
 * 这里只把同步的目录读写放进锁内，下载/检查发生在锁外，与 Rust 的临界区一致。
 */
class MutationLock {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(work: () => T | Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }
}

const mutations = new MutationLock();

// ── 目录持久化 ──────────────────────────────────────────────────────────────

function readState(env: PluginEnvironment): unknown {
  // 插件目录是 metadata-only catalog：沿用 Rust 的 catalog() 语义（缺失时用空目录）。
  const value = withDatabase(env.databaseFile, (db) => loadCatalog(db, PLUGIN_CATALOG));
  return value === undefined ? emptyState() : value;
}

function writeState(env: PluginEnvironment, state: unknown): void {
  withDatabase(env.databaseFile, (db) => { saveCatalog(db, PLUGIN_CATALOG, state); });
}

function readSubmissions(env: PluginEnvironment): unknown {
  const value = withDatabase(env.databaseFile, (db) => loadCatalog(db, SUBMISSION_CATALOG));
  return value === undefined ? {} : value;
}

function writeSubmissions(env: PluginEnvironment, receipts: unknown): void {
  withDatabase(env.databaseFile, (db) => { saveCatalog(db, SUBMISSION_CATALOG, receipts); });
}

function packageRoot(env: PluginEnvironment): string {
  return join(env.appData, 'provider-plugins');
}

function artifactDir(env: PluginEnvironment, manifest: unknown, digest: string): string {
  const id = text(manifest, 'id');
  const version = text(manifest, 'version');
  if (!idValid(id) || digest.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(digest)) {
    throw new Error('Invalid plugin artifact reference');
  }
  return join(packageRoot(env), id, `${version}-${digest}`);
}

// ── 身份 / 路径 / manifest 校验 ─────────────────────────────────────────────

function idValid(id: string): boolean {
  return id.length > 0
    && Buffer.byteLength(id, 'utf8') <= 96
    && /^[a-z0-9][a-z0-9._-]*$/.test(id);
}

/** 包内相对路径：不能为空、不能含空段/./..、不能有反斜杠或冒号。 */
function safePath(path: string): boolean {
  if (!path || path.includes('\\') || path.includes(':')) return false;
  return path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

const STRICT_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** 与 Rust semver::Version::parse 一样接受严格 semver，不接受 v 前缀或范围。 */
function parseVersionStrict(value: string): string | null {
  if (!STRICT_VERSION.test(value)) return null;
  const parsed = parseSemver(value);
  return parsed ? parsed.version : null;
}

/** Rust semver 只接受逗号分隔的 AND 条件；node semver 用空格表示同一语义。 */
function rangeParts(range: string): string[] {
  return range.split(',').map((part) => part.trim());
}

function rangeValid(range: string): boolean {
  const parts = rangeParts(range);
  if (parts.length === 0 || parts.length > 32) return false;
  for (const part of parts) {
    if (part === '') return false;
    // 逗号分隔是 Rust 的语法；空格分隔的多个 comparator 必须写成逗号形式。
    const versionTokens = part.split(/\s+/).filter(Boolean).filter((token) => !/^[<>=~^*xX]+$/.test(token));
    const wildcardOnly = /^[xX*]$/.test(part);
    if (wildcardOnly ? parts.length > 1 : versionTokens.length !== 1) return false;
  }
  return validRange(parts.join(' ')) !== null;
}

function rangeMatches(range: string, version: string): boolean {
  return rangeSatisfies(version, rangeParts(range).join(' '), { includePrerelease: true });
}

function validateManifest(manifest: unknown, appVersion: string): void {
  if (field(manifest, 'icon') !== undefined && !pluginIconPath(field(manifest, 'icon'))) throw new Error('Plugin icon must be a relative raster asset path');
  if (field(manifest, 'iconData') !== undefined && !pluginIconSource(field(manifest, 'iconData'))) throw new Error('Invalid resolved plugin icon');
  const capabilityErrors = [...pluginI18nErrors(manifest), ...pluginCapabilityErrors(manifest)];
  if (capabilityErrors.length) throw new Error(capabilityErrors.join('\n'));
  for (const key of ['description', 'author', 'homepage', 'license', 'readme']) {
    const value = field(manifest, key);
    // JSON null 在 Rust 里是 Some(Value::Null)，同样必须报类型错误。
    if (value !== undefined && typeof value !== 'string') throw new Error(`${key} must be a string`);
  }
  if (Buffer.byteLength(text(manifest, 'readme'), 'utf8') > MAX_DOCUMENTATION) {
    throw new Error('Plugin README exceeds 512 KiB');
  }
  if (![1, 2].includes(Number(field(manifest, 'apiVersion'))) || !idValid(text(manifest, 'id')) || text(manifest, 'name').trim() === '') {
    throw new Error('Invalid provider plugin identity or apiVersion');
  }
  if (parseVersionStrict(text(manifest, 'version')) === null) {
    throw new Error(`Invalid plugin version: ${text(manifest, 'version')}`);
  }
  if (!rangeValid(text(manifest, 'shotloom'))) {
    throw new Error(`Invalid Shotloom compatibility range: ${text(manifest, 'shotloom')}`);
  }
  if (!rangeMatches(text(manifest, 'shotloom'), appVersion)) {
    throw new Error('Plugin is incompatible with this Shotloom version');
  }
  if (!Array.isArray(field(manifest, 'protocols'))) throw new Error('protocols must be an array');
  const migrationErrors = vendorMigrationErrors(manifest);
  if (migrationErrors.length) throw new Error(migrationErrors.join('\n'));

  const protocol = field(manifest, 'kind') === 'protocol';
  const providers = listField(manifest, 'providers');
  if (!providers) throw new Error('providers must be an array');
  if (protocol) {
    const engine = text(manifest, 'engine');
    const category = text(manifest, 'category');
    const operations = listField(manifest, 'protocols') ?? [];
    if (providers.length > 0 || operations.length === 0
      || !['textGeneration', 'imageGeneration', 'videoGeneration', 'audioGeneration'].includes(category)) {
      throw new Error('Invalid protocol plugin category or operations');
    }
    if (!['', 'declarative', 'module'].includes(engine)) throw new Error('Unsupported protocol engine');
    if (engine === 'module' && !isRecord(field(manifest, 'runtime'))) throw new Error('Module protocol requires runtime');
    const operationIds = new Set<string>();
    for (const operation of operations) {
      const id = text(operation, 'id');
      if (!idValid(id) || operationIds.has(id) || !isRecord(field(operation, 'mode'))) {
        throw new Error('Invalid protocol operation');
      }
      operationIds.add(id);
    }
  } else if (field(manifest, 'kind') === 'vendor') {
    if (providers.length) throw new Error('Vendor models belong in defaultConnections');
    if (!(listField(manifest, 'defaultConnections')?.length)) throw new Error('Vendor plugin requires a default connection');
    if (!['', 'declarative', 'module'].includes(text(manifest, 'engine'))) throw new Error('Unsupported vendor engine');
    if (field(manifest, 'engine') === 'module' && !isRecord(field(manifest, 'runtime'))) throw new Error('Module vendor requires runtime');
    const ids = new Set<string>();
    for (const operation of listField(manifest, 'protocols') || []) {
      if (!idValid(text(operation, 'id')) || ids.has(text(operation, 'id')) || !isRecord(field(operation, 'mode'))) throw new Error('Invalid internal operation');
      ids.add(text(operation, 'id'));
    }
    for (const connection of listField(manifest, 'defaultConnections') || []) {
      if (field(connection, 'pluginId') !== field(manifest, 'id') || field(connection, 'presetId') !== 'vendor') throw new Error('Vendor connection must belong to its package');
      for (const model of listField(connection, 'models') || []) {
        const modes = field(model, 'protocolModes');
        if (!isRecord(modes) || !Object.keys(modes).length || Object.values(modes).some(id => typeof id !== 'string' || !ids.has(id))) throw new Error('Vendor model references unknown internal operation');
      }
    }
  } else if (providers.length === 0) {
    throw new Error('providers must be a non-empty array');
  }

  const providerIds = new Set<string>();
  for (const provider of providers) {
    const id = text(provider, 'id');
    if (!idValid(id) || providerIds.has(id) || text(provider, 'name') === '' || !Array.isArray(field(provider, 'models'))) {
      throw new Error('Invalid or duplicate provider declaration');
    }
    providerIds.add(id);
    const engine = text(provider, 'engine');
    if (!['', 'declarative', 'module'].includes(engine)) throw new Error('Unsupported provider engine');
    if (engine === 'module' && !isRecord(field(manifest, 'runtime'))) throw new Error('Module provider requires runtime');
    const baseUrl = text(provider, 'baseUrl');
    if (baseUrl !== '') {
      let parsed: URL;
      try {
        parsed = new URL(baseUrl);
      } catch (error) {
        throw new Error(errorText(error));
      }
      // URL 里只要 authority 出现 '@' 就带凭据；空密码（https://:@host）也要拒绝。
      const authority = parsed.href.slice(parsed.protocol.length + 2).split(/[/?#]/)[0] ?? '';
      if (!(parsed.protocol === 'https:' || parsed.protocol === 'http:') || parsed.username !== '' || authority.includes('@')) {
        throw new Error('Invalid provider URL');
      }
    }
  }

  const legacyProviders = field(manifest, 'legacyProviders');
  if (legacyProviders !== undefined) {
    if (!Array.isArray(legacyProviders)) throw new Error('legacyProviders must be an array');
    for (const alias of legacyProviders) {
      if (!idValid(text(alias, 'pluginId'))
        || parseVersionStrict(text(alias, 'version')) === null
        || !idValid(text(field(alias, 'provider'), 'id'))) {
        throw new Error('Invalid historical provider identity');
      }
    }
  }

  const defaultConnections = field(manifest, 'defaultConnections');
  if (defaultConnections !== undefined) {
    if (!Array.isArray(defaultConnections)) throw new Error('defaultConnections must be an array');
    for (const connection of defaultConnections) {
      if (!idValid(text(connection, 'id')) || text(connection, 'name') === '') {
        throw new Error('Invalid default connection identity');
      }
      const models = listField(connection, 'models');
      if (!models) throw new Error('Invalid default model list');
      for (const model of models) {
        if (field(manifest, 'kind') === 'vendor' ? hasOwn(model, 'protocolPlugin') && field(model, 'protocolPlugin') !== field(manifest, 'id') : field(model, 'protocolPlugin') !== field(manifest, 'id')) {
          throw new Error('Default models must reference their own package');
        }
      }
    }
  }

  const runtime = field(manifest, 'runtime');
  if (runtime !== undefined) {
    const entry = text(runtime, 'entry');
    if (!safePath(entry) || !entry.startsWith('runtime/') || !entry.endsWith('.mjs')) {
      throw new Error('Runtime entry must be an ES module inside runtime/');
    }
  }
}

function pluginPackageName(name: string): boolean {
  const part = name.slice(name.lastIndexOf('/') + 1);
  const prefix = 'shotloom-plugin-';
  if (!part.startsWith(prefix)) return false;
  const suffix = part.slice(prefix.length);
  return suffix.length > 0 && /^[a-z0-9][a-z0-9._-]*$/.test(suffix);
}

function npmSpec(source: string): NpmSpec {
  if (!source.startsWith('npm:')) throw new Error('Expected npm:package@version');
  const spec = source.slice(4);
  const at = spec.lastIndexOf('@');
  const name = at > 0 ? spec.slice(0, at) : spec;
  const version = at > 0 ? spec.slice(at + 1) : 'latest';
  const partValid = (part: string): boolean => part.length > 0 && /^[a-z0-9][a-z0-9._-]*$/.test(part);
  let nameValid: boolean;
  if (name.startsWith('@')) {
    const scoped = name.slice(1);
    const slash = scoped.indexOf('/');
    nameValid = slash >= 0 && partValid(scoped.slice(0, slash)) && partValid(scoped.slice(slash + 1));
  } else {
    nameValid = partValid(name);
  }
  if (name.length > 214 || !nameValid || version.length === 0 || !/^[A-Za-z0-9._+-]+$/.test(version)) {
    throw new Error('Use an npm package name with an exact version or dist-tag, e.g. npm:@scope/shotloom-plugin-example@1.0.0');
  }
  if (!pluginPackageName(name)) {
    throw new Error('Plugin package names must start with shotloom-plugin-, e.g. @scope/shotloom-plugin-example');
  }
  return { name, version };
}

function npmRegistry(registry: string): string {
  if (registry === '' || registry === 'npm') return 'https://registry.npmjs.org/';
  if (registry === 'npmmirror') return 'https://registry.npmmirror.com/';
  throw new Error('Unsupported npm registry');
}

function npmMetadataUrl(registry: string, name: string, version: string): string {
  const base = npmRegistry(registry);
  const url = new URL(base);
  // Rust 的 path_segments_mut().push(name) 把作用域名字当成单个 segment（/ 编码为 %2F）。
  const encodedName = name.split('/').map((part) => encodeURIComponent(part).replace(/%40/gi, '@')).join('%2F');
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${encodedName}/${encodeURIComponent(version)}`;
  return url.toString();
}

function verifyNpmIntegrity(bytes: Buffer, integrity: string): void {
  for (const item of integrity.split(/\s+/)) {
    if (item.startsWith('sha512-')) {
      const actual = createHash('sha512').update(bytes).digest('base64');
      if (actual !== item.slice('sha512-'.length)) throw new Error('npm package integrity mismatch');
      return;
    }
  }
  throw new Error('npm package requires SHA-512 integrity metadata');
}

// ── 压缩包解析（永不执行包内代码） ──────────────────────────────────────────

const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;

function findZipEnd(bytes: Buffer): number {
  const minimum = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) === ZIP_END_SIGNATURE) return offset;
  }
  return -1;
}

function tarNumber(input: Buffer): number {
  if (input.length === 0) return 0;
  if ((input[0] & 0x80) !== 0) {
    let value = 0;
    for (let index = 1; index < input.length; index += 1) value = value * 256 + input[index]!;
    return value;
  }
  const raw = input.toString('ascii').replace(/\0.*$/s, '').trim();
  return raw === '' ? 0 : Number.parseInt(raw, 8);
}

function tarString(input: Buffer): string {
  const zero = input.indexOf(0);
  return input.toString('utf8', 0, zero < 0 ? input.length : zero);
}

function paxPath(input: Buffer): string | null {
  for (const line of input.toString('utf8').split('\n')) {
    const space = line.indexOf(' ');
    if (space < 0) continue;
    const length = Number(line.slice(0, space));
    if (!Number.isInteger(length)) continue;
    const record = line.slice(space + 1);
    const equals = record.indexOf('=');
    if (equals >= 0 && record.slice(0, equals) === 'path') return record.slice(equals + 1);
  }
  return null;
}

/** tar 解析只覆盖 npm 包会出现的形态；扩展头与 GNU 长文件名按 tar crate 的语义处理。 */
function parseTar(bytes: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  let longName: string | null = null;
  let extendedPath: string | null = null;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const storedChecksum = tarNumber(header.subarray(148, 156));
    let computed = 0;
    for (let index = 0; index < 512; index += 1) {
      computed += index >= 148 && index < 156 ? 0x20 : header[index]!;
    }
    if (storedChecksum !== computed) throw new Error('archive header checksum mismatch');
    const prefix = tarString(header.subarray(345, 500));
    const baseName = tarString(header.subarray(0, 100));
    const name = prefix ? `${prefix}/${baseName}` : baseName;
    const declaredSize = tarNumber(header.subarray(124, 136));
    const typeFlag = header[156] === 0 ? '\0' : String.fromCharCode(header[156]!);
    const dataStart = offset + 512;
    const dataEnd = dataStart + declaredSize;
    if (dataEnd > bytes.length) throw new Error('unexpected end of tar archive');
    const data = bytes.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(declaredSize / 512) * 512;
    if (typeFlag === 'L') { longName = tarString(data); continue; }
    if (typeFlag === 'x' || typeFlag === 'g') {
      if (typeFlag === 'x') extendedPath = paxPath(data);
      continue;
    }
    if (typeFlag === 'K') continue;
    const finalName = extendedPath ?? longName ?? name;
    extendedPath = null;
    longName = null;
    if (typeFlag === '5') {
      entries.push({ name: finalName, declaredSize, type: 'directory', data });
      continue;
    }
    if (typeFlag === '0' || typeFlag === '\0' || typeFlag === '7') {
      entries.push({ name: finalName, declaredSize, type: 'file', data });
      continue;
    }
    entries.push({ name: finalName, declaredSize, type: 'other', data });
  }
  return entries;
}

function npmArchiveFiles(bytes: Buffer): Array<[string, Buffer]> {
  let expanded: Buffer;
  try {
    // Rust 用 take(MAX_EXPANDED + 1 MiB) 包住 GzDecoder；这里用同样的展开上限。
    expanded = gunzipSync(bytes, { maxOutputLength: MAX_EXPANDED + 1024 * 1024 });
  } catch {
    throw new Error('npm plugin exceeds expanded package limits');
  }
  const files: Array<[string, Buffer]> = [];
  const paths = new Set<string>();
  let total = 0;
  for (const entry of parseTar(expanded)) {
    if (entry.type === 'directory') continue;
    if (entry.type !== 'file') throw new Error('Only regular files are allowed in npm plugins');
    if (!entry.name.startsWith('package/')) throw new Error('npm archive must use the package/ root');
    const name = entry.name.slice('package/'.length);
    if (!safePath(name) || paths.has(name)
      || name.split('/').some((part) => part.startsWith('.') || part === 'node_modules')) {
      throw new Error('Unsafe or duplicate path in npm package; bundle dependencies');
    }
    if (files.length >= MAX_PLUGIN_FILES || total + entry.declaredSize > MAX_EXPANDED) {
      throw new Error('npm plugin exceeds expanded package limits');
    }
    paths.add(name);
    total += entry.data.length;
    if (total > MAX_EXPANDED) throw new Error('Expanded plugin exceeds 40 MiB');
    files.push([name, entry.data]);
  }
  return files;
}

function zipArchiveFiles(bytes: Buffer): Array<[string, Buffer]> {
  const end = findZipEnd(bytes);
  if (end < 0) throw new Error('invalid Zip archive: could not find central directory end');
  const count = bytes.readUInt16LE(end + 10);
  const centralSize = bytes.readUInt32LE(end + 12);
  const centralOffset = bytes.readUInt32LE(end + 16);
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error('ZIP64 plugin packages are not supported');
  }
  if (count > MAX_PLUGIN_FILES) throw new Error('Too many files in plugin package');
  const files: Array<[string, Buffer]> = [];
  const paths = new Set<string>();
  let total = 0;
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== ZIP_CENTRAL_SIGNATURE) {
      throw new Error('invalid Zip archive: invalid central directory');
    }
    const madeBy = bytes.readUInt16LE(cursor + 4) >> 8;
    const method = bytes.readUInt16LE(cursor + 10);
    const expectedCrc = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const externalAttributes = bytes.readUInt32LE(cursor + 38);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('ZIP64 plugin packages are not supported');
    }
    const name = bytes.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    const unixMode = madeBy === 3 ? externalAttributes >>> 16 : 0;
    if (!safePath(name) || paths.has(name) || (unixMode & 0o170000) === 0o120000) {
      throw new Error('Unsafe or duplicate path in plugin archive');
    }
    paths.add(name);
    if (name.split('/').some((part) => part.startsWith('.') || part === 'node_modules')) {
      throw new Error('Hidden files and node_modules are not supported; bundle dependencies');
    }
    if (total + uncompressedSize > MAX_EXPANDED) throw new Error('Expanded plugin exceeds 40 MiB');
    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== ZIP_LOCAL_SIGNATURE) {
      throw new Error('invalid Zip archive: invalid local header');
    }
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + compressedSize > bytes.length) throw new Error('invalid Zip archive: truncated entry');
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    let data: Buffer;
    if (method === 0) {
      data = Buffer.from(compressed);
    } else if (method === 8) {
      try {
        data = inflateRawSync(compressed, { maxOutputLength: MAX_EXPANDED - total + 1 });
      } catch {
        throw new Error('Expanded plugin exceeds 40 MiB');
      }
    } else {
      throw new Error('unsupported Zip compression method');
    }
    total += data.length;
    if (total > MAX_EXPANDED) throw new Error('Expanded plugin exceeds 40 MiB');
    if ((crc32(data) >>> 0) !== expectedCrc) throw new Error('invalid checksum in plugin archive');
    files.push([name, data]);
  }
  return files;
}

function archiveFiles(bytes: Buffer): Array<[string, Buffer]> {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return npmArchiveFiles(bytes);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return zipArchiveFiles(bytes);
  // 单文件 JSON 包：检查永远不执行代码，只是读取 manifest。
  return [['manifest.json', Buffer.from(bytes)]];
}

function parsePackage(bytes: Buffer, appVersion: string): ParsedPackage {
  if (bytes.length > MAX_PACKAGE) throw new Error('Plugin package exceeds 20 MiB');
  const digest = createHash('sha256').update(bytes).digest('hex');
  const gzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const files = archiveFiles(bytes);

  let metadata: unknown;
  const packageJson = files.find(([name]) => name === 'package.json');
  if (gzip) {
    if (!packageJson) throw new Error('npm plugin requires package.json');
    metadata = parseJsonBytes(packageJson[1]);
    if (field(metadata, 'shotloomPlugin') !== 'manifest.json') {
      throw new Error('npm package must declare shotloomPlugin: manifest.json');
    }
  }

  const manifestFile = files.find(([name]) => name === 'manifest.json');
  if (!manifestFile) throw new Error('Missing manifest.json at archive root');
  const parsedManifest = parseJsonBytes(manifestFile[1]);
  validateManifest(parsedManifest, appVersion);
  if (!isRecord(parsedManifest)) throw new Error('Invalid provider plugin identity or apiVersion');
  const manifest = parsedManifest;

  if (packageJson) {
    if (metadata === undefined) metadata = parseJsonBytes(packageJson[1]);
    if (!pluginPackageName(text(metadata, 'name'))) {
      throw new Error('Plugin package names must start with shotloom-plugin-');
    }
  }

  if (field(manifest, 'icon') !== undefined) {
    const icon = text(manifest, 'icon');
    manifest.iconData = packagedPluginIcon(icon, files.find(([name]) => name === icon)?.[1]);
  }
  const readme = files.find(([name]) => name.toLowerCase() === 'readme.md');
  if (readme) {
    if (readme[1].length > MAX_DOCUMENTATION) throw new Error('Plugin README exceeds 512 KiB');
    let content: string;
    try {
      content = decodeUtf8Strict(readme[1]);
    } catch {
      throw new Error('README must be UTF-8');
    }
    manifest.readme = content;
  }

  if (gzip) {
    if (!metadata) throw new Error('npm plugin requires package.json');
    if (field(metadata, 'version') !== field(manifest, 'version')) {
      throw new Error('npm package and plugin versions must match');
    }
    for (const key of ['homepage', 'license', 'description']) {
      if (!hasOwn(manifest, key) && typeof field(metadata, key) === 'string') manifest[key] = field(metadata, key);
    }
    if (!hasOwn(manifest, 'author')) {
      const source = field(metadata, 'author');
      const author = isRecord(source) ? field(source, 'name') : source;
      if (typeof author === 'string') manifest.author = author;
    }
  }

  const runtime = field(manifest, 'runtime');
  if (runtime !== undefined) {
    if (!files.some(([name]) => name === text(runtime, 'entry'))) {
      throw new Error('Runtime entry is missing from package');
    }
  } else if (files.some(([name]) => name.startsWith('runtime/'))) {
    throw new Error('Runtime files require a declared runtime entry');
  }

  return { manifest, digest, files };
}

// ── 下载（网络边界） ────────────────────────────────────────────────────────

function downloadUrlAllowed(url: URL): boolean {
  if (url.username !== '' || url.password !== '') return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol !== 'http:') return false;
  const host = url.hostname.toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}

function httpStatusError(response: Response, url: URL): string {
  const kind = response.status >= 500 ? 'server error' : 'client error';
  const reason = response.statusText ? ` ${response.statusText}` : '';
  return `HTTP status ${kind} (${response.status}${reason}) for url (${url.toString()})`;
}

/**
 * 与 Rust fetch_bytes 相同的边界：HTTPS（或本机 HTTP 开发）、拒绝带凭据 URL、
 * 最多 4 次重定向且每一跳都重新校验、60s 总超时、流式累计大小上限。
 */
async function fetchBytes(url: string, limit: number, timeoutMs = DOWNLOAD_TIMEOUT_MS): Promise<Buffer> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new Error(errorText(error));
  }
  if (!downloadUrlAllowed(parsed)) {
    throw new Error('Plugin downloads require HTTPS (or local HTTP for development)');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Plugin download timed out')), timeoutMs);
  try {
    let current = parsed;
    for (let redirects = 0; ; redirects += 1) {
      const response = await fetch(current, { redirect: 'manual', signal: controller.signal });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        // 没有 Location 的 3xx 在 reqwest 里是正常响应（error_for_status 不拒绝 3xx）。
        if (location) {
          try { await response.body?.cancel(); } catch { /* 已结束 */ }
          if (redirects >= MAX_REDIRECTS) throw new Error('Unsafe plugin download redirect');
          let next: URL;
          try {
            next = new URL(location, current);
          } catch (error) {
            throw new Error(errorText(error));
          }
          if (!downloadUrlAllowed(next)) throw new Error('Unsafe plugin download redirect');
          current = next;
          continue;
        }
      } else if (response.status >= 400) {
        try { await response.body?.cancel(); } catch { /* 已结束 */ }
        throw new Error(httpStatusError(response, current));
      }
      if (!response.body) return Buffer.alloc(0);
      const reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let total = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          total += chunk.length;
          if (total > limit) {
            try { await reader.cancel(); } catch { /* 已结束 */ }
            throw new Error('Download exceeds size limit');
          }
          chunks.push(chunk);
        }
      } finally {
        reader.releaseLock();
      }
      return Buffer.concat(chunks);
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error(errorText(controller.signal.reason));
    throw error instanceof Error ? error : new Error(errorText(error));
  } finally {
    clearTimeout(timer);
  }
}

async function sourceBytes(source: string): Promise<Buffer> {
  if (source.startsWith('https://') || source.startsWith('http://')) {
    return fetchBytes(source, MAX_PACKAGE);
  }
  let metadata;
  try {
    metadata = statSync(source);
  } catch (error) {
    throw new Error(errorText(error));
  }
  if (metadata.isDirectory()) {
    throw new Error('Choose a .shotloom-plugin ZIP or manifest JSON; package local runtime files with the plugin CLI');
  }
  if (metadata.size > MAX_PACKAGE) throw new Error('Plugin package exceeds 20 MiB');
  try {
    return readFileSync(source);
  } catch (error) {
    throw new Error(errorText(error));
  }
}

async function packageFromNpmMetadata(metadata: unknown, name: string, appVersion: string): Promise<{ pkg: ParsedPackage; resolvedSource: string }> {
  const resolved = text(metadata, 'version');
  const bytes = await fetchBytes(text(field(metadata, 'dist'), 'tarball'), MAX_PACKAGE);
  verifyNpmIntegrity(bytes, text(field(metadata, 'dist'), 'integrity'));
  if (!(bytes[0] === 0x1f && bytes[1] === 0x8b)) throw new Error('npm plugin must be a gzip tarball');
  const pkg = parsePackage(bytes, appVersion);
  const packageJson = pkg.files.find(([path]) => path === 'package.json');
  if (!packageJson) throw new Error('Missing package.json');
  const packaged = parseJsonBytes(packageJson[1]);
  if (text(packaged, 'name') !== name || text(pkg.manifest, 'version') !== resolved) {
    throw new Error('npm registry and plugin package identities must match');
  }
  return { pkg, resolvedSource: `npm:${name}@${resolved}` };
}

async function sourcePackage(env: PluginEnvironment, source: string, registry: string): Promise<{ pkg: ParsedPackage; resolvedSource: string }> {
  if (source.startsWith('npm:')) {
    const spec = npmSpec(source);
    const metadata = parseJsonBytes(await fetchBytes(npmMetadataUrl(registry, spec.name, spec.version), 2 * 1024 * 1024));
    const resolved = text(metadata, 'version');
    if (text(metadata, 'name') !== spec.name || parseVersionStrict(resolved) === null) {
      throw new Error('npm registry returned a different package identity');
    }
    if (parseVersionStrict(spec.version) !== null && spec.version !== resolved) {
      throw new Error('npm registry returned a different version');
    }
    return packageFromNpmMetadata(metadata, spec.name, env.appVersion);
  }
  return { pkg: parsePackage(await sourceBytes(source), env.appVersion), resolvedSource: source };
}

// ── 安装 / 目录操作 ─────────────────────────────────────────────────────────

function provisionConnections(state: unknown, defaults: unknown[]): void {
  const connections = listField(state, 'connections');
  if (!connections) throw new Error('Invalid connection registry');
  for (const seed of defaults) {
    const existing = connections.find((connection) => field(connection, 'id') === field(seed, 'id'));
    if (existing) {
      // 已有连接地址与用户改过的模型能力优先，只补齐缺失的模型。
      const models = listField(existing, 'models');
      if (!models) continue;
      const seeds = listField(seed, 'models');
      if (!seeds) throw new Error('Invalid default model list');
      for (const model of seeds) {
        if (!models.some((item) => field(item, 'id') === field(model, 'id'))) models.push(clone(model));
      }
    } else {
      connections.push(clone(seed));
    }
  }
  const sortOrder = (connection: unknown): number => {
    const value = field(connection, 'sortOrder');
    return typeof value === 'number' && Number.isInteger(value) ? value : 99;
  };
  connections.sort((left, right) => sortOrder(left) - sortOrder(right));
}

function installInState(
  state: unknown,
  root: string,
  pkg: ParsedPackage,
  source: string,
  expected: string,
  trusted: boolean,
): void {
  if (pkg.digest !== expected) throw new Error('Package changed since inspection; inspect it again');
  const manifest = pkg.manifest;
  if (hasOwn(manifest, 'runtime') && !trusted) {
    throw new Error('Code plugins require explicit trust confirmation');
  }
  const plugins = listField(state, 'plugins');
  if (!plugins) throw new Error('Invalid plugin registry');
  const identities = [text(manifest, 'id')];
  for (const alias of listField(manifest, 'legacyProviders') ?? []) identities.push(text(alias, 'pluginId'));

  for (const plugin of plugins) {
    const records = [field(plugin, 'manifest'), ...(listField(plugin, 'history') ?? []).map((item) => field(item, 'manifest'))];
    for (const other of records) {
      if (!isRecord(other)) continue;
      if (field(other, 'id') === field(manifest, 'id')) continue;
      const otherAliases = listField(other, 'legacyProviders');
      if (identities.includes(text(other, 'id'))
        || (otherAliases?.some((alias) => identities.includes(text(alias, 'pluginId'))) ?? false)) {
        throw new Error('Plugin identity already belongs to another package');
      }
      const otherProviders = listField(other, 'providers') ?? [];
      for (const provider of listField(manifest, 'providers') ?? []) {
        if (otherProviders.some((candidate) => field(candidate, 'id') === field(provider, 'id'))) {
          throw new Error(`Provider id already belongs to another plugin: ${JSON.stringify(field(provider, 'id') ?? null)}`);
        }
      }
    }
  }

  const previous = plugins.findIndex((plugin) => field(field(plugin, 'manifest'), 'id') === field(manifest, 'id'));
  const history = previous >= 0 ? clone(listField(plugins[previous], 'history') ?? []) : [];
  if (previous >= 0) {
    const current = plugins[previous];
    for (const old of [current, ...history]) {
      if (field(field(old, 'manifest'), 'version') === field(manifest, 'version') && field(old, 'digest') !== pkg.digest) {
        throw new Error('A version is immutable; increase version before changing its contents');
      }
    }
    const retained = history.filter((old) => field(field(old, 'manifest'), 'version') !== field(manifest, 'version'));
    if (field(current, 'digest') !== pkg.digest) {
      retained.push({
        manifest: clone(field(current, 'manifest')),
        digest: field(current, 'digest'),
        trustedCode: field(current, 'trustedCode'),
        source: field(current, 'source') ?? null,
      });
    }
    history.splice(0, history.length, ...retained);
  }

  const target = join(root, text(manifest, 'id'), `${text(manifest, 'version')}-${pkg.digest}`);
  if (!existsSync(target)) {
    const staging = join(root, `.stage-${randomUUID()}`);
    mkdirSync(staging, { recursive: true });
    try {
      for (const [relative, bytes] of pkg.files) {
        const destination = join(staging, relative);
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(destination, bytes);
      }
      mkdirSync(dirname(target), { recursive: true });
      renameSync(staging, target);
    } catch (error) {
      try { rmSync(staging, { recursive: true, force: true }); } catch { /* 清理尽力而为 */ }
      throw new Error(errorText(error));
    }
  }

  const prior = vendorInstallState(state as VendorMigrationState, manifest as unknown as VendorMigrationState['plugins'][number]['manifest']);
  const defaults = field(manifest, 'kind') === 'vendor' && source.startsWith('distribution:') ? prior.connections : listField(manifest, 'defaultConnections') ?? [];
  const record: JsonObject = {
    manifest,
    digest: pkg.digest,
    source,
    enabled: field(manifest, 'kind') === 'vendor' && source.startsWith('distribution:') ? prior.enabled : true,
    removed: field(manifest, 'kind') === 'vendor' && source.startsWith('distribution:') ? prior.removed : false,
    trustedCode: trusted,
    installedAt: chronoStamp(),
    history,
  };
  if (previous >= 0) plugins[previous] = record;
  else plugins.push(record);
  // defaultConnections 只在首次安装该包时填充，用户保存的连接永远优先。
  if (previous < 0) provisionConnections(state, defaults);
}

function provisionDistribution(env: PluginEnvironment, state: unknown): boolean {
  let bytes: Buffer;
  try {
    bytes = readFileSync(join(env.distributionDir, 'index.json'));
  } catch (error) {
    throw new Error(`Default plugin distribution is unavailable: ${errorText(error)}`);
  }
  const index = parseJsonBytes(bytes);
  if (field(index, 'apiVersion') !== 1) throw new Error('Unsupported default plugin distribution');
  const entries = listField(index, 'plugins');
  if (!entries) throw new Error('Invalid default plugin index');
  const connections = listField(state, 'connections');
  if (!connections) throw new Error('Invalid connection registry');
  const protectedConnections = clone(connections);
  let changed = false;

  for (const entry of entries) {
    const id = text(entry, 'id');
    const installed = listField(state, 'plugins');
    if (!installed) throw new Error('Invalid plugin registry');
    if (installed.some((plugin) => field(field(plugin, 'manifest'), 'id') === id)) continue;
    const file = text(entry, 'file');
    if (!idValid(id) || !safePath(file) || file.includes('/')) throw new Error('Invalid release plugin path');
    let packageBytes: Buffer;
    try {
      packageBytes = readFileSync(join(env.distributionDir, file));
    } catch (error) {
      throw new Error(errorText(error));
    }
    const pkg = parsePackage(packageBytes, env.appVersion);
    if (text(pkg.manifest, 'id') !== id
      || !jsonEqual(field(pkg.manifest, 'version'), field(entry, 'version'))
      || pkg.digest !== text(entry, 'sha256')) {
      throw new Error('Default plugin identity or digest mismatch');
    }
    // 发行包随应用一起分发，默认信任；用户卸载/停用记录不会被重新启动抵消。
    const disabled = (listField(state, 'disabledBuiltins') ?? []).some((value) => value === id);
    installInState(state, packageRoot(env), pkg, `distribution:${id}@${text(entry, 'version')}`, text(entry, 'sha256'), true);
    const plugin = (listField(state, 'plugins') ?? []).find((item) => field(field(item, 'manifest'), 'id') === id);
    if (plugin && disabled) assign(plugin, 'enabled', false);
    changed = true;
  }

  if (changed) {
    for (const saved of protectedConnections) {
      const index = connections.findIndex((connection) => field(connection, 'id') === field(saved, 'id'));
      if (index >= 0) connections[index] = clone(saved);
    }
    const disabled = listField(state, 'disabledBuiltins') ?? [];
    for (const connection of connections) {
      if (disabled.some((id) => id === `builtin.${text(connection, 'id')}`)) assign(connection, 'enabled', false);
    }
    if (isRecord(state)) delete state.disabledBuiltins;
  }
  return changed;
}

export interface ProviderPluginListResult {
  state: unknown;
  /** 预置发行包发生安装时，调用方需要写库并发出 provider-plugins-changed。 */
  changed: boolean;
}

/** list：先补齐发行包默认插件；发生变更时写库（事件由命令层发送）。 */
export async function listProviderPlugins(env: PluginEnvironment): Promise<ProviderPluginListResult> {
  return mutations.run(() => {
    const state = readState(env);
    let changed = provisionDistribution(env, state);
    withDatabase(env.databaseFile, db => {
      transaction(db, () => {
        const settings = loadSettings(db, {});
        if (migrateVendorPlugins(state as VendorMigrationState, settings as VendorMigrationSettings)) {
          saveSettings(db, settings); changed = true;
        }
        if (changed) saveCatalog(db, PLUGIN_CATALOG, state);
      });
    });
    return { state, changed };
  });
}

export async function inspectProviderPackage(
  env: PluginEnvironment,
  source: string,
  registry: string,
): Promise<JsonObject> {
  const { pkg, resolvedSource } = await sourcePackage(env, source, registry);
  return {
    manifest: pkg.manifest,
    digest: pkg.digest,
    hasCode: hasOwn(pkg.manifest, 'runtime'),
    resolvedSource,
  };
}

export async function installProviderPackage(
  env: PluginEnvironment,
  source: string,
  expectedDigest: string,
  trustedCode: boolean,
  registry: string,
): Promise<unknown> {
  // 下载/检查在锁外完成，之后才是与 Rust 相同的串行 read-modify-write。
  const { pkg, resolvedSource } = await sourcePackage(env, source, registry);
  return mutations.run(() => {
    const state = readState(env);
    installInState(state, packageRoot(env), pkg, resolvedSource, expectedDigest, trustedCode);
    writeState(env, state);
    return state;
  });
}

export async function searchProviderPlugins(args: JsonObject): Promise<unknown> {
  const base = npmRegistry(text(args, 'registry'));
  const url = new URL('/-/v1/search', base);
  const offset = typeof args.offset === 'number' && Number.isInteger(args.offset) && args.offset >= 0
    ? Math.min(args.offset, 10_000)
    : 0;
  url.search = new URLSearchParams({ text: `shotloom ${text(args, 'query')}`, size: '40', from: String(offset) }).toString();
  return withNpmPluginIcons(parseJsonBytes(await fetchBytes(url.toString(), 4 * 1024 * 1024)), base, (url, limit) => fetchBytes(url, limit, 8000));
}

export async function fetchProviderPluginIndex(url: string): Promise<unknown> {
  const index = parseJsonBytes(await fetchBytes(url, 1024 * 1024));
  if (field(index, 'apiVersion') !== 1 || !Array.isArray(field(index, 'plugins'))) {
    throw new Error('Invalid plugin index');
  }
  return index;
}

export function readProviderPluginDocumentation(env: PluginEnvironment, id: string, path: string): JsonObject {
  const state = readState(env);
  const plugin = (listField(state, 'plugins') ?? []).find((item) => field(field(item, 'manifest'), 'id') === id);
  if (!plugin) throw new Error('Plugin not installed');
  if (!safePath(path) || !path.endsWith('.md')) {
    throw new Error('Documentation must be a relative Markdown path');
  }
  const file = join(artifactDir(env, field(plugin, 'manifest'), text(plugin, 'digest')), path);
  let size: number;
  try {
    size = statSync(file).size;
  } catch (error) {
    throw new Error(errorText(error));
  }
  if (size > MAX_DOCUMENTATION) throw new Error('Documentation exceeds 512 KiB');
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch (error) {
    throw new Error(errorText(error));
  }
  let content: string;
  try {
    content = decodeUtf8Strict(bytes);
  } catch {
    throw new Error('stream did not contain valid UTF-8');
  }
  return { content };
}

export async function configureProviderPlugins(env: PluginEnvironment, args: JsonObject): Promise<unknown> {
  return mutations.run(() => {
    const state = readState(env);
    if (!Array.isArray(field(args, 'connections'))) throw new Error('connections must be an array');
    assign(state, 'connections', clone(field(args, 'connections')));
    assign(state, 'registryUrl', text(args, 'registryUrl'));
    writeState(env, state);
    return state;
  });
}

/** enable / remove / rollback：只改目录记录，包文件与历史版本保留给旧任务。 */
export async function mutateProviderPlugin(env: PluginEnvironment, operation: string, args: JsonObject): Promise<unknown> {
  return mutations.run(() => {
    const state = readState(env);
    const plugins = listField(state, 'plugins');
    if (!plugins) throw new Error('Invalid plugin registry');
    const id = text(args, 'id');
    const plugin = plugins.find((item) => field(field(item, 'manifest'), 'id') === id);
    if (!plugin) throw new Error('Plugin not installed');
    if (operation === 'rollback') {
      const history = listField(plugin, 'history');
      if (!history) throw new Error('No previous version');
      const index = history.findIndex((item) => text(field(item, 'manifest'), 'version') === text(args, 'version'));
      if (index < 0) throw new Error('Version is not installed');
      const old = history.splice(index, 1)[0];
      const current: JsonObject = {
        manifest: clone(field(plugin, 'manifest')),
        digest: field(plugin, 'digest'),
        trustedCode: field(plugin, 'trustedCode'),
        source: field(plugin, 'source'),
      };
      history.push(current);
      for (const key of ['manifest', 'digest', 'trustedCode']) assign(plugin, key, clone(field(old, key)));
      if (hasOwn(old, 'source')) assign(plugin, 'source', clone(field(old, 'source')));
      assign(plugin, 'enabled', true);
    } else {
      assign(plugin, 'enabled', operation === 'enable' && field(args, 'enabled') === true);
      // 卸载只移出可选目录，保留历史版本与凭据，避免破坏旧任务。
      assign(plugin, 'removed', operation === 'remove');
    }
    writeState(env, state);
    return state;
  });
}

// ── 代码插件调用（独立子进程） ──────────────────────────────────────────────

export interface PluginCallArguments {
  requestId: string;
  reference: unknown;
  providerId: string;
  method: string;
  input: unknown;
  timeoutMs: number;
}

export function parsePluginCallArguments(args: JsonObject): PluginCallArguments {
  return {
    requestId: String(args.requestId ?? ''),
    reference: args.reference,
    providerId: String(args.providerId ?? ''),
    method: String(args.method ?? ''),
    input: args.input,
    timeoutMs: typeof args.timeoutMs === 'number' && Number.isFinite(args.timeoutMs) ? Math.trunc(args.timeoutMs) : 0,
  };
}

const pendingCalls = new Map<string, () => void>();

/** provider_plugin_cancel：杀掉子进程并让 inflight 调用以 "Plugin call cancelled" 失败。 */
export function cancelPluginCall(requestId: string): void {
  const cancel = pendingCalls.get(requestId);
  if (!cancel) return;
  pendingCalls.delete(requestId);
  cancel();
}

function recordMatchesReference(record: unknown, reference: unknown): boolean {
  const manifest = field(record, 'manifest');
  if (field(manifest, 'id') === field(reference, 'id') && field(manifest, 'version') === field(reference, 'version')) {
    return true;
  }
  const aliases = listField(manifest, 'legacyProviders');
  return aliases?.some((alias) => field(alias, 'pluginId') === field(reference, 'id')
    && field(alias, 'version') === field(reference, 'version')
    && field(field(alias, 'provider'), 'id') === field(reference, 'providerId')) ?? false;
}

function clampCallTimeout(timeoutMs: number): number {
  return Math.min(Math.max(Number.isFinite(timeoutMs) ? Math.trunc(timeoutMs) : 0, MIN_CALL_TIMEOUT_MS), MAX_CALL_TIMEOUT_MS);
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function submissionKey(providerId: string, submissionId: string): string {
  return createHash('sha256').update(`${providerId}:${submissionId}`).digest('hex');
}

function isExecutableModule(manifest: unknown, reference: unknown, presetId: string): boolean {
  if (field(manifest, 'kind') === 'vendor') return presetId === 'tools' ? isRecord(field(manifest, 'runtime')) : presetId === 'vendor' && field(manifest, 'engine') === 'module';
  const protocol = field(manifest, 'kind') === 'protocol';
  const legacyProtocol = (listField(manifest, 'legacyProviders') ?? []).some((alias) => field(alias, 'pluginId') === field(reference, 'id')
    && field(field(alias, 'provider'), 'id') === presetId
    && field(alias, 'version') === field(reference, 'version'));
  if (protocol && (presetId === 'protocol' || legacyProtocol) && field(manifest, 'engine') === 'module') return true;
  return (listField(manifest, 'providers') ?? []).some((provider) => text(provider, 'id') === presetId && text(provider, 'engine') === 'module');
}

function pluginConfig(state: unknown, settings: unknown, manifest: unknown, providerId: string, presetId: string): JsonObject {
  const providerConfigs = field(settings, 'providerConfigs');
  const configured = field(providerConfigs, providerId);
  const config: JsonObject = isRecord(configured) ? clone(configured) : {};
  const baseUrl = field(config, 'baseUrl');
  if (typeof baseUrl !== 'string' || baseUrl === '') {
    const connections = listField(state, 'connections') ?? [];
    const connection = connections.find((candidate) => text(candidate, 'id') === providerId);
    // 与 Rust 相同：连接上没有 baseUrl 时回退到该插件声明里同 id 的 preset。
    const preset = (listField(manifest, 'providers') ?? []).find((candidate) => text(candidate, 'id') === presetId);
    if (isRecord(connection) && hasOwn(connection, 'baseUrl')) config.baseUrl = connection.baseUrl;
    else if (preset !== undefined) config.baseUrl = field(preset, 'baseUrl') ?? null;
    else config.baseUrl = '';
  }
  config.locale = hasOwn(settings, 'locale') ? field(settings, 'locale') : 'zh-CN';
  return config;
}

export async function callProviderPlugin(env: PluginEnvironment, call: PluginCallArguments): Promise<unknown> {
  if (!['submit', 'poll', 'cancel', 'models'].includes(call.method)) throw new Error('Unsupported plugin method');
  const state = readState(env);
  const plugins = listField(state, 'plugins');
  const plugin = plugins?.find((candidate) => recordMatchesReference(candidate, call.reference)
    || (listField(candidate, 'history')?.some((item) => recordMatchesReference(item, call.reference)) ?? false));
  if (!plugin) throw new Error('Plugin is not installed');
  if (call.method !== 'poll' && call.method !== 'cancel' && field(plugin, 'enabled') !== true) {
    throw new Error('Plugin is disabled');
  }
  const record = recordMatchesReference(plugin, call.reference)
    ? plugin
    : listField(plugin, 'history')?.find((item) => recordMatchesReference(item, call.reference));
  if (!record) throw new Error('Pinned plugin version is not installed');
  if (field(record, 'trustedCode') !== true) throw new Error('Code plugin is not trusted');

  const manifest = field(record, 'manifest');
  const presetId = text(call.reference, 'providerId');
  const protocol = field(manifest, 'kind') === 'protocol';
  if (!isExecutableModule(manifest, call.reference, presetId)) {
    throw new Error('Provider is not a module in this plugin');
  }
  const connections = [...(listField(state, 'connections') ?? []), ...(['poll', 'cancel'].includes(call.method) ? listField(state, 'legacyConnections') ?? [] : [])];
  const vendor = field(manifest, 'kind') === 'vendor';
  if (call.providerId !== presetId) {
    const belongs = connections.some((connection) => text(connection, 'id') === call.providerId
      && ((text(connection, 'pluginId') === text(call.reference, 'id') && (text(connection, 'presetId') === presetId || vendor && presetId === 'tools' && text(connection, 'presetId') === 'vendor'))
        || (protocol && (listField(connection, 'models')?.some((model) => text(model, 'protocolPlugin') === text(call.reference, 'id')) ?? false))));
    if (!belongs) throw new Error('Connection does not belong to this plugin');
  }
  if (call.method === 'submit' && call.providerId !== presetId
    && connections.some((connection) => text(connection, 'id') === call.providerId && field(connection, 'enabled') === false)) {
    throw new Error('Connection is disabled');
  }

  const processing = field(call.input, 'processingContract');
  if (processing !== undefined) {
    const capabilities = listField(manifest, 'capabilities') ?? [];
    const capability = capabilities.find(c => field(c, 'id') === field(field(processing, 'capability'), 'id'));
    const operation = (listField(manifest, 'protocols') ?? []).find(p => field(p, 'id') === field(capability, 'operation'));
    if (field(processing, 'contractVersion') !== 1 || !capability || !operation
      || !jsonEqual(capability, field(processing, 'capability')) || !jsonEqual(operation, field(processing, 'operation'))
      || !jsonEqual(call.reference, field(processing, 'reference')) || text(processing, 'digest') !== text(record, 'digest')
      || text(processing, 'connectionId') !== call.providerId) throw new Error('Invalid pinned processing contract');
    if (!connections.some(c => text(c, 'id') === call.providerId && text(c, 'pluginId') === text(manifest, 'id') && text(c, 'presetId') === (vendor ? 'vendor' : 'protocol'))) throw new Error('Processing requires a plugin connection');
    const parameters = field(processing, 'parameters');
    if (!isRecord(parameters)) throw new Error('Invalid processing parameters');
    const parameterErrors = capabilityParameterErrors(field(capability, 'parameters') as never, parameters);
    if (parameterErrors.length) throw new Error(parameterErrors.join('\n'));
    if (call.method === 'cancel' && field(capability, 'supportsCancel') !== true) throw new Error('Capability does not support remote cancellation');
    const inputs = field(processing, 'inputs');
    if (!isRecord(inputs)) throw new Error('Invalid processing inputs');
    for (const key of Object.keys(inputs)) if (!(listField(capability, 'inputs') ?? []).some(slot => text(slot, 'id') === key)) throw new Error('Unknown processing input');
    for (const slot of listField(capability, 'inputs') ?? []) {
      const items = listField(inputs, text(slot, 'id'));
      if (!items || (field(slot, 'required') === true && !items.length) || (field(slot, 'multiple') !== true && items.length > 1)) throw new Error('Invalid processing input cardinality');
      for (const item of items) {
        if (field(item, 'type') !== field(slot, 'type') || (!text(item, 'filePath') && !text(item, 'url'))) throw new Error('Invalid processing media input');
        if (call.method === 'submit' && text(item, 'filePath') && !isFile(text(item, 'filePath'))) throw new Error('Processing input file is unavailable');
      }
    }
  }

  const root = artifactDir(env, manifest, text(record, 'digest'));
  const entry = text(field(manifest, 'runtime'), 'entry');
  if (!safePath(entry)) throw new Error('Unsafe runtime entry');
  const settings = withDatabase(env.databaseFile, (db) => loadSettings(db, {}));
  const config = pluginConfig(state, settings, manifest, call.providerId, presetId);
  const executable = join(env.runtimeRoot, process.platform === 'win32' ? 'node.exe' : 'node');

  // 提交回执先落库再拉起进程：进程崩溃后不会把已经发出的提交再发一次。
  let receiptKey: string | null = null;
  if (call.method === 'submit') {
    const submission = text(call.input, 'submissionId');
    if (submission === '') throw new Error('Module submit requires a stable submissionId');
    receiptKey = submissionKey(call.providerId, submission);
  }
  if (receiptKey !== null) {
    const cached = await mutations.run<{ value: unknown } | null>(() => {
      const receipts = readSubmissions(env);
      if (hasOwn(receipts, receiptKey)) {
        const receipt = field(receipts, receiptKey);
        if (!jsonEqual(field(receipt, 'reference'), call.reference)) {
          throw new Error('Submission was pinned to another plugin version');
        }
        if (processing !== undefined && !jsonEqual(field(receipt, 'processingContract'), processing)) throw new Error('Submission inputs changed');
        if (hasOwn(receipt, 'result')) return { value: field(receipt, 'result') };
        throw new Error('Submission outcome unknown; recover using the provider task id. This submission will not be sent again.');
      }
      // 先确认 Node 存在再写“已派发”标记，避免把未派发的提交标成结果未知。
      if (!isFile(executable)) throw new Error('Plugin Node runtime unavailable');
      if (isRecord(receipts)) receipts[receiptKey] = { reference: clone(call.reference), startedAt: chronoStamp(), ...(processing === undefined ? {} : { processingContract: clone(processing) }) };
      writeSubmissions(env, receipts);
      return null;
    });
    if (cached) return cached.value;
  }

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(executable, ['--input-type=module', '--eval', PLUGIN_HOST_SOURCE, join(root, entry), call.method], {
      cwd: root,
      // 与 Rust env_clear 后只保留 PATH 一致：插件拿不到主进程的环境变量与凭据。
      env: { PATH: process.env.PATH ?? '' },
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(`Plugin Node runtime unavailable: ${errorText(error)}`);
  }

  const stdin = child.stdin;
  const stdout = child.stdout;
  if (!stdin) throw new Error('Plugin stdin unavailable');
  if (!stdout) throw new Error('Plugin stdout unavailable');

  let exitFailure: Error | null = null;
  // 与 Rust spawn 失败时的前缀一致；否则 Node 的 'error' 事件只会落在 stdout 迭代里。
  const spawnFailure = new Promise<never>((_resolve, reject) => {
    child.once('error', (error) => reject(new Error(`Plugin Node runtime unavailable: ${errorText(error)}`)));
  });
  const exitPromise = new Promise<number | null>((resolve) => {
    child.once('error', (error) => {
      exitFailure = new Error(`Plugin Node runtime unavailable: ${errorText(error)}`);
      resolve(null);
    });
    child.once('close', (code) => resolve(code));
  });

  const runWork = async (): Promise<unknown> => {
    const payload = JSON.stringify({ input: call.input, config });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      stdin.once('error', onError);
      stdin.end(payload, () => {
        stdin.removeListener('error', onError);
        resolve();
      });
    });
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stdout) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      total += buffer.length;
      if (total > MAX_PLUGIN_RESPONSE) {
        child.kill('SIGKILL');
        throw new Error('Plugin response exceeds 10 MiB');
      }
      chunks.push(buffer);
    }
    const code = await exitPromise;
    if (exitFailure) throw exitFailure;
    let response: unknown;
    try {
      response = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      throw new Error('Invalid plugin response');
    }
    if (code !== 0 || hasOwn(response, 'error')) {
      const message = field(response, 'error');
      throw new Error(typeof message === 'string' ? message : 'Plugin failed');
    }
    return hasOwn(response, 'result') ? field(response, 'result') : null;
  };

  let cancel!: () => void;
  const cancellation = new Promise<never>((_resolve, reject) => {
    cancel = () => {
      child.kill('SIGKILL');
      reject(new Error('Plugin call cancelled'));
    };
  });
  if (pendingCalls.has(call.requestId)) {
    child.kill('SIGKILL');
    throw new Error('Duplicate plugin request id');
  }
  pendingCalls.set(call.requestId, cancel);
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Plugin call timed out'));
    }, clampCallTimeout(call.timeoutMs));
  });

  let result: unknown;
  try {
    result = await Promise.race([runWork(), spawnFailure, cancellation, timeout]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (pendingCalls.get(call.requestId) === cancel) pendingCalls.delete(call.requestId);
    if (child.exitCode === null) child.kill('SIGKILL');
  }

  if (receiptKey !== null) {
    await mutations.run(() => {
      const receipts = readSubmissions(env);
      const receipt = field(receipts, receiptKey);
      if (isRecord(receipt)) receipt.result = clone(result);
      writeSubmissions(env, receipts);
    });
  }
  return result;
}
