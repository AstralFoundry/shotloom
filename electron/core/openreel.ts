import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, realpath, rm, stat, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { localizedError, errorMessage } from './errors';
import { fileResult, PROJECT_FILE } from './files';
import {
  createTempDirectory,
  isPathWithin,
  removeTempDirectory,
  resolveMediaTool,
  runFfmpeg,
  type MediaTaskFlag,
} from './media';

/**
 * OpenReel 原生编辑器导出的状态与编码实现，对应 src-tauri/src/commands/openreel_export.rs。
 *
 * 产品边界：渲染进程只拿到不透明的 job id，帧/音频经 base64 落到系统临时目录，
 * 只有编码成功才把成品复制进工程的 assets/；失败、取消或退出都不会在工程里留下半成品。
 * 命令注册在 ipc/commands/openreel.ts。
 */

/** 与 Rust 的 NativeEncoderSettings 同形（serde camelCase），由渲染进程传入。 */
export interface NativeEncoderSettings {
  width: number;
  height: number;
  frameRate: number;
  totalFrames: number;
  codec: string;
  format: string;
  audioSampleRate: number;
  audioChannels: number;
  proresProfile?: string;
}

/** 与 runtime-types.ts 的 NativeExportReceipt 一致；额外字段来自 Rust 的 file_result。 */
export interface NativeExportReceipt {
  filePath: string;
  filename: string;
  size: number;
  codec: string;
  format: string;
}

const MAX_FRAME_BYTES = 256 * 1024 * 1024;
const MAX_AUDIO_CHUNK_BYTES = 16 * 1024 * 1024;
const SAMPLE_RATES = [44100, 48000, 96000];
const CHANNELS = [1, 2];
const PRORES_PROFILES = ['proxy', 'lt', 'standard', 'hq', '4444', '4444xq'];
/** ProRes profile 名到 prores_ks -profile:v 数值，与 Rust 的 match 一致。 */
const PRORES_PROFILE_NUMBERS: Record<string, string> = {
  proxy: '0',
  lt: '1',
  standard: '2',
  hq: '3',
  '4444': '4',
  '4444xq': '5',
};

function invalidSettings(): Error {
  return new Error(localizedError(
    'native.error.dfa69e55f7',
    {},
    'Invalid native encoder dimensions, timing or audio settings',
  ));
}

function frameBytes(settings: NativeEncoderSettings): number {
  return settings.width * settings.height * 4;
}

function safeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * 等价于 Rust 的 NativeEncoderSettings::validate：数值边界先判，再判容器/编码器组合，
 * 最后是 ProRes profile 白名单。类型级错误（serde 反序列化失败）在这里统一折成同一批
 * 本地化错误，不让渲染进程看到 serde 文案。
 */
export function validateEncoderSettings(raw: unknown): NativeEncoderSettings {
  const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const width = safeInteger(input.width);
  const height = safeInteger(input.height);
  const frameRate = typeof input.frameRate === 'number' && Number.isFinite(input.frameRate)
    ? input.frameRate
    : null;
  const totalFrames = safeInteger(input.totalFrames);
  const audioSampleRate = safeInteger(input.audioSampleRate);
  const audioChannels = safeInteger(input.audioChannels);
  if (width === null
    || height === null
    || width === 0
    || height === 0
    || width * height * 4 > MAX_FRAME_BYTES
    || frameRate === null
    || frameRate <= 0
    || frameRate > 240
    || totalFrames === null
    || totalFrames === 0
    || audioSampleRate === null
    || !SAMPLE_RATES.includes(audioSampleRate)
    || audioChannels === null
    || !CHANNELS.includes(audioChannels)) {
    throw invalidSettings();
  }
  const codec = typeof input.codec === 'string' ? input.codec : '';
  const format = typeof input.format === 'string' ? input.format : '';
  const pairValid = format === 'mp4'
    ? codec === 'h264' || codec === 'h265'
    : format === 'webm'
      ? codec === 'vp8' || codec === 'vp9'
      : format === 'mov'
        ? codec === 'h264' || codec === 'h265' || codec === 'prores'
        : false;
  if (!pairValid) {
    throw new Error(localizedError(
      'native.error.948f33bcc3',
      {},
      'Unsupported native codec/container pair',
    ));
  }
  const rawProfile = input.proresProfile;
  if (rawProfile !== undefined
    && rawProfile !== null
    && (typeof rawProfile !== 'string' || !PRORES_PROFILES.includes(rawProfile))) {
    throw new Error(localizedError(
      'native.error.8d532e07cb',
      {},
      'Unknown ProRes profile',
    ));
  }
  return {
    width,
    height,
    frameRate,
    totalFrames,
    codec,
    format,
    audioSampleRate,
    audioChannels,
    ...(typeof rawProfile === 'string' ? { proresProfile: rawProfile } : {}),
  };
}

