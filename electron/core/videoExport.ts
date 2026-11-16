import { access, copyFile, mkdir, open, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { errorMessage, localizedError } from './errors';
import { fileResult, type FileResult } from './files';
import {
  captureMediaProcess,
  resolveMediaTool,
  runFfmpeg,
  type MediaTaskFlag,
} from './media';

/**
 * 多轨剪辑导出（对应 src-tauri/src/commands/video_export.rs）。
 *
 * 产品边界：
 * - 渲染进程负责把 data URL 素材先落盘，这里只接受真实文件路径；
 * - 导出先写 `.shotloom-project-export-<时间戳>.mp4`，成功后才替换目标文件，
 *   失败/取消不会在目标路径留下半成品；
 * - 轨道数量、时长、画布尺寸等属于工程可导出性的硬边界，超限直接返回本地化错误；
 * - 取消沿用 media_tasks 的 requestId 登记（与媒体命令共用一份，渲染进程仍调 media_task_cancel）；
 * - Rust 版导出命令不发送任何进度事件，这里同样不广播事件，调用方以 Promise 完成/失败观察结果。
 */

// ---------------------------------------------------------------------------
// 工程数据形状（serde camelCase + #[serde(default)] 的等价解析）
// ---------------------------------------------------------------------------

export interface VideoEditorProjectSettings {
  width: number;
  height: number;
  fps: number;
  backgroundColor: string;
}

export interface VideoEditorAsset {
  id: string;
  type: string;
  sourceFile: string;
  sourceUrl: string;
  duration: number;
}

export interface VideoEditorTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  opacity: number;
  fit: string;
}

export interface VideoEditorTextStyle {
  fontSize: number;
  color: string;
}

export interface VideoEditorClip {
  id: string;
  type: string;
  assetId: string;
  timelineStart: number;
  trimStart: number;
  trimEnd: number;
  speed: number;
  duration: number;
  muted: boolean;
  volume: number;
  text: string;
  transform: VideoEditorTransform;
  style: VideoEditorTextStyle;
  effectKey: string;
  transitionKey: string;
  fromClipId?: string;
  toClipId?: string;
}

export interface VideoEditorTrack {
  type: string;
  hidden: boolean;
  muted: boolean;
  clips: VideoEditorClip[];
}

export interface VideoEditorProject {
  settings: VideoEditorProjectSettings;
  assets: VideoEditorAsset[];
  tracks: VideoEditorTrack[];
}

export interface VideoExportReceipt extends FileResult {
  duration: number;
  trackCount: number;
  assetCount: number;
  engine: string;
  transitionCount?: number;
  transitionTypes?: string[];
}

const DEFAULT_BACKGROUND = '#050608';
const DEFAULT_TEXT_COLOR = '#ffffff';
const DEFAULT_TEXT_SIZE = 72;
const EXPORT_ENGINE = 'rust-ffmpeg-v2';
const DIRECT_COPY_ENGINE = 'direct-mp4-copy';

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function optionalString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function optionalNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  return typeof value === 'number' ? value : Number(value);
}

function optionalBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`剪辑工程缺少字符串字段：${field}`);
  return value;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== 'number') throw new Error(`剪辑工程缺少数值字段：${field}`);
  return value;
}

function parseTransform(value: unknown): VideoEditorTransform {
  const source = recordValue(value) ?? {};
  return {
    x: optionalNumber(source.x, 0),
    y: optionalNumber(source.y, 0),
    width: optionalNumber(source.width, 0),
    height: optionalNumber(source.height, 0),
    angle: optionalNumber(source.angle, 0),
    opacity: optionalNumber(source.opacity, 1),
    fit: optionalString(source.fit, 'fit'),
  };
}

function parseTextStyle(value: unknown): VideoEditorTextStyle {
  const source = recordValue(value) ?? {};
  return {
    fontSize: optionalNumber(source.fontSize, DEFAULT_TEXT_SIZE),
    color: optionalString(source.color, DEFAULT_TEXT_COLOR),
  };
}

