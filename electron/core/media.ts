import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { mkdtemp, open, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { localizedError, errorMessage } from './errors';
import { isMediaExtension, isSafeOpenTarget } from './files';

/**
 * 原生媒体能力的公共底座：工具解析、子进程、取消登记、图片像素格式转换与模型输入读取边界。
 * 对应 src-tauri/src/commands/{media_tool,media_tasks,media_paths}.rs；
 * 命令注册在 ipc/commands/media.ts，生成网关与导出层复用这里的导出。
 */

// ---------------------------------------------------------------------------
// FFmpeg / FFprobe 解析（media_tool.rs）
// ---------------------------------------------------------------------------

const resolvedTools = new Map<string, string>();

function appResourcesPath(): string | null {
  // 纯 Node（测试/脚本）没有 resourcesPath，只有 Electron 打包后才存在。
  const resources = (process as NodeJS.Process & { resourcesPath?: unknown }).resourcesPath;
  return typeof resources === 'string' && resources ? resources : null;
}

/** 开发依赖里的静态二进制：只在开发/未打包环境存在，因此按可选项处理。 */
function staticMediaTool(name: string): string | null {
  if (name !== 'ffmpeg' && name !== 'ffprobe') return null;
  const moduleName = name === 'ffmpeg' ? 'ffmpeg-static' : 'ffprobe-static';
  try {
    // 打包后 __dirname 是 dist/electron，向上仍能命中工程的 node_modules；
    // 用 createRequire 而不是静态 import，避免 esbuild 把二进制路径固化进 bundle。
    const requireFromApp = createRequire(join(__dirname, 'package.json'));
    const exported: unknown = requireFromApp(moduleName);
    if (typeof exported === 'string') return exported;
    if (exported && typeof exported === 'object') {
      const path = (exported as { path?: unknown }).path;
      if (typeof path === 'string') return path;
    }
  } catch {
    // ffmpeg-static / ffprobe-static 属于 devDependencies，正式包里没有。
  }
  return null;
}

function mediaToolCandidates(name: string, executable: string): string[] {
  const candidates: string[] = [];
  const executableDir = dirname(process.execPath);
  // 与 Tauri 的 sidecar 布局一致：可执行文件旁、resources/ 旁、macOS App 的 Contents/Resources。
  candidates.push(join(executableDir, executable));
  candidates.push(join(executableDir, 'resources', executable));
  candidates.push(join(dirname(executableDir), 'Resources', executable));
  // 开发期没有打包布局：bundle 位于 dist/electron，向上两级就是工程根目录的 electron/resources。
  // 不用 process.cwd()，避免应用从任意目录启动时执行到同名文件。
  candidates.push(join(__dirname, '..', '..', 'electron', 'resources', executable));
  const staticPath = staticMediaTool(name);
  if (staticPath) candidates.push(staticPath);
  const resources = appResourcesPath();
  if (resources) {
    candidates.push(join(resources, executable));
    candidates.push(join(resources, 'bin', executable));
  }
  if (process.platform === 'darwin') {
    candidates.push(join('/opt/homebrew/bin', name), join('/usr/local/bin', name));
  } else if (process.platform !== 'win32') {
    candidates.push(join('/usr/bin', name), join('/usr/local/bin', name));
  }
  // 裸名字交给 PATH 查找，对应 Rust 最后一个 Command::new(name) 候选。
  candidates.push(executable);
  return [...new Set(candidates)];
}

function toolResponds(executable: string): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false;
    const done = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const child = spawn(executable, ['-version'], { stdio: 'ignore' });
      child.on('error', () => done(false));
      child.on('close', code => done(code === 0));
    } catch {
      done(false);
    }
  });
}