function cancelledError(): Error {
  return new Error(localizedError('native.error.2bb8d03cf9', {}, 'Native export cancelled'));
}

class ExportJob {
  readonly settings: NativeEncoderSettings;
  readonly scratch: string;
  readonly output: string;
  /** media.ts 的取消标记；cancel 只置位，FFmpeg 轮询到后自己退出，和 Rust 一致。 */
  readonly flag: MediaTaskFlag = { cancelled: false };
  frames = 0;
  audioBytes = 0;
  encoding = false;
  /** finish 已接管任务：cancel 不再直接删临时目录，交给 finish 的 finally 收尾。 */
  finishPending = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly owner: string,
    settings: NativeEncoderSettings,
    scratch: string,
    output: string,
  ) {
    this.settings = settings;
    this.scratch = scratch;
    this.output = output;
  }

  get cancelled(): boolean {
    return this.flag.cancelled;
  }

  /** Rust 的 stream Mutex：帧计数、音频水位与 finish 准备必须串行。 */
  serialize<T>(task: () => Promise<T> | T): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }
}

/** Rust 的 write_all 会补齐短写，这里也不能假设一次 write 写完整帧。 */
async function writeAll(handle: FileHandle, bytes: Buffer, position: number): Promise<void> {
  let written = 0;
  while (written < bytes.length) {
    const { bytesWritten } = await handle.write(
      bytes,
      written,
      bytes.length - written,
      position + written,
    );
    if (bytesWritten === 0) throw new Error('temporary stream write made no progress');
    written += bytesWritten;
  }
}

/** 打开（必要时创建）临时流文件并按 position 写入；等价于 Rust 的 create+write+seek。 */
async function writeAt(path: string, position: number, bytes: Buffer): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_WRONLY | constants.O_CREAT, 0o666);
    await writeAll(handle, bytes, position);
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * 把编码结果发布到工程 assets/：create_new 语义（不覆盖已有文件），复制后 fsync。
 * 复制失败时删掉半成品，保证工程目录里不会出现“看起来导出成功”的文件。
 */
async function publish(encoded: string, output: string): Promise<void> {
  let destination: FileHandle;
  try {
    destination = await open(output, 'wx');
  } catch (error) {
    // Rust 对 create_new 失败原样上报 io::Error 文本。
    throw new Error(errorMessage(error));
  }
  try {
    const source = await open(encoded, 'r');
    try {
      const buffer = Buffer.alloc(1024 * 1024);
      let position = 0;
      for (;;) {
        const { bytesRead } = await source.read(buffer, 0, buffer.length, position);
        if (bytesRead === 0) break;
        await writeAll(destination, buffer.subarray(0, bytesRead), position);
        position += bytesRead;
      }
      await destination.sync();
    } finally {
      await source.close().catch(() => undefined);
    }
  } catch (error) {
    await destination.close().catch(() => undefined);
    await rm(output, { force: true });
    const detail = errorMessage(error);
    throw new Error(localizedError(
      'native.error.67016eaa35',
      { error: detail },
      `Cannot publish native export: ${detail}`,
    ));
  }
  // Rust 侧 close 由 Drop 完成，出错也不改变已经成功发布的事实。
  await destination.close().catch(() => undefined);
}