function parseClip(value: unknown): VideoEditorClip {
  const source = recordValue(value);
  if (!source) throw new Error('剪辑工程片段数据无效');
  const fromClipId = typeof source.fromClipId === 'string' ? source.fromClipId : undefined;
  const toClipId = typeof source.toClipId === 'string' ? source.toClipId : undefined;
  return {
    id: requiredString(source.id, 'clip.id'),
    type: requiredString(source.type, 'clip.type'),
    assetId: optionalString(source.assetId, ''),
    timelineStart: optionalNumber(source.timelineStart, 0),
    trimStart: optionalNumber(source.trimStart, 0),
    trimEnd: optionalNumber(source.trimEnd, 0),
    speed: optionalNumber(source.speed, 1),
    duration: optionalNumber(source.duration, 0),
    muted: optionalBoolean(source.muted, false),
    volume: optionalNumber(source.volume, 1),
    text: optionalString(source.text, ''),
    transform: parseTransform(source.transform),
    style: parseTextStyle(source.style),
    effectKey: optionalString(source.effectKey, ''),
    transitionKey: optionalString(source.transitionKey, ''),
    ...(fromClipId === undefined ? {} : { fromClipId }),
    ...(toClipId === undefined ? {} : { toClipId }),
  };
}

function parseTrack(value: unknown): VideoEditorTrack {
  const source = recordValue(value);
  if (!source) throw new Error('剪辑工程轨道数据无效');
  return {
    type: requiredString(source.type, 'track.type'),
    hidden: optionalBoolean(source.hidden, false),
    muted: optionalBoolean(source.muted, false),
    clips: arrayValue(source.clips).map(parseClip),
  };
}

function parseAsset(value: unknown): VideoEditorAsset {
  const source = recordValue(value);
  if (!source) throw new Error('剪辑工程素材数据无效');
  return {
    id: requiredString(source.id, 'asset.id'),
    type: requiredString(source.type, 'asset.type'),
    sourceFile: optionalString(source.sourceFile, ''),
    sourceUrl: optionalString(source.sourceUrl, ''),
    duration: optionalNumber(source.duration, 0),
  };
}

/** IPC 入参 `project` 只在命令层解析一次；缺失 settings 与 Rust serde 一样视为无效工程。 */
export function parseVideoEditorProject(value: unknown): VideoEditorProject {
  const source = recordValue(value);
  if (!source) throw new Error('剪辑工程数据无效：project 必须是对象');
  const settings = recordValue(source.settings);
  if (!settings) throw new Error('剪辑工程数据无效：缺少 settings');
  return {
    settings: {
      width: requiredNumber(settings.width, 'settings.width'),
      height: requiredNumber(settings.height, 'settings.height'),
      fps: requiredNumber(settings.fps, 'settings.fps'),
      backgroundColor: optionalString(settings.backgroundColor, DEFAULT_BACKGROUND),
    },
    assets: arrayValue(source.assets).map(parseAsset),
    tracks: arrayValue(source.tracks).map(parseTrack),
  };
}

// ---------------------------------------------------------------------------
// 时间线语义（与 Rust 的 editor_clip_speed / editor_clip_duration 完全一致）
// ---------------------------------------------------------------------------

/** 时间线长度与 FFmpeg 变速必须取同一个速度值：0.5–2 是产品允许的速度范围。 */
function editorClipSpeed(clip: VideoEditorClip): number {
  return Math.min(2, Math.max(0.5, clip.speed));
}

function editorClipDuration(clip: VideoEditorClip): number {
  if (clip.type === 'video' || clip.type === 'audio') {
    return Math.max(clip.trimEnd - clip.trimStart, 0) / editorClipSpeed(clip);
  }
  return Math.max(clip.duration, 0);
}

function videoEditorDuration(project: VideoEditorProject): number {
  let duration = 0;
  for (const track of project.tracks) {
    if (track.hidden) continue;
    for (const clip of track.clips) {
      duration = Math.max(duration, clip.timelineStart + editorClipDuration(clip));
    }
  }
  return duration;
}