/** 与 media_tool.rs 同一套候选顺序，额外加入 ffmpeg-static / ffprobe-static 与 app resources。 */
export async function resolveMediaTool(name: string): Promise<string> {
  const cached = resolvedTools.get(name);
  if (cached) return cached;
  const executable = process.platform === 'win32' ? `${name}.exe` : name;
  for (const candidate of mediaToolCandidates(name, executable)) {
    if (await toolResponds(candidate)) {
      resolvedTools.set(name, candidate);
      return candidate;
    }
  }
  throw new Error(localizedError(
    'native.error.140a8961f2',
    { name, executable },
    `未找到 ${name}。请安装 FFmpeg，或将 ${executable} 放入应用资源目录`,
  ));
}

// ---------------------------------------------------------------------------
// 子进程（Command::output 的等价实现）
// ---------------------------------------------------------------------------

export interface MediaProcessResult {
  ok: boolean;
  stdout: Buffer;
  stderr: string;
}

/**
 * 运行命令并收齐 stdout/stderr。只有“启动失败”才 reject；
 * 非零退出码是普通结果，因为 ffmpeg -i 这类探测命令正是靠 stderr 汇报事实。
 */
export function captureMediaProcess(
  executable: string,
  args: string[],
  input?: Uint8Array,
): Promise<MediaProcessResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (work: () => void) => {
      if (settled) return;
      settled = true;
      work();
    };
    const child = spawn(executable, args);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    // 子进程提前退出时 stdin 会 EPIPE；这不是用户可见的失败，最终以退出码为准。
    child.stdin.on('error', () => undefined);
    child.on('error', error => settle(() => reject(error)));
    child.on('close', code => settle(() => resolve({
      ok: code === 0,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr).toString('utf8'),
    })));
    child.stdin.end(input);
  });
}

/** 启动失败的本地化包装：调用方各自持有 Rust 里对应的错误键与文案。 */
export function mediaProcessFailure(key: string, label: string): (error: unknown) => never {
  return error => {
    const detail = errorMessage(error);
    throw new Error(localizedError(key, { error: detail }, `${label}：${detail}`));
  };
}

// ---------------------------------------------------------------------------
// 长时任务取消（media_tasks.rs）
// ---------------------------------------------------------------------------

/** 渲染进程用 requestId 登记任务；自己只持有可变标记，等价于 Arc<AtomicBool>。 */
export interface MediaTaskFlag {
  cancelled: boolean;
}

const mediaTasks = new Map<string, MediaTaskFlag>();

export function beginMediaTask(requestId: string): MediaTaskFlag {
  const flag: MediaTaskFlag = { cancelled: false };
  mediaTasks.set(requestId, flag);
  return flag;
}

export function finishMediaTask(requestId: string): void {
  mediaTasks.delete(requestId);
}

export function cancelMediaTask(requestId: string): boolean {
  const flag = mediaTasks.get(requestId);
  if (!flag) return false;
  flag.cancelled = true;
  return true;
}

export interface FfmpegRun {
  ok: boolean;
  stderr: string;
  cancelled: boolean;
}

function stderrTail(text: string): string {
  // 与 Rust 一致只保留最后 4000 个字符，错误提示不因整段进度日志膨胀。
  return text.slice(-4_000);
}

/** 运行 FFmpeg 并轮询取消标记；stderr 持续读空，否则管道写满会卡住子进程。 */
export function runFfmpeg(executable: string, args: string[], cancelled: MediaTaskFlag): Promise<FfmpegRun> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (work: () => void) => {
      if (settled) return;
      settled = true;
      work();
    };
    const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const chunks: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
    const timer = setInterval(() => {
      if (cancelled.cancelled) child.kill();
    }, 50);
    const stop = () => clearInterval(timer);
    child.on('error', error => {
      stop();
      settle(() => {
        const detail = errorMessage(error);
        reject(new Error(localizedError('native.error.e9f40671ae', { error: detail }, `无法启动 FFmpeg：${detail}`)));
      });
    });
    child.on('close', code => {
      stop();
      settle(() => {
        if (cancelled.cancelled) {
          resolve({ ok: false, stderr: '', cancelled: true });
          return;
        }
        resolve({ ok: code === 0, stderr: stderrTail(Buffer.concat(chunks).toString('utf8')), cancelled: false });
      });
    });
  });
}

