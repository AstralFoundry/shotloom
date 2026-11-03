import { editorMessage } from "../shotloom-mode";
import { setEncoderBackendFactory, type EncoderBackend, type Project, type VideoExportSettings } from '@openreel/core';
import { buildWavHeader, encodeAudioBufferToPcm16 } from '../services/native-ffmpeg-backend';
import type { ClipStudioNativeExport, NativeExportReceipt } from './runtime-types';

/** Encodes OpenReel-rendered pixels, not a second approximation of its timeline. */
export class EmbeddedNativeEncoder implements EncoderBackend {
  readonly requiresWebCodecsClamping = false;
  readonly needsFrameThrottling = false;
  readonly normalizesProResToH264 = false;
  readonly audioBeforeVideo = true;
  private jobId = '';
  private settings!: VideoExportSettings;
  private duration = 0;
  private frameBytes = 0;
  private audioFrames = 0;
  private audioBytes = 44;
  private bytesWritten = 0;
  private canvas?: OffscreenCanvas;
  private writable?: FileSystemWritableFileStream;
  constructor(private bridge: ClipStudioNativeExport, private delivered: (receipt: NativeExportReceipt) => void) {}
  async start(settings: VideoExportSettings, project: Project, writable?: FileSystemWritableFileStream) {
    this.settings = settings;
    this.writable = writable;
    this.duration = settings.range ? settings.range.endTime - settings.range.startTime : project.timeline.duration;
    this.jobId = await this.bridge.start({ width: settings.width, height: settings.height,
      frameRate: settings.frameRate, totalFrames: Math.max(1, Math.ceil(this.duration * settings.frameRate - 1e-7)),
      codec: settings.codec, format: settings.format,
      audioSampleRate: settings.audioSettings.sampleRate, audioChannels: settings.audioSettings.channels,
      ...(settings.proresProfile ? { proresProfile: settings.proresProfile } : {}),
    });
    await this.bridge.write(this.jobId, 'audio', buildWavHeader(0, settings.audioSettings.channels, settings.audioSettings.sampleRate), 0);
  }
  async addAudioBuffer(buffer: AudioBuffer) {
    if (buffer.sampleRate !== this.settings.audioSettings.sampleRate) throw new Error(editorMessage("editor.native.sampleRate"));
    const pcm = encodeAudioBufferToPcm16(buffer, this.settings.audioSettings.channels);
    await this.bridge.write(this.jobId, 'audio', pcm, this.audioBytes);
    this.audioBytes += pcm.byteLength;
    this.audioFrames += buffer.length;
  }
  async closeAudio() {
    const { sampleRate, channels } = this.settings.audioSettings;
    if (!this.audioFrames) {
      let remaining = Math.max(1, Math.ceil(this.duration * sampleRate));
      while (remaining) {
        const frames = Math.min(remaining, sampleRate);
        const silence = new ArrayBuffer(frames * channels * 2);
        await this.bridge.write(this.jobId, 'audio', silence, this.audioBytes);
        this.audioBytes += silence.byteLength; this.audioFrames += frames; remaining -= frames;
      }
    }
    await this.bridge.write(this.jobId, 'audio', buildWavHeader(this.audioFrames, channels, sampleRate), 0);
  }
  async addVideoFrame(frame: ImageBitmap) {
    try {
      this.canvas ??= new OffscreenCanvas(this.settings.width, this.settings.height);
      const context = this.canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error(editorMessage("editor.native.rgba"));
      context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      context.drawImage(frame, 0, 0);
      const rgba = context.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
      await this.bridge.write(this.jobId, 'frame', rgba.slice().buffer, this.frameBytes);
      this.frameBytes += rgba.byteLength;
    } finally { frame.close(); }
  }
  getBytesWritten() { return this.bytesWritten; }
  async finalize() {
    const receipt = await this.bridge.finish(this.jobId);
    if (!receipt.filePath || receipt.size <= 0 || receipt.codec !== this.settings.codec || receipt.format !== this.settings.format) {
      throw new Error(editorMessage("editor.native.receipt"));
    }
    this.bytesWritten = receipt.size;
    this.delivered(receipt);
    // Release the unused mux stream opened by upstream Motion export.
    await this.writable?.abort().catch(() => {});
    this.canvas = undefined;
  }
  async abort() {
    if (this.jobId) await this.bridge.cancel(this.jobId);
    this.canvas = undefined;
  }
}

export function configureEmbeddedNativeExport(bridge: ClipStudioNativeExport, delivered: (receipt: NativeExportReceipt) => void) {
  let output: NativeExportReceipt | undefined;
  const createBackend = () => new EmbeddedNativeEncoder(bridge, receipt => { output = receipt; delivered(receipt); });
  setEncoderBackendFactory(createBackend);
  // Explicit encoding capability, without pretending Tauri is the Electron host.
  window.openreel = { ...window.openreel, shotloomNativeEncoding: true } as typeof window.openreel;
  return { createBackend, getOutput: () => output };
}
