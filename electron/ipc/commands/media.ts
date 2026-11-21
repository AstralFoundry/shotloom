import { createHash } from 'node:crypto';
import { constants, existsSync, statSync } from 'node:fs';
import { access, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { unzipSync, zipSync, type Zippable } from 'fflate';
import { defineCommand } from '../registry';
import { localizedError, errorMessage } from '../../core/errors';
import { appDataDir } from '../../core/paths';
import { fileResult, uniqueFilePath } from '../../core/files';
import {
  cancelMediaTask,
  captureMediaProcess,
  decodeImageRgba,
  encodeRgbaPng,
  imageOrientationFilters,
  mediaProcessFailure,
  orientedImageSize,
  probeImageSize,
  readExifOrientation,
  resolveMediaTool,
  thumbnailSize,
} from '../../core/media';

/**
 * 媒体与图像命令：探测、音轨拆分、截帧、拼接、图片预览/裁剪/彩铅与资源包。
 * 命令名、参数名、返回 JSON 形状与错误键沿用 src-tauri/src/commands/*.rs，
 * 渲染进程的 command() 映射表不需要区分底层实现。
 */

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function detailError(key: string, label: string, detail: string): Error {
  return new Error(localizedError(key, { error: detail }, `${label}：${detail}`));
}

function outputDetailError(detail: string, fallbackKey: string, fallbackText: string): Error {
  // Rust 在 stderr 非空时直接把 ffmpeg 原文抛给渲染进程，只有空 stderr 才用本地化文案。
  const trimmed = detail.trim();
  return trimmed ? new Error(trimmed) : new Error(localizedError(fallbackKey, {}, fallbackText));
}

// ---------------------------------------------------------------------------
// 媒体探测（media_probe.rs）
// ---------------------------------------------------------------------------

function parseDuration(stderr: string): number | null {
  const marker = stderr.indexOf('Duration:');
  if (marker < 0) return null;
  const rest = stderr.slice(marker + 'Duration:'.length).trimStart();
  const token = rest.split(',')[0].trim();
  if (token.toLowerCase() === 'n/a') return null;
  const parts = token.split(':');
  const hours = parseFloatToken(parts[0] ?? '');
  const minutes = parseFloatToken(parts[1] ?? '');
  const seconds = parseFloatToken(parts[2] ?? '');
  if (hours === null || minutes === null || seconds === null) return null;
  const total = hours * 3600 + minutes * 60 + seconds;
  return Number.isFinite(total) ? total : null;
}

/** Rust 的 f64::from_str 不接受空串，而 Number('') 是 0，所以先做完整数字校验。 */
function parseFloatToken(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) return null;
  return Number(trimmed);
}

function parseUintToken(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text.trim());
  return Number.isSafeInteger(value) && value >= 0 && value <= 0xffff_ffff ? value : null;
}

function parseDimensions(stderr: string): [number, number] | null {
  for (const line of stderr.split(/\r?\n/)) {
    if (!line.includes('Video:')) continue;
    for (const token of line.split(/[\s,()]+/)) {
      const parts = token.split('x');
      if (parts.length !== 2) continue;
      const width = parseUintToken(parts[0]);
      const height = parseUintToken(parts[1]);
      if (width === null || height === null) continue;
      // 编解码器标签形如 0x31637661，宽度会是 0，据此排除。
      if (width > 0 && height > 0) return [width, height];
    }
  }
  return null;
}

interface MediaProbe {
  duration: number;
  width: number;
  height: number;
}

async function probeWithFfprobe(ffprobe: string, source: string): Promise<MediaProbe | null> {
  const result = await captureMediaProcess(ffprobe, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-show_entries', 'format=duration',
    '-of', 'json',
    source,
  ]).catch(() => null);
  if (!result || !result.ok) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout.toString('utf8'));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const format = isRecord(parsed.format) ? parsed.format : {};
  const durationText = format.duration;
  const rawDuration = typeof durationText === 'string' ? Number(durationText) : Number.NaN;
  // 单张图片没有容器时长：时长缺席按 0 返回，尺寸仍然是真实事实。
  const duration = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0;
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const stream = isRecord(streams[0]) ? streams[0] : {};
  const width = typeof stream.width === 'number' ? Math.trunc(stream.width) : 0;
  const height = typeof stream.height === 'number' ? Math.trunc(stream.height) : 0;
  return duration > 0 || (width > 0 && height > 0) ? { duration, width, height } : null;
}

async function probeWithFfmpeg(ffmpeg: string, source: string): Promise<MediaProbe> {
  const result = await captureMediaProcess(ffmpeg, ['-hide_banner', '-i', source])
    .catch(mediaProcessFailure('native.error.700ffa2075', '无法启动媒体探测'));
  const duration = parseDuration(result.stderr);
  const dimensions = parseDimensions(result.stderr);
  if (duration === null && dimensions === null) {
    throw new Error(localizedError('native.error.76ed3ab41a', {}, '无法读取媒体信息'));
  }
  return {
    duration: duration ?? 0,
    width: dimensions?.[0] ?? 0,
    height: dimensions?.[1] ?? 0,
  };
}