function visibleClips(project: VideoEditorProject): { track: VideoEditorTrack; clip: VideoEditorClip }[] {
  const clips: { track: VideoEditorTrack; clip: VideoEditorClip }[] = [];
  for (const track of project.tracks) {
    if (track.hidden) continue;
    for (const clip of track.clips) clips.push({ track, clip });
  }
  return clips;
}

function validateVideoEditorProject(project: VideoEditorProject): void {
  const { width, height, fps } = project.settings;
  if (width < 16 || height < 16 || width > 8192 || height > 8192) {
    throw new Error(localizedError('native.error.b2f045ec8d', {}, '剪辑工程画布尺寸必须在 16 到 8192 像素之间'));
  }
  if (!Number.isFinite(fps) || fps < 1 || fps > 120) {
    throw new Error(localizedError('native.error.8361d921ae', {}, '剪辑工程帧率必须在 1 到 120 FPS 之间'));
  }
  const duration = videoEditorDuration(project);
  if (!Number.isFinite(duration) || duration < 0.04 || duration > 86_400) {
    throw new Error(localizedError('native.error.0dbe5c75b7', {}, '剪辑工程时长无效或超过 24 小时'));
  }
  const clipCount = project.tracks.reduce((total, track) => total + track.clips.length, 0);
  if (clipCount === 0 || clipCount > 2_000) {
    throw new Error(localizedError('native.error.8c4ebf9ef0', {}, '剪辑工程片段数量必须在 1 到 2000 之间'));
  }
  for (const track of project.tracks) {
    if (!['video', 'audio', 'text', 'overlay', 'effect', 'transition'].includes(track.type)) {
      throw new Error(localizedError('native.error.23733fdfc9', { type: track.type }, `不支持的剪辑轨道类型：${track.type}`));
    }
    for (const clip of track.clips) {
      if (!Number.isFinite(clip.timelineStart) || clip.timelineStart < 0 || editorClipDuration(clip) < 0.04) {
        throw new Error(localizedError('native.error.94bb7de088', { id: clip.id }, `剪辑片段时间无效：${clip.id}`));
      }
    }
  }
  for (const asset of project.assets) {
    if (!Number.isFinite(asset.duration) || asset.duration < 0) {
      throw new Error(localizedError('native.error.e921dee5e7', { id: asset.id }, `剪辑素材时长无效：${asset.id}`));
    }
  }
}

// ---------------------------------------------------------------------------
// 素材与颜色
// ---------------------------------------------------------------------------

/** 素材路径优先 sourceFile；sourceUrl 只有在这条命令里才允许是本地路径（data URL 已在渲染层落盘）。 */
async function localEditorAsset(asset: VideoEditorAsset): Promise<string> {
  const candidate = asset.sourceFile.trim() ? asset.sourceFile : asset.sourceUrl;
  try {
    const metadata = await stat(candidate);
    if (metadata.isFile()) return candidate;
  } catch {
    // 落到统一的本地化错误。
  }
  throw new Error(localizedError(
    'native.error.34d30a8aea',
    { id: asset.id, path: candidate },
    `剪辑素材尚未落盘或文件不存在：${asset.id}（${candidate}）`,
  ));
}

function filterColor(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return `0x${trimmed.slice(1)}`;
  return fallback;
}

/** text_rgba 的可观测结果：只接受 #RRGGBB，其余回落为白色。 */
function textColor(value: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.slice(1).toLowerCase();
  return 'ffffff';
}

