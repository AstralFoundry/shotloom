import { desktopBridge } from './core.ts';

/**
 * 更新检查的对等物。Tauri 的 `Update` 对象有 version/body/close/download/install，
 * 这里保持同一组成员，让 tauriApi 的更新流程代码可以原样复用。
 */

export interface UpdateDownloadEvent {
  event: 'Started' | 'Progress' | 'Finished';
  data: { contentLength?: number; chunkLength?: number };
}

export interface Update {
  readonly version: string;
  readonly body?: string;
  close(): Promise<void>;
  download(onEvent?: (event: UpdateDownloadEvent) => void): Promise<void>;
  install(): Promise<void>;
}

class DesktopUpdate implements Update {
  readonly version: string;
  readonly body: string;
  private readonly id: string;
  private readonly progressDispose: (() => void) | null;

  constructor(info: { version: string; body?: string }, id: string) {
    this.version = info.version;
    this.body = info.body || '';
    this.id = id;
    const bridge = desktopBridge();
    this.progressDispose = bridge
      ? bridge.update.onProgress((payload) => {
        const message = payload as { id?: string; event?: UpdateDownloadEvent['event']; data?: UpdateDownloadEvent['data'] };
        if (message?.id !== this.id) return;
        this.progressHandler?.({ event: message.event || 'Progress', data: message.data || {} });
      })
      : null;
  }

  private progressHandler: ((event: UpdateDownloadEvent) => void) | null = null;

  async close(): Promise<void> {
    this.progressDispose?.();
    await desktopBridge()?.update.cancel(this.id);
  }

  async download(onEvent?: (event: UpdateDownloadEvent) => void): Promise<void> {
    this.progressHandler = onEvent || null;
    const result = await desktopBridge()?.update.download(this.id);
    if (!result?.ok) throw new Error(result?.error || 'update download failed');
  }

  async install(): Promise<void> {
    const result = await desktopBridge()?.update.install(this.id);
    if (!result?.ok) throw new Error(result?.error || 'update install failed');
  }
}

export async function check(): Promise<Update | null> {
  const info = await desktopBridge()?.update.check();
  if (!info) return null;
  return new DesktopUpdate(info, info.version);
}