async function probeMedia(source: string): Promise<MediaProbe> {
  let ffprobe: string | null = null;
  try {
    ffprobe = await resolveMediaTool('ffprobe');
  } catch {
    // 没有 ffprobe 时仍可用 ffmpeg 的流信息得出同一对事实。
  }
  if (ffprobe) {
    const value = await probeWithFfprobe(ffprobe, source);
    if (value) return value;
  }
  return probeWithFfmpeg(await resolveMediaTool('ffmpeg'), source);
}

defineCommand('file_probe_media', async args => {
  const source = String(args.source ?? '');
  if (!isFile(source)) throw new Error(localizedError('native.error.eb35c63468', {}, '媒体文件不存在'));
  return probeMedia(source);
});

// ---------------------------------------------------------------------------
// 音轨探测与拆分（audio.rs）
// ---------------------------------------------------------------------------

async function sourceHasAudio(ffmpeg: string, source: string): Promise<boolean> {
  const result = await captureMediaProcess(ffmpeg, [
    '-v', 'error', '-i', source,
    '-map', '0:a:0', '-frames:a', '1', '-f', 'null', '-',
  ]).catch(() => null);
  return result?.ok ?? false;
}

defineCommand('file_has_audio', async args => {
  const source = String(args.source ?? '');
  if (!isFile(source)) throw new Error(localizedError('native.error.f867756ee1', {}, '视频文件不存在'));
  const ffmpeg = await resolveMediaTool('ffmpeg');
  return sourceHasAudio(ffmpeg, source);
});

defineCommand('file_separate_audio', async args => {
  const source = String(args.source ?? '');
  const audioTarget = String(args.audioTarget ?? '');
  const silentVideoTarget = String(args.silentVideoTarget ?? '');
  if (!isFile(source)) throw new Error(localizedError('native.error.f867756ee1', {}, '视频文件不存在'));
  const ffmpeg = await resolveMediaTool('ffmpeg');
  if (!(await sourceHasAudio(ffmpeg, source))) {
    throw new Error(localizedError('native.error.1940ebff8a', {}, '当前视频不包含可分离的音轨'));
  }
  for (const target of [audioTarget, silentVideoTarget]) {
    try {
      await mkdir(dirname(target), { recursive: true });
    } catch (error) {
      throw detailError('native.error.7e6821cb13', '无法创建拆分目录', errorMessage(error));
    }
  }
  const result = await captureMediaProcess(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', source,
    '-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '192k', audioTarget,
    '-map', '0:v:0', '-an', '-c:v', 'copy', '-movflags', '+faststart', silentVideoTarget,
  ]).catch(mediaProcessFailure('native.error.06a61c42b4', '无法启动音频分离'));
  if (!result.ok) {
    await rm(audioTarget, { force: true }).catch(() => undefined);
    await rm(silentVideoTarget, { force: true }).catch(() => undefined);
    throw outputDetailError(result.stderr, 'native.error.e5e53a6cbe', '音频分离失败');
  }
  return { audio: await fileResult(audioTarget), video: await fileResult(silentVideoTarget) };
});

// ---------------------------------------------------------------------------
// 视频截帧（video_frame.rs）
// ---------------------------------------------------------------------------

interface FramePosition {
  last: boolean;
  seconds: number;
}

/** Rust 用 untagged 枚举接收数字秒数或字符串 "last"；其它值按无效时间处理。 */
function readFramePosition(value: unknown): FramePosition | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? { last: false, seconds: value } : null;
  }
  if (value === 'last') return { last: true, seconds: 0 };
  return null;
}

defineCommand('file_capture_video_frame', async args => {
  const position = readFramePosition(args.seconds);
  if (!position) throw new Error(localizedError('native.error.3f51b31f6e', {}, '截帧时间无效'));
  const source = String(args.source ?? '');
  const target = String(args.target ?? '');
  if (!isFile(source)) throw new Error(localizedError('native.error.f867756ee1', {}, '视频文件不存在'));
  try {
    await mkdir(dirname(target), { recursive: true });
  } catch (error) {
    throw detailError('native.error.b849c6e2ad', '无法创建截帧目录', errorMessage(error));
  }
  const ffmpeg = await resolveMediaTool('ffmpeg');
  const run = (seekTail: boolean) => {
    const command = ['-hide_banner', '-loglevel', 'error', '-y'];
    if (!position.last) command.push('-ss', position.seconds.toFixed(6));
    else if (seekTail) command.push('-sseof', '-1');
    command.push('-i', source, '-map', '0:v:0', '-an');
    if (position.last) {
      // 后续帧覆盖同一张图片：EOF 后留下真正解码到的最后一帧，不必把整段视频反向读进内存。
      command.push('-fps_mode', 'passthrough', '-update', '1');
    } else {
      command.push('-frames:v', '1');
    }
    command.push(target);
    return captureMediaProcess(ffmpeg, command)
      .catch(mediaProcessFailure('native.error.bec71471c7', '无法启动视频截帧'));
  };
  let output = await run(position.last);
  // 容器 EOF 可能晚于视频 EOF（例如音轨更长）；尾部没有画面时从头解码找真正的末帧。
  if (position.last && output.ok && !isFile(target)) output = await run(false);
  if (!output.ok || !isFile(target)) {
    await rm(target, { force: true }).catch(() => undefined);
    throw outputDetailError(output.stderr, 'native.error.22c399361b', '视频截帧失败');
  }
  return fileResult(target);
});

