/**
 * preload 暴露给渲染进程的原生桥类型。刻意保持与 Tauri 桌面桥同形，
 * 业务代码只依赖这一份契约，不再直接 import @tauri-apps/*。
 */

export interface DesktopInvokeArgs { [key: string]: unknown }

export interface DesktopDialogOptions {
  title?: string;
  defaultPath?: string;
  directory?: boolean;
  multiple?: boolean;
  recursive?: boolean;
  filters?: { name: string; extensions: string[] }[];
}

export interface DesktopUpdateInfo {
  version: string;
  body?: string;
  date?: string;
}

export type DesktopPlatform = 'darwin' | 'win32' | 'linux';

export interface ShotloomDesktopBridge {
  invoke(command: string, args?: DesktopInvokeArgs): Promise<unknown>;
  listen(event: string, handler: (payload: unknown) => void): () => void;
  createChannel(id: string, handler: (payload: unknown) => void): () => void;
  convertFileSrc(path: string): string;
  pathForFile?(file: File): string;
  dialog: {
    open(options?: DesktopDialogOptions): Promise<string | string[] | null>;
    save(options?: DesktopDialogOptions): Promise<string | null>;
  };
  window: {
    control(action: string, value?: unknown): Promise<unknown>;
    onResized(handler: (payload: unknown) => void): () => void;
    onCloseRequested(handler: (payload: unknown) => void): () => void;
  };
  update: {
    check(): Promise<DesktopUpdateInfo | null>;
    download(id: string): Promise<{ ok: boolean; error?: string }>;
    cancel(id: string): Promise<{ ok: boolean }>;
    install(id: string): Promise<{ ok: boolean; error?: string }>;
    relaunch(): Promise<void>;
    onProgress(handler: (payload: unknown) => void): () => void;
  };
  platform: DesktopPlatform;
  versions: { electron?: string; node?: string };
}