/** 与 Rust encode() 的命令行逐参数对齐：原始 RGBA + WAV 进，单文件成品出。 */
function encodeArguments(job: ExportJob, encoded: string): string[] {
  const settings = job.settings;
  const args = [
    '-v', 'error',
    '-nostdin',
    '-f', 'rawvideo',
    '-pixel_format', 'rgba',
    '-video_size', `${settings.width}x${settings.height}`,
    '-framerate', String(settings.frameRate),
    '-i', join(job.scratch, 'video.rgba'),
    '-i', join(job.scratch, 'audio.wav'),
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-frames:v', String(settings.totalFrames),
  ];
  switch (settings.codec) {
    case 'prores': {
      const profile = settings.proresProfile ?? 'hq';
      const number = PRORES_PROFILE_NUMBERS[profile] ?? '5';
      args.push(
        '-c:v', 'prores_ks',
        '-profile:v', number,
        '-pix_fmt', number === '4' || number === '5' ? 'yuva444p10le' : 'yuv422p10le',
      );
      break;
    }
    case 'vp8':
    case 'vp9':
      args.push(
        '-c:v', settings.codec === 'vp9' ? 'libvpx-vp9' : 'libvpx',
        '-pix_fmt', 'yuva420p',
        '-auto-alt-ref', '0',
        '-crf', '25',
        '-b:v', '0',
      );
      break;
    case 'h265':
      args.push('-c:v', 'libx265', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1');
      break;
    default:
      args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20');
  }
  // WebM 只能装 Opus；ProRes 走 PCM，其余容器用 AAC —— 与 Rust 的三分支一致。
  const audioCodec = settings.format === 'webm'
    ? 'libopus'
    : settings.codec === 'prores'
      ? 'pcm_s16le'
      : 'aac';
  args.push('-c:a', audioCodec, '-shortest', encoded);
  return args;
}

async function encodeJob(job: ExportJob): Promise<NativeExportReceipt> {
  const settings = job.settings;
  const encoded = join(job.scratch, `result.${settings.format}`);
  const ffmpeg = await resolveMediaTool('ffmpeg');
  const run = await runFfmpeg(ffmpeg, encodeArguments(job, encoded), job.flag);
  if (run.cancelled) throw cancelledError();
  if (!run.ok) {
    throw new Error(localizedError(
      'native.error.beb29ac164',
      { detail: run.stderr },
      `FFmpeg native export failed: ${run.stderr}`,
    ));
  }
  if (job.cancelled) throw cancelledError();
  const metadata = await stat(encoded);
  if (metadata.size === 0) {
    throw new Error(localizedError('native.error.c560aa00c5', {}, 'FFmpeg produced an empty file'));
  }
  // 调用方不能指定输出路径；这里再确认 assets 目录在编码期间没有被换成符号链接。
  const parent = dirname(job.output);
  const canonicalParent = await realpath(parent);
  if (canonicalParent !== parent) {
    throw new Error(localizedError(
      'native.error.33dcae234c',
      {},
      'Export directory changed during encoding',
    ));
  }
  await publish(encoded, job.output);
  if (job.cancelled) {
    await rm(job.output, { force: true });
    throw cancelledError();
  }
  const result = await fileResult(job.output);
  // Rust 在 file_result 之上补 filename/codec/format，保留 path/name 字段。
  return {
    ...result,
    filename: basename(job.output),
    codec: settings.codec,
    format: settings.format,
  };
}

/**
 * 导出任务注册表。Tauri 用 window label 区分所有权，Electron 只有一个业务窗口，
 * 命令层固定传 'main'；这里仍保留 owner 参数，避免把窗口语义写死在状态机里。
 */
export class OpenReelExportRegistry {
  private readonly jobs = new Map<string, ExportJob>();

  private get(owner: string, id: string): ExportJob {
    const job = this.jobs.get(id);
    if (!job || job.owner !== owner) {
      throw new Error(localizedError(
        'native.error.cf621a4f6c',
        {},
        'Native export session not found',
      ));
    }
    if (job.cancelled) throw cancelledError();
    return job;
  }

  async start(owner: string, projectDir: string, rawSettings: unknown): Promise<string> {
    const settings = validateEncoderSettings(rawSettings);
    // 先探测工具：缺 FFmpeg 时应在传入任何帧之前失败。
    await resolveMediaTool('ffmpeg');
    let root: string;
    try {
      root = await realpath(projectDir);
    } catch (error) {
      throw new Error(errorMessage(error));
    }
    let isProject = false;
    try {
      isProject = (await stat(join(root, PROJECT_FILE))).isFile();
    } catch {
      isProject = false;
    }
    if (!isProject) {
      throw new Error(localizedError(
        'native.error.ce0baa2719',
        {},
        'Native export requires a saved Shotloom project',
      ));
    }
    const assets = join(root, 'assets');
    try {
      await mkdir(assets, { recursive: true });
    } catch (error) {
      throw new Error(errorMessage(error));
    }
    const canonicalAssets = await realpath(assets);
    if (!isPathWithin(canonicalAssets, root)) {
      throw new Error(localizedError(
        'native.error.948293cf73',
        {},
        'Project assets escape the project directory',
      ));
    }
    const id = randomUUID();
    const scratch = await createTempDirectory('shotloom-openreel');
    const job = new ExportJob(
      owner,
      settings,
      scratch,
      join(canonicalAssets, `openreel-${id}.${settings.format}`),
    );
    this.jobs.set(id, job);
    return id;
  }

  async write(owner: string, id: string, kind: string, bytes: Buffer, position: number): Promise<void> {
    const job = this.get(owner, id);
    await job.serialize(async () => {
      if (job.encoding) {
        throw new Error(localizedError(
          'native.error.4f02b13584',
          {},
          'Native export is already encoding',
        ));
      }
      const expectedFrameBytes = frameBytes(job.settings);
      let filename: string;
      if (kind === 'frame') {
        if (bytes.length !== expectedFrameBytes
          || position !== job.frames * expectedFrameBytes
          || job.frames >= job.settings.totalFrames) {
          throw new Error(localizedError(
            'native.error.752472cc11',
            {},
            'Invalid RGBA frame size, position or frame count',
          ));
        }
        filename = 'video.rgba';
      } else if (kind === 'audio') {
        if (bytes.length === 0
          || bytes.length > MAX_AUDIO_CHUNK_BYTES
          || position > job.audioBytes) {
          throw new Error(localizedError(
            'native.error.4de569d2e1',
            {},
            'Invalid audio chunk size or sparse write',
          ));
        }
        filename = 'audio.wav';
      } else {
        throw new Error(localizedError(
          'native.error.06a6d4544f',
          {},
          'Unknown native export stream',
        ));
      }
      await writeAt(join(job.scratch, filename), position, bytes);
      if (kind === 'frame') job.frames += 1;
      else job.audioBytes = Math.max(job.audioBytes, position + bytes.length);
    });
  }

  private prepareFinish(owner: string, id: string): Promise<ExportJob> {
    const job = this.get(owner, id);
    // 从这一刻起 finish 持有任务（等价于 Rust 里被 move 进 spawn_blocking 的 Arc），
    // cancel 只置取消标记，临时目录留给 finish 的 finally 删除。
    job.finishPending = true;
    return job.serialize(() => {
      if (job.encoding
        || job.frames !== job.settings.totalFrames
        || job.audioBytes < 44) {
        throw new Error(localizedError(
          'native.error.76128bca84',
          {},
          'Incomplete or already finishing native export',
        ));
      }
      job.encoding = true;
      return job;
    }).catch(error => {
      // 准备失败时任务还在注册表里，取消/退出仍需能清理它的临时目录；
      // 若已有编码在跑（encoding 为真）则保持 finishPending，避免删掉正在读的帧。
      if (!job.encoding) job.finishPending = false;
      throw error;
    });
  }

  async finish(owner: string, id: string): Promise<NativeExportReceipt> {
    const job = await this.prepareFinish(owner, id);
    try {
      return await encodeJob(job);
    } finally {
      // 无论成功、失败还是取消，任务与临时帧都到此为止。
      this.jobs.delete(id);
      await removeTempDirectory(job.scratch).catch(() => undefined);
    }
  }

  async cancel(owner: string, id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) return;
    if (job.owner !== owner) {
      throw new Error(localizedError(
        'native.error.fc99b3325a',
        {},
        'Native export owner mismatch',
      ));
    }
    job.flag.cancelled = true;
    this.jobs.delete(id);
    // 编码中或 finish 已接管时，临时文件由 finish 的 finally 清理；否则等挂起的写盘
    // 结束后再删目录（Rust 里是最后一个 Arc 释放时 Drop）。
    if (!job.encoding && !job.finishPending) {
      await job.serialize(() => removeTempDirectory(job.scratch)).catch(() => undefined);
    }
  }

  /** 对应 Rust 的 shutdown：窗口销毁/应用退出时丢弃任务，编码中的让取消路径收尾。 */
  shutdown(owner?: string): void {
    for (const [id, job] of [...this.jobs]) {
      if (owner !== undefined && job.owner !== owner) continue;
      job.flag.cancelled = true;
      this.jobs.delete(id);
      if (!job.encoding && !job.finishPending) {
        void removeTempDirectory(job.scratch).catch(() => undefined);
      }
    }
  }
}

export const openReelExports = new OpenReelExportRegistry();

export function startOpenReelExport(owner: string, projectDir: string, settings: unknown): Promise<string> {
  return openReelExports.start(owner, projectDir, settings);
}

export function writeOpenReelExport(
  owner: string,
  jobId: string,
  kind: string,
  bytes: Buffer,
  position: number,
): Promise<void> {
  return openReelExports.write(owner, jobId, kind, bytes, position);
}

export function finishOpenReelExport(owner: string, jobId: string): Promise<NativeExportReceipt> {
  return openReelExports.finish(owner, jobId);
}

export function cancelOpenReelExport(owner: string, jobId: string): Promise<void> {
  return openReelExports.cancel(owner, jobId);
}

export function shutdownOpenReelExports(owner?: string): void {
  openReelExports.shutdown(owner);
}