// ---------------------------------------------------------------------------
// 视频拼接（video_concat.rs）
// ---------------------------------------------------------------------------

interface VideoInfo {
  width: number;
  height: number;
  fps: number;
  duration: number | null;
  hasAudio: boolean;
}

function findDimensions(line: string): [number, number] | null {
  // 按字节扫描数字对，因此 [0x1]、0x31637661 这类十六进制片段不会被误读。
  let index = 0;
  while (index < line.length) {
    const code = line.charCodeAt(index);
    if (code < 48 || code > 57) {
      index += 1;
      continue;
    }
    const widthStart = index;
    while (index < line.length && line.charCodeAt(index) >= 48 && line.charCodeAt(index) <= 57) index += 1;
    if (line[index] === 'x') {
      const widthEnd = index;
      index += 1;
      const heightStart = index;
      while (index < line.length && line.charCodeAt(index) >= 48 && line.charCodeAt(index) <= 57) index += 1;
      if (index > heightStart) {
        const width = Number(line.slice(widthStart, widthEnd));
        const height = Number(line.slice(heightStart, index));
        if (width >= 16 && width <= 16384 && height >= 16 && height <= 16384) return [width, height];
      }
    }
    index += 1;
  }
  return null;
}

function findFps(line: string): number | null {
  const marker = line.indexOf(' fps');
  if (marker < 0) return null;
  const match = line.slice(0, marker).match(/([0-9.]+)\s*$/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

async function probeVideo(ffmpeg: string, source: string): Promise<VideoInfo> {
  const result = await captureMediaProcess(ffmpeg, ['-hide_banner', '-i', source])
    .catch(mediaProcessFailure('native.error.2cb490f7af', '无法读取视频信息'));
  const line = result.stderr.split(/\r?\n/).find(item => item.includes('Video:')) ?? '';
  if (!line) {
    throw new Error(localizedError('native.error.110e1c37ae', { path: source }, `不是可识别的视频文件：${source}`));
  }
  const dimensions = findDimensions(line);
  if (!dimensions) {
    throw new Error(localizedError('native.error.1c6c568315', { path: source }, `无法读取视频尺寸：${source}`));
  }
  return {
    width: dimensions[0], height: dimensions[1], fps: findFps(line) ?? 30,
    duration: parseDuration(result.stderr),
    hasAudio: result.stderr.split(/\r?\n/).some((item) => item.includes('Audio:')),
  };
}

/** 每个输入先等比缩放补黑边到基准尺寸、统一帧率与像素格式，再整体 concat。 */
function buildConcatFilter(width: number, height: number, fps: number, clips: VideoInfo[], withAudio: boolean): string {
  const parts: string[] = [];
  const inputs: string[] = [];
  clips.forEach((clip, index) => {
    parts.push(`[${index}:v]setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,`
      + `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p[v${index}]`);
    inputs.push(`[v${index}]`);
    if (!withAudio) return;
    if (clip.hasAudio) {
      const fit = clip.duration ? `,apad,atrim=duration=${clip.duration}` : '';
      parts.push(`[${index}:a:0]aresample=48000:async=1:first_pts=0,aformat=channel_layouts=stereo${fit}[a${index}]`);
    } else {
      parts.push(`anullsrc=r=48000:cl=stereo:d=${clip.duration}[a${index}]`);
    }
    inputs.push(`[a${index}]`);
  });
  parts.push(`${inputs.join('')}concat=n=${clips.length}:v=1:a=${withAudio ? 1 : 0}${withAudio ? '[outv][outa]' : '[outv]'}`);
  return parts.join(';');
}

defineCommand('file_concat_videos', async args => {
  const sources = Array.isArray(args.sources) ? args.sources.map(item => String(item)) : [];
  if (sources.length < 2) {
    throw new Error(localizedError('native.error.f6df00df31', {}, '视频拼接至少需要两个文件'));
  }
  for (const path of sources) {
    if (!isFile(path)) {
      throw new Error(localizedError('native.error.8b2466fe6b', { path }, `视频文件不存在：${path}`));
    }
  }
  const target = String(args.target ?? '');
  if (!target) throw new Error(localizedError('native.error.62e34b89ae', {}, '缺少拼接输出路径'));
  try {
    await mkdir(dirname(target), { recursive: true });
  } catch (error) {
    throw detailError('native.error.0c0d67e058', '无法创建拼接目录', errorMessage(error));
  }
  const ffmpeg = await resolveMediaTool('ffmpeg');
  const clips: VideoInfo[] = [];
  for (const path of sources) clips.push(await probeVideo(ffmpeg, path));
  const [base] = clips;
  const width = Math.max(2, 2 * Math.floor(base.width / 2));
  const height = Math.max(2, 2 * Math.floor(base.height / 2));
  const withAudio = clips.some((clip) => clip.hasAudio);
  if (withAudio && clips.some((clip) => !clip.hasAudio && !clip.duration)) {
    throw new Error(localizedError('native.error.76ed3ab41a', {}, '无法读取媒体信息'));
  }
  const filter = buildConcatFilter(width, height, base.fps, clips, withAudio);
  const command = ['-hide_banner', '-loglevel', 'error', '-y'];
  for (const path of sources) command.push('-i', path);
  command.push('-filter_complex', filter, '-map', '[outv]');
  if (withAudio) command.push('-map', '[outa]', '-c:a', 'aac', '-b:a', '192k');
  else command.push('-an');
  command.push(
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', target,
  );
  const result = await captureMediaProcess(ffmpeg, command)
    .catch(mediaProcessFailure('native.error.131cdf7e45', '无法启动视频拼接'));
  if (!result.ok || !isFile(target)) {
    await rm(target, { force: true }).catch(() => undefined);
    throw outputDetailError(result.stderr, 'native.error.3b5e1c5d77', '视频拼接失败');
  }
  return {
    ...await fileResult(target),
    engine: 'rust-ffmpeg-concat',
    audioDropped: false,
    sourceCount: clips.length,
    width,
    height,
  };
});

// ---------------------------------------------------------------------------
// 长时任务取消（media_tasks.rs 的 Tauri State）
// ---------------------------------------------------------------------------

defineCommand('media_task_cancel', args => cancelMediaTask(String(args.requestId ?? '')));

// ---------------------------------------------------------------------------
// 图片预览 / 裁剪 / 彩铅（image.rs）
// ---------------------------------------------------------------------------

const PREVIEW_CACHE_MAX_BYTES = 512 * 1024 * 1024;
const PREVIEW_CACHE_TARGET_BYTES = 384 * 1024 * 1024;

/** 预览缓存按“路径 + 大小 + mtime + 尺寸 + 格式版本”命名，Tauri 版本写过的缓存可以直接复用。 */
function previewDigest(source: string, size: bigint, mtimeNanos: bigint, maxSize: number): string {
  const digest = createHash('sha256');
  digest.update('jpeg-preview-v3');
  digest.update(Buffer.from(source, 'utf8'));
  const lengthBytes = Buffer.alloc(8);
  lengthBytes.writeBigUInt64LE(size > 0n ? size : 0n);
  digest.update(lengthBytes);
  const nanos = mtimeNanos > 0n ? mtimeNanos : 0n;
  const nanosBytes = Buffer.alloc(16);
  nanosBytes.writeBigUInt64LE(nanos & 0xffff_ffff_ffff_ffffn, 0);
  nanosBytes.writeBigUInt64LE(nanos >> 64n, 8);
  digest.update(nanosBytes);
  const sizeBytes = Buffer.alloc(4);
  sizeBytes.writeUInt32LE(maxSize);
  digest.update(sizeBytes);
  return digest.digest('hex');
}

async function trimPreviewCache(directory: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  const files: { path: string; size: number; modified: number }[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(directory, entry.name);
    try {
      const metadata = await stat(path);
      files.push({ path, size: metadata.size, modified: metadata.mtimeMs });
    } catch {
      // 并发删除的缓存文件不需要参与统计。
    }
  }
  let total = files.reduce((sum, file) => sum + file.size, 0);
  if (total <= PREVIEW_CACHE_MAX_BYTES) return;
  files.sort((left, right) => left.modified - right.modified);
  for (const file of files) {
    if (total <= PREVIEW_CACHE_TARGET_BYTES) break;
    try {
      await rm(file.path);
      total -= file.size;
    } catch {
      // 正在被读取的缓存删不掉时，让它留到下一轮清理。
    }
  }
}

async function renderImagePreview(source: string, maxSize: number): Promise<Buffer> {
  let size;
  try {
    size = await probeImageSize(source);
  } catch (error) {
    throw detailError('native.error.5d148f2098', '无法生成图片预览', errorMessage(error));
  }
  const orientation = await readExifOrientation(source);
  const display = orientedImageSize(size.width, size.height, orientation);
  const target = thumbnailSize(display.width, display.height, maxSize);
  const filters = [
    ...imageOrientationFilters(orientation),
    `scale=${target.width}:${target.height}:flags=bilinear`,
    'format=rgba',
  ].join(',');
  const ffmpeg = await resolveMediaTool('ffmpeg');
  const result = await captureMediaProcess(ffmpeg, [
    '-noautorotate', '-v', 'error', '-y', '-i', source,
    // 缩略图铺在浅灰底上：透明 PNG 的孔隙需要和 Rust 一样看到背景色而不是黑色。
    '-f', 'lavfi', '-i', `color=c=0xf8fafc:s=${target.width}x${target.height}`,
    '-filter_complex',
    `[0:v]${filters}[fg];[1:v]format=rgba[bg];[bg][fg]overlay=format=auto,format=rgb24[out]`,
    '-map', '[out]', '-frames:v', '1', '-c:v', 'mjpeg', '-q:v', '2', '-f', 'image2pipe', 'pipe:1',
  ]).catch(mediaProcessFailure('native.error.5d148f2098', '无法生成图片预览'));
  if (!result.ok || result.stdout.length === 0) {
    throw detailError('native.error.5d148f2098', '无法生成图片预览', result.stderr.trim() || 'ffmpeg');
  }
  return result.stdout;
}

async function readImagePreview(path: string, maxSizeArgument: unknown): Promise<string> {
  // Rust 这里直接返回 fs 错误原文（没有本地化信封），只有“不是普通文件”才用产品文案。
  const metadata = await stat(path, { bigint: true });
  if (!metadata.isFile()) {
    throw new Error(localizedError('native.error.831f99f5e4', {}, '图片文件不存在'));
  }
  const requested = Number(maxSizeArgument);
  const maxSize = Number.isFinite(requested) ? Math.min(2048, Math.max(128, Math.trunc(requested))) : 128;
  const cacheDirectory = join(appDataDir(), 'preview-cache');
  await mkdir(cacheDirectory, { recursive: true });
  const cachePath = join(
    cacheDirectory,
    `${previewDigest(path, metadata.size, metadata.mtimeNs, maxSize)}.jpg`,
  );
  if (existsSync(cachePath)) return (await readFile(cachePath)).toString('base64');
  const bytes = await renderImagePreview(path, maxSize);
  await writeFile(cachePath, bytes);
  await trimPreviewCache(cacheDirectory);
  return bytes.toString('base64');
}

defineCommand('file_read_image_preview', args => readImagePreview(String(args.path ?? ''), args.maxSize));

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function readCropRect(value: unknown): CropRect | null {
  if (!isRecord(value)) return null;
  const { x, y, width, height } = value;
  if (typeof x !== 'number' || typeof y !== 'number'
    || typeof width !== 'number' || typeof height !== 'number') return null;
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

/** 解码阶段的失败要区分“读不到文件”和“格式解不开”，这样错误键与 Rust 的 a/b 两路一致。 */
async function imageFailureError(
  source: string,
  error: unknown,
  read: [string, string],
  decode: [string, string],
): Promise<Error> {
  const detail = errorMessage(error);
  try {
    await access(source, constants.R_OK);
  } catch {
    return new Error(localizedError(read[0], { error: detail }, `${read[1]}：${detail}`));
  }
  return new Error(localizedError(decode[0], { error: detail }, `${decode[1]}：${detail}`));
}

function clampCropFraction(value: number): number {
  return Math.min(1, Math.max(0, value));
}

defineCommand('file_crop_image', async args => {
  const crop = readCropRect(args.crop);
  if (!crop) throw new Error(localizedError('native.error.963db3e86a', {}, '裁剪区域无效'));
  const source = String(args.source ?? '');
  const target = String(args.target ?? '');
  if (!isFile(source)) throw new Error(localizedError('native.error.321c8573e0', {}, '要裁剪的图片不存在'));
  const orientation = await readExifOrientation(source);
  let size;
  try {
    size = await probeImageSize(source);
  } catch (error) {
    throw await imageFailureError(
      source, error,
      ['native.error.8452e64e51', '无法读取图片'],
      ['native.error.5a99a66f07', '无法解码图片'],
    );
  }
  const display = orientedImageSize(size.width, size.height, orientation);
  if (display.width === 0 || display.height === 0) {
    throw new Error(localizedError('native.error.c0b5a9135f', {}, '图片尺寸无效'));
  }
  // 相邻格子共享边界时必须落在同一像素，所以先 clamp 再四舍五入。
  const x = Math.round(clampCropFraction(crop.x) * display.width);
  const y = Math.round(clampCropFraction(crop.y) * display.height);
  const right = Math.round(clampCropFraction(crop.x + crop.width) * display.width);
  const bottom = Math.round(clampCropFraction(crop.y + crop.height) * display.height);
  if (right <= x || bottom <= y) {
    throw new Error(localizedError('native.error.13edd0058b', {}, '裁剪区域小于一个像素'));
  }
  const width = right - x;
  const height = bottom - y;
  try {
    await mkdir(dirname(target), { recursive: true });
  } catch (error) {
    throw new Error(errorMessage(error));
  }
  let decoded;
  try {
    decoded = await decodeImageRgba(
      source,
      [...imageOrientationFilters(orientation), `crop=${width}:${height}:${x}:${y}`],
      width,
      height,
    );
  } catch (error) {
    throw await imageFailureError(
      source, error,
      ['native.error.8452e64e51', '无法读取图片'],
      ['native.error.5a99a66f07', '无法解码图片'],
    );
  }
  const png = await encodeRgbaPng(width, height, decoded)
    .catch(error => { throw detailError('native.error.a9801e5f5b', '无法保存裁剪图片', errorMessage(error)); });
  await writeFile(target, png);
  return fileResult(target);
});

function gaussianKernelSize(sigma: number): number {
  // image crate 的 kernel_size_from_sigma：按标准差推出奇数核，再四舍五入到最近的奇数。
  const possible = Math.max(3, Math.trunc((((sigma - 0.8) / 0.3) + 1) * 2 + 1));
  if (possible % 2 !== 0) return possible;
  const lower = possible - 1;
  const upper = possible + 1;
  return Math.abs(possible - lower) <= Math.abs(possible - upper) ? lower : upper;
}

function gaussianKernel(size: number, sigma: number): Float32Array {
  const kernel = new Float32Array(size);
  const mean = Math.floor(size / 2);
  const scale = 1 / (Math.sqrt(2 * Math.PI) * sigma);
  let sum = 0;
  for (let index = 0; index < size; index += 1) {
    const weight = Math.exp(-0.5 * ((index - mean) / sigma) ** 2) * scale;
    kernel[index] = weight;
    sum += weight;
  }
  if (sum !== 0) {
    for (let index = 0; index < size; index += 1) kernel[index] /= sum;
  }
  return kernel;
}

/** 与 imageops::blur 同样的可分离高斯模糊与 clamp 边界；只处理 RGB，alpha 原样保留。 */
function blurRgb(source: Uint8Array, width: number, height: number, sigma: number): Uint8Array {
  const size = gaussianKernelSize(sigma);
  const kernel = gaussianKernel(size, sigma);
  const radius = Math.floor(size / 2);
  const horizontal = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let index = 0; index < size; index += 1) {
        const sampleX = Math.min(width - 1, Math.max(0, x + index - radius));
        const offset = (y * width + sampleX) * 4;
        const weight = kernel[index];
        red += source[offset] * weight;
        green += source[offset + 1] * weight;
        blue += source[offset + 2] * weight;
      }
      const out = (y * width + x) * 3;
      horizontal[out] = red;
      horizontal[out + 1] = green;
      horizontal[out + 2] = blue;
    }
  }
  const output = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let index = 0; index < size; index += 1) {
        const sampleY = Math.min(height - 1, Math.max(0, y + index - radius));
        const offset = (sampleY * width + x) * 3;
        const weight = kernel[index];
        red += horizontal[offset] * weight;
        green += horizontal[offset + 1] * weight;
        blue += horizontal[offset + 2] * weight;
      }
      const out = (y * width + x) * 4;
      output[out] = roundedByte(red);
      output[out + 1] = roundedByte(green);
      output[out + 2] = roundedByte(blue);
      output[out + 3] = source[out + 3];
    }
  }
  return output;
}

