import { configureShotloomLocale } from "../shotloom-mode";
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmbeddedNativeEncoder } from './native-export';
import { DEFAULT_VIDEO_SETTINGS, type Project } from '@openreel/core';
import type { ClipStudioNativeExport, NativeExportReceipt } from './runtime-types';

function fixture(overrides: Partial<NativeExportReceipt> = {}) {
  const writes: Array<{ kind: string; bytes: ArrayBuffer; position: number }> = [];
  const bridge: ClipStudioNativeExport = {
    start: vi.fn(async () => 'owned-job'),
    write: vi.fn(async (_id, kind, bytes, position) => { writes.push({ kind, bytes, position }); }),
    finish: vi.fn(async () => ({ filePath: '/project/assets/alpha.webm', filename: 'alpha.webm', size: 1234, codec: 'vp9', format: 'webm', ...overrides })),
    cancel: vi.fn(async () => {}),
  };
  const delivered = vi.fn();
  return { bridge, delivered, writes, backend: new EmbeddedNativeEncoder(bridge, delivered) };
}
const settings = { ...DEFAULT_VIDEO_SETTINGS, width: 2, height: 2, frameRate: 2, codec: 'vp9' as const, format: 'webm' as const,
  range: { startTime: 1, endTime: 2 } };
const project = { timeline: { duration: 30 } } as Project;

afterEach(() => { vi.restoreAllMocks(); configureShotloomLocale("en-US"); });

describe('embedded native encoder', () => {
  it('passes actual range, preserves transparent RGBA, finalizes WAV and reports the saved codec', async () => {
    const { backend, bridge, delivered, writes } = fixture();
    const writable = { abort: vi.fn(async () => {}) } as unknown as FileSystemWritableFileStream;
    await backend.start(settings, project, writable);
    expect(bridge.start).toHaveBeenCalledWith(expect.objectContaining({ totalFrames: 2, codec: 'vp9', format: 'webm' }));
    await backend.closeAudio();
    const header = writes.filter(write => write.kind === 'audio' && write.position === 0).at(-1)!;
    const wav = new DataView(header.bytes);
    expect(wav.getUint32(40, true)).toBe(settings.audioSettings.sampleRate * settings.audioSettings.channels * 2);
    const rgba = new Uint8ClampedArray([0, 255, 0, 0, 0, 255, 0, 255, 0, 255, 0, 64, 0, 255, 0, 128]);
    vi.spyOn(OffscreenCanvas.prototype, 'getContext').mockReturnValue({ clearRect() {}, drawImage() {}, getImageData: () => ({ data: rgba }) } as unknown as ReturnType<OffscreenCanvas['getContext']>);
    const close = vi.fn();
    await backend.addVideoFrame({ close } as unknown as ImageBitmap);
    expect([...new Uint8Array(writes.find(write => write.kind === 'frame')!.bytes)]).toEqual([...rgba]);
    expect(close).toHaveBeenCalledOnce();
    await backend.finalize();
    expect(delivered).toHaveBeenCalledWith(expect.objectContaining({ size: 1234, codec: 'vp9' }));
    expect(backend.getBytesWritten()).toBe(1234);
    expect(writable.abort).toHaveBeenCalledOnce();
  });
  it.each([
    ["en-US", "Native encoder returned an invalid file or codec receipt"],
    ["zh-CN", "原生编码器返回的文件或编码回执无效。"],
  ])('rejects false codec receipts and cancels the owned job in %s', async (locale, failure) => {
    configureShotloomLocale(locale);
    const { backend, bridge, delivered } = fixture({ codec: 'h264' });
    await backend.start(settings, project);
    await expect(backend.finalize()).rejects.toThrow(failure);
    expect(delivered).not.toHaveBeenCalled();
    await backend.abort();
    expect(bridge.cancel).toHaveBeenCalledWith('owned-job');
  });
});

it("rejects incorrect sample rates and closes unreadable frames with Chinese errors", async () => {
  configureShotloomLocale("zh-CN");
  const { backend, delivered, bridge } = fixture();
  await backend.start(settings, project);
  await expect(backend.addAudioBuffer({ sampleRate: 1 } as AudioBuffer)).rejects.toThrow("原生编码器收到的音频采样率不正确。");
  vi.spyOn(OffscreenCanvas.prototype, "getContext").mockReturnValue(null);
  const close = vi.fn();
  await expect(backend.addVideoFrame({ close } as unknown as ImageBitmap)).rejects.toThrow("原生导出无法读取已渲染的 RGBA 帧。");
  expect(close).toHaveBeenCalledOnce();
  expect(bridge.write).toHaveBeenCalledTimes(1); // Only the initial WAV header.
  expect(delivered).not.toHaveBeenCalled();
  await backend.abort();
});