// ---------------------------------------------------------------------------
// 临时目录：先写临时文件再原子替换的中转区域
// ---------------------------------------------------------------------------

export async function createTempDirectory(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

export async function createTempFile(prefix: string, extension = '', data?: Uint8Array): Promise<string> {
  const directory = await createTempDirectory(prefix);
  const file = join(directory, `payload${extension}`);
  if (data) await writeFile(file, data);
  return file;
}

export async function removeTempDirectory(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 模型输入读取边界（media_paths.rs）
// ---------------------------------------------------------------------------

export { isMediaExtension, isSafeOpenTarget };

/** 网关允许的单文件上限；超过它不是“文件坏了”，而是外发体积越界。 */
const MAX_MODEL_INPUT_BYTES = 512 * 1024 * 1024;

export function hasHiddenComponent(path: string): boolean {
  return path
    .split(/[\\/]+/)
    .filter(component => component && component !== '.' && component !== '..')
    .some(component => component.startsWith('.'));
}

/** 按路径段判断前缀，避免 `/a/bc` 被误认成 `/a/b` 的子路径。 */
export function isPathWithin(candidate: string, root: string): boolean {
  if (!root) return false;
  const relativePath = relative(root, candidate);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

/**
 * 应用数据目录内的文件总是可读；主目录之外一律拒绝；主目录内只放行
 * “人工挑选的媒体文件”（媒体扩展名且路径中不含隐藏段）。
 */
export function classifyMediaFile(target: string, appData: string, home: string | null): void {
  if (isPathWithin(target, appData)) return;
  const insideHome = home !== null && isPathWithin(target, home);
  if (!insideHome) {
    throw new Error(localizedError(
      'native.error.f05957ef70',
      { path: target },
      `模型输入文件必须位于当前项目目录、素材库或用户主目录内：${target}`,
    ));
  }
  if (hasHiddenComponent(target) || !isMediaExtension(target)) {
    throw new Error(localizedError(
      'native.error.3949522951',
      { path: target },
      `项目目录之外的模型输入只能是媒体文件：${target}`,
    ));
  }
}

/** 校验并返回真实路径；canonicalize 之后的判断才不会被符号链接带出边界。 */
export async function resolveInputFile(appData: string, home: string | null, path: string): Promise<string> {
  let resolved: string;
  try {
    resolved = await realpath(path);
  } catch (error) {
    const detail = errorMessage(error);
    throw new Error(localizedError(
      'native.error.6fd93f3505',
      { path, error: detail },
      `无法读取模型输入文件 ${path}: ${detail}`,
    ));
  }
  const metadata = await stat(resolved);
  if (!metadata.isFile()) {
    throw new Error(localizedError(
      'native.error.68ec0e94d7',
      { path },
      `模型输入文件不存在或不是普通文件：${path}`,
    ));
  }
  classifyMediaFile(resolved, appData, home);
  if (metadata.size > MAX_MODEL_INPUT_BYTES) {
    const megabytes = Math.trunc(metadata.size / (1024 * 1024));
    throw new Error(localizedError(
      'native.error.534ec3e54f',
      { size: String(megabytes), path },
      `模型输入文件 ${path} 有 ${megabytes} MB，超过网关允许的最大输入体积`,
    ));
  }
  return resolved;
}

/** 用户主目录就是“通过文件对话框人工挑选素材”的现实边界。 */
export function homeRoot(): string | null {
  return process.env.HOME || process.env.USERPROFILE || null;
}

// ---------------------------------------------------------------------------
// 图片像素/格式（image.rs 的可观测结果，用 ffmpeg 解码编码代替 image crate）
// ---------------------------------------------------------------------------

export interface ImageSize {
  width: number;
  height: number;
}

export function orientedImageSize(width: number, height: number, orientation: number): ImageSize {
  // EXIF 5–8 会交换宽高；其余方向只做镜像，不改变尺寸。
  return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
}

/** image crate 的 thumbnail(max,max)：等比缩放到边界内；比边界还小的图也会被放大，保持和 Rust 一致。 */
export function thumbnailSize(width: number, height: number, maxSize: number): ImageSize {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const ratio = Math.min(maxSize / width, maxSize / height);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

const ORIENTATION_FILTERS: Record<number, string[]> = {
  2: ['hflip'],
  3: ['hflip', 'vflip'],
  4: ['vflip'],
  5: ['transpose=0'],
  6: ['transpose=1'],
  7: ['transpose=3'],
  8: ['transpose=2'],
};

export function imageOrientationFilters(orientation: number): string[] {
  return [...(ORIENTATION_FILTERS[orientation] ?? [])];
}

interface ExifEndian {
  little: boolean;
}

function parseTiffOrientation(bytes: Buffer, start: number, end: number): number {
  if (start + 8 > end) return 1;
  let endian: ExifEndian;
  if (bytes[start] === 0x49 && bytes[start + 1] === 0x49) endian = { little: true };
  else if (bytes[start] === 0x4d && bytes[start + 1] === 0x4d) endian = { little: false };
  else return 1;
  const readU16 = (offset: number): number => (endian.little ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset));
  const readU32 = (offset: number): number => (endian.little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset));
  const magic = readU16(start + 2);
  if (magic !== 42) return 1;
  const ifdOffset = readU32(start + 4);
  const ifdStart = start + ifdOffset;
  if (ifdStart + 2 > end) return 1;
  const entries = readU16(ifdStart);
  for (let index = 0; index < entries; index += 1) {
    const entry = ifdStart + 2 + index * 12;
    if (entry + 12 > end) return 1;
    const tag = readU16(entry);
    const format = readU16(entry + 2);
    const count = readU32(entry + 4);
    if (tag === 0x0112 && format === 3 && count === 1) {
      const orientation = readU16(entry + 8);
      return orientation >= 1 && orientation <= 8 ? orientation : 1;
    }
  }
  return 1;
}

function exifOrientationFromBytes(bytes: Buffer): number {
  // JPEG：扫描 APP1 段里的 Exif 载荷。
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) return 1;
      const marker = bytes[offset + 1];
      // 0xFF 填充字节合法地出现在标记之间，直接跳过而不是当成段头。
      if (marker === 0xff) {
        offset += 1;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      if (marker === 0xda) return 1; // 进入压缩数据，之后不会再有 Exif。
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2) return 1;
      if (marker === 0xe1 && offset + 10 <= bytes.length
        && bytes.toString('latin1', offset + 4, offset + 10) === 'Exif\0\0') {
        return parseTiffOrientation(bytes, offset + 10, Math.min(offset + 2 + length, bytes.length));
      }
      offset += 2 + length;
    }
    return 1;
  }
  // WebP：RIFF 容器里的 EXIF chunk（部分写入器会带上 Exif\0\0 前缀）。
  if (bytes.length >= 12
    && bytes.toString('latin1', 0, 4) === 'RIFF'
    && bytes.toString('latin1', 8, 12) === 'WEBP') {
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const fourcc = bytes.toString('latin1', offset, offset + 4);
      const size = bytes.readUInt32LE(offset + 4);
      if (fourcc === 'EXIF') {
        let start = offset + 8;
        if (bytes.toString('latin1', start, start + 6) === 'Exif\0\0') start += 6;
        return parseTiffOrientation(bytes, start, Math.min(offset + 8 + size, bytes.length));
      }
      offset += 8 + size + (size % 2);
    }
    return 1;
  }
  // 与 image crate 一致：PNG/GIF/BMP 不参与 EXIF 方向修正。
  return 1;
}