function blurGray(source: Uint8Array, width: number, height: number, sigma: number): Uint8Array {
  const size = gaussianKernelSize(sigma);
  const kernel = gaussianKernel(size, sigma);
  const radius = Math.floor(size / 2);
  const horizontal = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 0;
      for (let index = 0; index < size; index += 1) {
        const sampleX = Math.min(width - 1, Math.max(0, x + index - radius));
        value += source[y * width + sampleX] * kernel[index];
      }
      horizontal[y * width + x] = value;
    }
  }
  const output = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 0;
      for (let index = 0; index < size; index += 1) {
        const sampleY = Math.min(height - 1, Math.max(0, y + index - radius));
        value += horizontal[sampleY * width + x] * kernel[index];
      }
      output[y * width + x] = roundedByte(value);
    }
  }
  return output;
}

/** Rust 的 `f as u8`：饱和到 0–255 再向零截断。 */
function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.trunc(value)));
}

/** 高斯模糊的输出是 f32→u8 的就近取整，和滤镜里的截断不是同一种转换。 */
function roundedByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * 彩铅滤镜：与 Rust 的 colored_pencil_filter 同一套逐步像素运算，
 * 只有高斯模糊用等价的采样实现代替 image crate 的内部过滤器。
 */
function coloredPencilFilter(width: number, height: number, source: Uint8Array): Uint8Array {
  if (width === 0 || height === 0) return Uint8Array.from(source);
  const smoothed = blurRgb(source, width, height, 0.65);
  const toneSigma = clampNumber(Math.min(width, height) / 520, 1.6, 3.8);
  const toneSmoothed = blurRgb(source, width, height, toneSigma);
  const sketchSigma = clampNumber(Math.min(width, height) / 420, 1.8, 5);
  const length = width * height;
  const luminance = new Float32Array(length);
  const inverted = new Uint8Array(length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const offset = index * 4;
      const value = 0.299 * smoothed[offset] + 0.587 * smoothed[offset + 1] + 0.114 * smoothed[offset + 2];
      luminance[index] = value;
      inverted[index] = clampByte(255 - value);
    }
  }
  const sketchBlur = blurGray(inverted, width, height, sketchSigma);
  const edges = new Float32Array(length);
  if (width > 2 && height > 2) {
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const sample = (offsetX: number, offsetY: number): number =>
          luminance[(y + offsetY) * width + (x + offsetX)];
        const gradientX = -sample(-1, -1) + sample(1, -1)
          - 2 * sample(-1, 0) + 2 * sample(1, 0)
          - sample(-1, 1) + sample(1, 1);
        const gradientY = -sample(-1, -1) - 2 * sample(0, -1) - sample(1, -1)
          + sample(-1, 1) + 2 * sample(0, 1) + sample(1, 1);
        edges[y * width + x] = Math.sqrt(gradientX * gradientX + gradientY * gradientY);
      }
    }
  }

  const output = new Uint8Array(length * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const offset = index * 4;
      const baseLuminance = luminance[index];
      const blurredInverse = sketchBlur[index];
      const sketch = clampNumber(baseLuminance * 255 / Math.max(256 - blurredInverse, 1), 0, 255);
      const edge = Math.min(edges[index] * 0.1, 48);
      let hash = (Math.imul(x, 0x9e37_79b9) ^ Math.imul(y, 0x85eb_ca6b)) >>> 0;
      hash = (hash ^ (hash >>> 16)) >>> 0;
      hash = Math.imul(hash, 0x7feb_352d) >>> 0;
      hash = (hash ^ (hash >>> 15)) >>> 0;
      const fineGrain = ((hash & 255) / 255 - 0.5) * 3.2;
      let coarseHash = (Math.imul(Math.floor(x / 3), 0x27d4_eb2d)
        ^ Math.imul(Math.floor(y / 3), 0x1656_67b1)) >>> 0;
      coarseHash = (coarseHash ^ (coarseHash >>> 15)) >>> 0;
      const coarseGrain = ((coarseHash & 255) / 255 - 0.5) * 2.2;
      const grain = fineGrain + coarseGrain;
      const darkness = 1 - baseLuminance / 255;
      const toneLuminance = 0.299 * toneSmoothed[offset]
        + 0.587 * toneSmoothed[offset + 1] + 0.114 * toneSmoothed[offset + 2];
      const localDetail = Math.min(Math.abs(baseLuminance - toneLuminance) / 22, 1);
      const darkDetail = Math.min(Math.max(toneLuminance - baseLuminance, 0), 32);
      const strokePressure = 0.1
        + darkness ** 1.08 * (0.5 + 0.5 * Math.max(edge / 48, localDetail));
      const jitter = (hash >>> 8) & 3;
      const alternateDirection = (Math.floor(x / 56) + Math.floor(y / 56)) % 2 === 1;
      const slanted = x * 2 + height - (y % height) + jitter;
      const primaryIndex = alternateDirection ? slanted % 11 : (x + y * 2 + jitter) % 11;
      const crossIndex = alternateDirection ? (x + y * 2 + jitter) % 17 : slanted % 17;
      const primaryHatch = primaryIndex === 0 ? 28 * strokePressure : primaryIndex === 1 ? 12 * strokePressure : 0;
      const crossHatch = darkness > 0.36
        ? (crossIndex === 0 ? 20 * strokePressure : crossIndex === 1 ? 8 * strokePressure : 0)
        : 0;
      const hatch = primaryHatch + crossHatch;
      for (let channel = 0; channel < 3; channel += 1) {
        const detail = source[offset + channel] - smoothed[offset + channel];
        const detailed = smoothed[offset + channel] + detail * 0.55;
        const colored = baseLuminance + (detailed - baseLuminance) * 3;
        const paperLift = 255 - (255 - colored) * 0.68;
        const sketchFactor = 0.58 + 0.42 * (sketch / 255);
        const pencil = clampNumber(
          paperLift * sketchFactor - edge * 0.65 - darkDetail * 0.9 - hatch + grain,
          0, 255,
        );
        const effectMix = 0.78;
        const blended = source[offset + channel] * (1 - effectMix) + pencil * effectMix;
        const contrasted = 140 + (blended - 140) * 1.22;
        const paperTint = channel === 0 ? 1 : channel === 2 ? -1 : 0;
        output[offset + channel] = clampByte(contrasted + paperTint);
      }
      output[offset + 3] = source[offset + 3];
    }
  }
  return output;
}