/** 片段框与素材比例不一致时的缩放语义：fit 留边（透明补边），fill 居中裁剪填满。 */
function visualScaleFilter(width: number, height: number, fit: string): string {
  if (fit === 'fill') {
    return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
  }
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0`;
}

// ---------------------------------------------------------------------------
// FFmpeg 解析（优先复用 core/media.ts；文本字幕需要 drawtext）
// ---------------------------------------------------------------------------

const drawtextSupport = new Map<string, boolean>();

async function toolHasDrawtext(executable: string): Promise<boolean> {
  const cached = drawtextSupport.get(executable);
  if (cached !== undefined) return cached;
  try {
    const result = await captureMediaProcess(executable, ['-hide_banner', '-filters']);
    const supported = /\bdrawtext\b/.test(result.stdout.toString('utf8'));
    drawtextSupport.set(executable, supported);
    return supported;
  } catch {
    drawtextSupport.set(executable, false);
    return false;
  }
}

/**
 * 开发期 Electron 不在打包后的 resources 布局里，core/media.ts 会落到 Homebrew 的
 * ffmpeg（本机这份没有 drawtext）。Rust 开发版用的是随应用分发的 sidecar，因此有字幕
 * 片段时再按同一份 sidecar 兜底；打包后 resolveMediaTool 已能命中 Contents/Resources/ffmpeg。
 * TODO(media): core/media.ts 的候选顺序补上开发期的 electron/resources 后即可删掉这里。
 */
function drawtextFallbackCandidates(): string[] {
  const root = process.cwd();
  const executable = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const triple = process.platform === 'darwin'
    ? (process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin')
    : process.platform === 'win32' ? 'x86_64-pc-windows-msvc' : 'x86_64-unknown-linux-gnu';
  const sidecar = process.platform === 'win32' ? `ffmpeg-${triple}.exe` : `ffmpeg-${triple}`;
  return [
    join(root, 'electron', 'resources', executable),
    join(root, 'src-tauri', 'binaries', sidecar),
    join(root, 'src-tauri', 'target', 'debug', executable),
  ];
}

async function resolveExportFfmpeg(needsDrawtext: boolean): Promise<string> {
  const resolved = await resolveMediaTool('ffmpeg');
  if (!needsDrawtext || await toolHasDrawtext(resolved)) return resolved;
  for (const candidate of drawtextFallbackCandidates()) {
    if (candidate === resolved) continue;
    try {
      const metadata = await stat(candidate);
      if (!metadata.isFile()) continue;
    } catch {
      continue;
    }
    if (await toolHasDrawtext(candidate)) return candidate;
  }
  // 都不可用时仍交给已解析的 ffmpeg 运行，让 FFmpeg 用自己的 stderr 报告缺滤镜，
  // 与 Rust 在滤镜不可用时的失败观察一致（本地化错误键 11a14518e7）。
  return resolved;
}

async function sourceHasAudio(ffmpeg: string, source: string, cache: Map<string, boolean>): Promise<boolean> {
  const cached = cache.get(source);
  if (cached !== undefined) return cached;
  let hasAudio = false;
  try {
    const result = await captureMediaProcess(ffmpeg, [
      '-v', 'error', '-i', source, '-map', '0:a:0', '-frames:a', '1', '-f', 'null', '-',
    ]);
    hasAudio = result.ok;
  } catch {
    hasAudio = false;
  }
  cache.set(source, hasAudio);
  return hasAudio;
}

// ---------------------------------------------------------------------------
// 字幕文本层
// ---------------------------------------------------------------------------

const FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/System/Library/Fonts/SFNS.ttf',
  '/System/Library/Fonts/Hiragino Sans GB.ttc',
  'C:\\Windows\\Fonts\\msyh.ttc',
  'C:\\Windows\\Fonts\\arial.ttf',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
];

/** ab_glyph 会跳过解析失败的字体；这里用文件头判断，避免把非字体文件交给 drawtext。 */
async function looksLikeFont(path: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(path, 'r');
    const header = Buffer.alloc(4);
    const { bytesRead } = await handle.read(header, 0, 4, 0);
    if (bytesRead < 4) return false;
    const tag = header.toString('latin1');
    return tag === 'OTTO' || tag === 'true' || tag === 'typ1' || tag === 'ttcf'
      || header.readUInt32BE(0) === 0x0001_0000;
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function editorFont(): Promise<string> {
  for (const candidate of FONT_CANDIDATES) {
    if (await looksLikeFont(candidate)) return candidate;
  }
  throw new Error(localizedError('native.error.8ce9bd145f', {}, '未找到可用于字幕导出的系统字体'));
}

/** FFmpeg 过滤器的两层转义：单引号包住路径，再把 `:` 转成一层转义（Windows 盘符）。 */
function filterPath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const escaped = normalized.replace(/'/g, "\\'").replace(/:/g, '\\:');
  return `'${escaped}'`;
}

function formatSeconds(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6) : '0.000000';
}

function formatPosition(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : '0.000';
}

function formatAlpha(value: number): string {
  return Math.min(1, Math.max(0, value)).toFixed(5);
}

/** Rust 用 ab_glyph 把文本预渲染成 PNG 再 overlay；Node 没有字体光栅化器，改用 drawtext，
 *  只把可见结果对齐（左上角 +4 像素、字号、颜色、透明度、时间窗），不做文字裁剪框。 */
function textDrawtextFilter(
  clip: VideoEditorClip,
  fontPath: string,
  textPath: string,
  canvasLabel: string,
  nextLabel: string,
): string {
  const fontSize = Math.min(600, Math.max(6, clip.style.fontSize));
  const alpha = formatAlpha(clip.transform.opacity);
  return `[${canvasLabel}]drawtext=fontfile=${filterPath(fontPath)}:textfile=${filterPath(textPath)}`
    + `:fontsize=${fontSize}:fontcolor=0x${textColor(clip.style.color)}@${alpha}`
    + `:x=${formatPosition(clip.transform.x + 4)}:y=${formatPosition(clip.transform.y + 4)}`
    + `:expansion=none:enable='between(t,${formatSeconds(clip.timelineStart)},${formatSeconds(clip.timelineStart + editorClipDuration(clip))})'`
    + `[${nextLabel}]`;
}

/** Rust 的 lines() 会去掉末尾换行并吸收 CR；textfile 也按同一份行文本写。 */
function normalizeClipText(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/\n$/, '');
}

// ---------------------------------------------------------------------------
// 输出替换
// ---------------------------------------------------------------------------

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Rust 的“先删目标再 rename”；两步失败分别对应两个本地化错误键。 */
async function replaceTarget(temp: string, target: string): Promise<void> {
  if (await pathExists(target)) {
    try {
      await unlink(target);
    } catch (error) {
      const detail = errorMessage(error);
      throw new Error(localizedError('native.error.74781c8f46', { error: detail }, `无法替换导出文件：${detail}`));
    }
  }
  try {
    await rename(temp, target);
  } catch (error) {
    const detail = errorMessage(error);
    throw new Error(localizedError('native.error.657c58fc0b', { error: detail }, `无法完成导出文件：${detail}`));
  }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

/**
 * 单片段、无裁剪/变速/变换的 MP4 直接复制。Rust 直接 copy 到目标，失败可能留下半成品；
 * 这里同样走临时文件再替换，保证“失败不在目标路径留文件”的边界。
 */
async function tryDirectCopy(
  target: string,
  parent: string,
  project: VideoEditorProject,
  referenced: { asset: VideoEditorAsset; path: string }[],
  duration: number,
): Promise<VideoExportReceipt | null> {
  const clips = visibleClips(project);
  if (clips.length !== 1) return null;
  const { track, clip } = clips[0];
  if (clip.type !== 'video' || track.muted || clip.muted) return null;
  const reference = referenced.find(item => item.asset.id === clip.assetId);
  if (!reference) return null;
  const sourceIsMp4 = extname(reference.path).toLowerCase() === '.mp4';
  const transform = clip.transform;
  const unchanged = Math.abs(clip.timelineStart) < 0.000_001
    && Math.abs(clip.trimStart) < 0.000_001
    && Math.abs(clip.trimEnd - reference.asset.duration) < 0.002
    && Math.abs(clip.speed - 1) < 0.000_001
    && Math.abs(transform.x) < 0.001
    && Math.abs(transform.y) < 0.001
    && Math.abs(transform.angle) < 0.001
    && Math.abs(transform.opacity - 1) < 0.001
    && Math.abs(transform.width - project.settings.width) < 0.5
    && Math.abs(transform.height - project.settings.height) < 0.5
    // fill 会裁剪画面，即使尺寸恰好等于画布也不能直接复制源文件。
    && transform.fit !== 'fill';
  if (!sourceIsMp4 || !unchanged) return null;

  if (reference.path !== target) {
    const temp = join(parent, `.shotloom-project-export-${Date.now()}.mp4`);
    try {
      try {
        await copyFile(reference.path, temp);
      } catch (error) {
        const detail = errorMessage(error);
        throw new Error(localizedError('native.error.134502001c', { error: detail }, `无法复制原视频：${detail}`));
      }
      await replaceTarget(temp, target);
    } finally {
      await unlink(temp).catch(() => undefined);
    }
  }
  const result = await fileResult(target);
  return {
    ...result,
    duration,
    trackCount: project.tracks.length,
    assetCount: project.assets.length,
    engine: DIRECT_COPY_ENGINE,
  };
}

export async function exportVideoEditorProject(
  target: string,
  project: VideoEditorProject,
  cancelled: MediaTaskFlag,
): Promise<VideoExportReceipt> {
  validateVideoEditorProject(project);
  if (!target) {
    throw new Error(localizedError('native.error.1a39aa5fae', {}, '导出路径无效'));
  }
  const parent = dirname(target);
  try {
    await mkdir(parent, { recursive: true });
  } catch (error) {
    const detail = errorMessage(error);
    throw new Error(localizedError('native.error.16c40348e2', { error: detail }, `无法创建导出目录：${detail}`));
  }
  if (extname(target).toLowerCase() !== '.mp4') {
    throw new Error(localizedError('native.error.51267563df', {}, '剪辑当前只支持导出 MP4'));
  }

  const duration = videoEditorDuration(project);

  // 只保留可见轨道上视频/音频/图片片段引用到的素材；同一素材只落一个输入。
  const referenced: { asset: VideoEditorAsset; path: string }[] = [];
  for (const track of project.tracks) {
    if (track.hidden) continue;
    for (const clip of track.clips) {
      if (!['video', 'audio', 'image'].includes(clip.type)) continue;
      if (referenced.some(item => item.asset.id === clip.assetId)) continue;
      const asset = project.assets.find(item => item.id === clip.assetId);
      if (!asset) {
        throw new Error(localizedError(
          'native.error.fcf7d5f146',
          { id: clip.assetId },
          `剪辑片段引用了不存在的素材：${clip.assetId}`,
        ));
      }
      referenced.push({ asset, path: await localEditorAsset(asset) });
    }
  }

  const direct = await tryDirectCopy(target, parent, project, referenced, duration);
  if (direct) return direct;

  const clips = visibleClips(project);
  const hasText = clips.some(item => item.clip.type === 'text');
  const transitions = clips
    .map(item => item.clip)
    .filter(clip => clip.type === 'transition');
  const stamp = `${Date.now()}`;
  const temp = join(parent, `.shotloom-project-export-${stamp}.mp4`);
  const textFiles: string[] = [];
  const audioCache = new Map<string, boolean>();
  let completed = false;

  try {
    const ffmpeg = await resolveExportFfmpeg(hasText);
    const fontPath = hasText ? await editorFont() : null;

    const args: string[] = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i',
      `color=c=${filterColor(project.settings.backgroundColor, '0x050608')}`
        + `:s=${project.settings.width}x${project.settings.height}`
        + `:r=${project.settings.fps.toFixed(3)}:d=${formatSeconds(duration)}`,
    ];
    for (const reference of referenced) {
      if (reference.asset.type === 'image') {
        args.push('-loop', '1', '-framerate', project.settings.fps.toFixed(3));
      }
      args.push('-i', reference.path);
    }

    const filters: string[] = ['[0:v]format=rgba[canvas0]'];
    let canvasLabel = 'canvas0';
    let visualIndex = 0;
    let audioIndex = 0;
    const audioLabels: string[] = [];
    const assetInputIndex = (assetId: string): number | null => {
      const index = referenced.findIndex(item => item.asset.id === assetId);
      return index === -1 ? null : index + 1;
    };

    for (const track of project.tracks) {
      if (track.hidden) continue;
      for (const clip of track.clips) {
        const clipDuration = editorClipDuration(clip);
        const clipEnd = clip.timelineStart + clipDuration;

        if (clip.type === 'video' || clip.type === 'image') {
          const input = assetInputIndex(clip.assetId);
          if (input === null) {
            throw new Error(localizedError('native.error.69f7f8f09d', { id: clip.id }, `找不到片段素材输入：${clip.id}`));
          }
          const width = clip.transform.width > 0
            ? Math.round(clip.transform.width)
            : project.settings.width;
          const height = clip.transform.height > 0
            ? Math.round(clip.transform.height)
            : project.settings.height;
          let sourceFilter: string;
          if (clip.type === 'video') {
            sourceFilter = `trim=start=${formatSeconds(clip.trimStart)}:end=${formatSeconds(clip.trimEnd)}`
              + `,setpts=(PTS-STARTPTS)/${editorClipSpeed(clip).toFixed(6)}`;
            const incoming = transitions.find(item => item.toClipId === clip.id);
            if (incoming) {
              const transitionDuration = Math.max(Math.min(editorClipDuration(incoming), clipDuration / 2), 0.04);
              sourceFilter += `,fade=t=in:st=0:d=${formatSeconds(transitionDuration)}:alpha=1`;
            }
            const outgoing = transitions.find(item => item.fromClipId === clip.id);
            if (outgoing) {
              const transitionDuration = Math.max(Math.min(editorClipDuration(outgoing), clipDuration / 2), 0.04);
              sourceFilter += `,fade=t=out:st=${formatSeconds(Math.max(clipDuration - transitionDuration, 0))}`
                + `:d=${formatSeconds(transitionDuration)}:alpha=1`;
            }
          } else {
            sourceFilter = `trim=duration=${formatSeconds(clipDuration)},setpts=PTS-STARTPTS`;
          }
          const angle = clip.transform.angle * (Math.PI / 180);
          const opacity = Math.min(1, Math.max(0, clip.transform.opacity));
          const rotationFilter = Math.abs(angle) < 0.000_001
            ? ''
            : `,rotate=${angle.toFixed(8)}:ow=rotw(iw):oh=roth(ih):c=none`;
          filters.push(
            `[${input}:v]${sourceFilter},${visualScaleFilter(width, height, clip.transform.fit)},setsar=1,format=rgba`
            + `${rotationFilter},colorchannelmixer=aa=${opacity.toFixed(5)}`
            + `,setpts=PTS+${formatSeconds(clip.timelineStart)}/TB[visual${visualIndex}]`,
          );
          const nextCanvas = `canvas${visualIndex + 1}`;
          filters.push(
            `[${canvasLabel}][visual${visualIndex}]overlay=x=${formatPosition(clip.transform.x)}`
            + `:y=${formatPosition(clip.transform.y)}:eof_action=pass:shortest=0`
            + `:enable='between(t,${formatSeconds(clip.timelineStart)},${formatSeconds(clipEnd)})'`
            + `[${nextCanvas}]`,
          );
          canvasLabel = nextCanvas;
          visualIndex += 1;
        }

        if (clip.type === 'text' && fontPath !== null) {
          // 文本按 Rust 的 .shotloom-text-<时间戳>-<序号> 命名；drawtext 直接读文本而不是预渲染 PNG。
          const textPath = join(parent, `.shotloom-text-${stamp}-${textFiles.length}.txt`);
          await writeFile(textPath, normalizeClipText(clip.text), 'utf8');
          const textIndex = textFiles.length;
          textFiles.push(textPath);
          const nextCanvas = `canvas-text-${textIndex}`;
          filters.push(textDrawtextFilter(clip, fontPath, textPath, canvasLabel, nextCanvas));
          canvasLabel = nextCanvas;
        }

        if (clip.type === 'effect') {
          const effect = {
            vignette: 'vignette=PI/5',
            filmGrain: 'noise=alls=10:allf=t+u',
            pixelate: 'boxblur=4:2',
            glitch: 'lagfun=decay=0.92',
            chromaticAberration: 'rgbashift=rh=3:bh=-3',
          }[clip.effectKey];
          if (effect) {
            const nextCanvas = `canvas-effect-${visualIndex}`;
            filters.push(
              `[${canvasLabel}]${effect}:enable='between(t,${formatSeconds(clip.timelineStart)},${formatSeconds(clipEnd)})'[${nextCanvas}]`,
            );
            canvasLabel = nextCanvas;
            visualIndex += 1;
          }
        }

        if ((clip.type === 'video' || clip.type === 'audio') && !clip.muted && !track.muted) {
          const input = assetInputIndex(clip.assetId);
          if (input === null) {
            throw new Error(localizedError('native.error.8fe6fe90b4', { id: clip.id }, `找不到音频素材输入：${clip.id}`));
          }
          const reference = referenced.find(item => item.asset.id === clip.assetId);
          if (reference && await sourceHasAudio(ffmpeg, reference.path, audioCache)) {
            const delay = Math.max(0, Math.round(clip.timelineStart * 1000));
            filters.push(
              `[${input}:a]atrim=start=${formatSeconds(clip.trimStart)}:end=${formatSeconds(clip.trimEnd)}`
              + `,asetpts=PTS-STARTPTS,atempo=${editorClipSpeed(clip).toFixed(6)}`
              + `,volume=${Math.min(2, Math.max(0, clip.volume)).toFixed(5)}`
              + `,adelay=${delay}:all=1[audio${audioIndex}]`,
            );
            audioLabels.push(`[audio${audioIndex}]`);
            audioIndex += 1;
          }
        }
      }
    }

    filters.push(`[${canvasLabel}]format=yuv420p[outv]`);
    if (audioLabels.length > 0) {
      filters.push(
        `${audioLabels.join('')}amix=inputs=${audioLabels.length}:normalize=0:dropout_transition=0`
        + `,atrim=duration=${formatSeconds(duration)},asetpts=N/SR/TB[outa]`,
      );
    }

    args.push('-filter_complex', filters.join(';'), '-map', '[outv]');
    if (audioLabels.length === 0) {
      args.push('-an');
    } else {
      args.push('-map', '[outa]', '-c:a', 'aac', '-b:a', '192k');
    }
    args.push(
      '-t', formatSeconds(duration),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      temp,
    );

    const run = await runFfmpeg(ffmpeg, args, cancelled);
    if (run.cancelled) {
      throw new Error(localizedError('native.error.931ead0596', {}, '多轨视频导出已取消'));
    }
    if (!run.ok) {
      const detail = run.stderr.trim();
      throw new Error(localizedError('native.error.11a14518e7', { detail }, `多轨视频导出失败：${detail}`));
    }

    await replaceTarget(temp, target);
    completed = true;

    const result = await fileResult(target);
    return {
      ...result,
      duration,
      trackCount: project.tracks.length,
      assetCount: project.assets.length,
      engine: EXPORT_ENGINE,
      transitionCount: transitions.length,
      transitionTypes: transitions.map(clip => clip.transitionKey),
    };
  } finally {
    // Rust 启动 FFmpeg 失败会漏删文本层；这里无论如何都清掉临时文本与未完成的输出。
    for (const path of textFiles) await unlink(path).catch(() => undefined);
    if (!completed) await unlink(temp).catch(() => undefined);
  }
}
