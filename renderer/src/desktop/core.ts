import type { ShotloomDesktopBridge } from './types.ts';

/**
 * 桌面桥的渲染进程入口。形状沿用 Tauri 的 `invoke` / `Channel` / `convertFileSrc`，
 * 但底层是 Electron preload 暴露的 `window.shotloomDesktop`。
 */

export type InvokeArgs = Record<string, unknown>;
export interface InvokeOptions { headers?: Record<string, string> }

export function desktopBridge(): ShotloomDesktopBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.shotloomDesktop;
}

export function isDesktopRuntime(): boolean {
  return Boolean(desktopBridge());
}

const channelMarker = '__shotloomChannel';

let channelSequence = 0;

/**
 * Tauri Channel 的对等物：消息回调留在渲染进程，preload 只按 id 把消息转回来，
 * 因此 `invoke` 的参数里只需要传一个可序列化的 id。
 */
export class Channel<T = unknown> {
  readonly [channelMarker] = true;
  readonly id: string;
  onmessage: ((message: T) => void) | null = null;

  constructor() {
    channelSequence += 1;
    this.id = `channel-${Date.now()}-${channelSequence}`;
    desktopBridge()?.createChannel(this.id, (payload) => { this.onmessage?.(payload as T); });
  }
}

/** 把参数里的 Channel 折成 id，并丢掉函数等不可结构化克隆的值。 */
function serializeArgs(value: unknown): unknown {
  if (value instanceof Channel) return { __shotloomChannelId: value.id };
  if (Array.isArray(value)) return value.map(serializeArgs);
  if (value && typeof value === 'object') {
    if ((value as Record<string, unknown>)[channelMarker]) return { __shotloomChannelId: (value as unknown as Channel).id };
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (typeof entry === 'function' || entry === undefined) continue;
      result[key] = serializeArgs(entry);
    }
    return result;
  }
  return value;
}

export async function invoke<T>(command: string, args?: InvokeArgs, _options?: InvokeOptions): Promise<T> {
  const bridge = desktopBridge();
  if (!bridge) throw new Error('desktop bridge is not available');
  return await bridge.invoke(command, serializeArgs(args ?? {}) as InvokeArgs) as T;
}

/** 本地文件 -> 可直接放进 img/video 的地址。浏览器预览里没有原生桥，返回原值。 */
export function convertFileSrc(path: string): string {
  const bridge = desktopBridge();
  if (!bridge) return String(path);
  return bridge.convertFileSrc(String(path));
}

export type { ShotloomDesktopBridge };