defineCommand('file_apply_colored_pencil', async args => {
  const source = String(args.source ?? '');
  const target = String(args.target ?? '');
  if (!isFile(source)) {
    throw new Error(localizedError('native.error.47b4239aa3', {}, '彩铅处理的原图文件不存在'));
  }
  try {
    await mkdir(dirname(target), { recursive: true });
  } catch (error) {
    throw new Error(errorMessage(error));
  }
  const orientation = await readExifOrientation(source);
  let size;
  try {
    size = await probeImageSize(source);
  } catch (error) {
    throw await imageFailureError(
      source, error,
      ['native.error.6c57cdcf0e', '无法读取彩铅处理原图'],
      ['native.error.28e1b58cb3', '无法解码彩铅处理原图'],
    );
  }
  const display = orientedImageSize(size.width, size.height, orientation);
  let decoded;
  try {
    decoded = await decodeImageRgba(
      source,
      imageOrientationFilters(orientation),
      display.width,
      display.height,
    );
  } catch (error) {
    throw await imageFailureError(
      source, error,
      ['native.error.6c57cdcf0e', '无法读取彩铅处理原图'],
      ['native.error.28e1b58cb3', '无法解码彩铅处理原图'],
    );
  }
  const processed = coloredPencilFilter(display.width, display.height, decoded);
  const png = await encodeRgbaPng(display.width, display.height, processed)
    .catch(error => { throw detailError('native.error.08f1bbaf68', '无法保存彩铅图片', errorMessage(error)); });
  await writeFile(target, png);
  return fileResult(target);
});