/** 读取 EXIF 方向（1–8）；只覆盖 JPEG 与 WebP，因为 Rust 的 image crate 也只处理这两类。 */
export async function readExifOrientation(path: string): Promise<number> {
  let handle;
  try {
    handle = await open(path, 'r');
    const buffer = Buffer.alloc(512 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return exifOrientationFromBytes(buffer.subarray(0, bytesRead));
  } catch {
    return 1;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function parseLogDimensions(stderr: string): ImageSize | null {
  for (const line of stderr.split(/\r?\n/)) {
    if (!line.includes('Video:')) continue;
    const match = line.match(/(?:^|[\s,(])(\d{1,6})x(\d{1,6})(?=$|[\s,)])/);
    if (!match) continue;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (width > 0 && height > 0) return { width, height };
  }
  return null;
}

/**
 * 读取图片的编码尺寸。ffprobe 优先，缺失时从 ffmpeg 的流信息里取同一对事实；
 * 这是缩放/裁剪坐标换算的前提，不是媒体探测命令的公开结果。
 */
export async function probeImageSize(source: string): Promise<ImageSize> {
  try {
    const ffprobe = await resolveMediaTool('ffprobe');
    const result = await captureMediaProcess(ffprobe, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'json',
      source,
    ]);
    if (result.ok) {
      const parsed = JSON.parse(result.stdout.toString('utf8')) as {
        streams?: { width?: unknown; height?: unknown }[];
      };
      const stream = parsed.streams?.[0];
      const width = typeof stream?.width === 'number' ? Math.trunc(stream.width) : 0;
      const height = typeof stream?.height === 'number' ? Math.trunc(stream.height) : 0;
      if (width > 0 && height > 0) return { width, height };
    }
  } catch {
    // 没有 ffprobe 或探测失败时退回 ffmpeg 的 stderr。
  }
  const ffmpeg = await resolveMediaTool('ffmpeg');
  const result = await captureMediaProcess(ffmpeg, ['-hide_banner', '-i', source]);
  const dimensions = parseLogDimensions(result.stderr);
  if (!dimensions) throw new Error('无法读取图片尺寸');
  return dimensions;
}

/**
 * 解码为 RGBA 原始帧。调用方给出 EXIF 方向与裁剪滤镜以及期望尺寸，
 * 这样像素坐标语义和 Rust 的 apply_orientation + crop_imm 保持一致。
 */
export async function decodeImageRgba(
  source: string,
  filters: string[],
  width: number,
  height: number,
): Promise<Buffer> {
  const ffmpeg = await resolveMediaTool('ffmpeg');
  const filter = [...filters, 'format=rgba'].filter(Boolean).join(',');
  const result = await captureMediaProcess(ffmpeg, [
    // 方向由调用方的滤镜显式处理，解码器不能再自动旋转一次。
    '-noautorotate', '-v', 'error', '-y', '-i', source,
    '-vf', filter, '-frames:v', '1', '-f', 'rawvideo', 'pipe:1',
  ]);
  if (!result.ok) throw new Error(result.stderr.trim() || 'ffmpeg exited with a non-zero status');
  const expected = width * height * 4;
  if (result.stdout.length !== expected) {
    throw new Error(`decoded frame is ${result.stdout.length} bytes, expected ${expected} for ${width}x${height}`);
  }
  return result.stdout;
}

/** RGBA 原始帧编码为 PNG；crop/彩铅都要求输出 PNG，与 Rust 的 save_with_format(Png) 一致。 */
export async function encodeRgbaPng(width: number, height: number, data: Uint8Array): Promise<Buffer> {
  const ffmpeg = await resolveMediaTool('ffmpeg');
  const result = await captureMediaProcess(ffmpeg, [
    '-v', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-i', 'pipe:0',
    '-frames:v', '1', '-c:v', 'png', '-f', 'image2pipe', 'pipe:1',
  ], data);
  if (!result.ok) throw new Error(result.stderr.trim() || 'ffmpeg exited with a non-zero status');
  return result.stdout;
}