// ---------------------------------------------------------------------------
// 资源包导入 / 导出（file.rs）
// ---------------------------------------------------------------------------

/**
 * 导出资源包：manifest.json + files/ 下的素材，ZIP 采用 Stored 不压缩。
 * 越界或缺失的源文件按 Rust 行为跳过，不让单个素材毁掉整次导出。
 */
async function exportResourcePackage(target: string, manifest: unknown, files: unknown): Promise<Json> {
  try {
    await mkdir(dirname(target), { recursive: true });
  } catch (error) {
    throw new Error(errorMessage(error));
  }
  const entries: Zippable = {};
  entries['manifest.json'] = [
    Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
    { level: 0 },
  ];
  let count = 0;
  for (const item of Array.isArray(files) ? files : []) {
    if (!isRecord(item)) continue;
    const source = String(item.source ?? '');
    if (!isFile(source)) continue;
    const archiveName = String(item.archiveName ?? '').replace(/\\/g, '/');
    if (!archiveName.startsWith('files/') || archiveName.includes('../')) continue;
    entries[archiveName] = [await readFile(source), { level: 0 }];
    count += 1;
  }
  await writeFile(target, zipSync(entries));
  return { ok: true, count, filePath: target, direct: true };
}

/**
 * 导入资源包：先校验清单里的路径与体积，再按 material.name 落到目标目录。
 * 只解压清单点名的文件，压缩包里的其它条目（包括路径穿越名）不会落盘。
 */
async function importResourcePackage(source: string, targetDirectory: string): Promise<unknown> {
  const bytes = await readFile(source);
  let archive;
  try {
    archive = unzipSync(bytes);
  } catch (error) {
    throw detailError('native.error.b515037bdd', '资源包格式无效', errorMessage(error));
  }
  const manifestBytes = archive['manifest.json'];
  if (!manifestBytes) {
    throw new Error(localizedError('native.error.9978a52164', {}, '资源包缺少 manifest.json'));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(manifestBytes).toString('utf8'));
  } catch (error) {
    throw new Error(errorMessage(error));
  }
  const root = isRecord(parsed) ? parsed : null;
  await mkdir(targetDirectory, { recursive: true });
  const materials = root && Array.isArray(root.materials) ? root.materials : [];
  const packagePaths: string[] = [];
  for (const material of materials) {
    if (!isRecord(material)) continue;
    if (typeof material.packagePath === 'string') packagePaths.push(material.packagePath);
  }
  if (packagePaths.length !== materials.length) {
    throw new Error(localizedError('native.error.b0ae636d4a', {}, '资源包素材记录缺少 packagePath'));
  }
  if (packagePaths.length > 10_000) {
    throw new Error(localizedError('native.error.50e19e1802', {}, '资源包文件数超过上限'));
  }
  let totalSize = 0;
  for (const packagePath of packagePaths) {
    if (!packagePath.startsWith('files/') || packagePath.includes('../')) {
      throw new Error(localizedError(
        'native.error.131621dc50',
        { package_path: packagePath },
        `资源包文件路径无效：${packagePath}`,
      ));
    }
    const zipped = archive[packagePath];
    if (!zipped) {
      throw new Error(localizedError(
        'native.error.63ac646633',
        { package_path: packagePath },
        `资源包缺少文件：${packagePath}`,
      ));
    }
    totalSize += zipped.length;
  }
  if (totalSize > 20 * 1024 * 1024 * 1024) {
    throw new Error(localizedError('native.error.dd32ec29b4', {}, '资源包解压后体积超过 20GB 上限'));
  }
  for (const material of materials) {
    if (!isRecord(material)) continue;
    const packagePath = typeof material.packagePath === 'string' ? material.packagePath : '';
    if (!packagePath.startsWith('files/') || packagePath.includes('../')) continue;
    const preferred = typeof material.name === 'string' ? material.name : 'resource.bin';
    const zipped = archive[packagePath];
    if (!zipped) {
      throw new Error(localizedError(
        'native.error.63ac646633',
        { package_path: packagePath },
        `资源包缺少文件：${packagePath}`,
      ));
    }
    const target = uniqueFilePath(targetDirectory, preferred);
    await writeFile(target, zipped);
    material.path = target;
    material.filePath = target;
    material.storageScope = 'project';
  }
  return parsed;
}

defineCommand('file_export_resource_package', (args) =>
  exportResourcePackage(String(args.target ?? ''), args.manifest, args.files));

defineCommand('file_import_resource_package', (args) =>
  importResourcePackage(String(args.source ?? ''), String(args.targetDirectory ?? '')));
