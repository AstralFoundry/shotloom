import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';

/**
 * 渲染进程唯一的原生入口。这里刻意保持与 Tauri 桌面桥同形的 API：
 * `invoke(command, args)`、`listen(event, handler)`、Channel、`convertFileSrc`。
 * 渲染进程的消费方（desktopApi / harnessClient / 导出服务）因此不需要关心底层换了运行时。
 */

type Listener = (payload: unknown) => void;

interface InvokeResult {
  ok: boolean;
  value?: unknown;
  error?: unknown;
}

const channelHandlers = new Map<string, Listener>();

ipcRenderer.on('shotloom:channel', (_event: IpcRendererEvent, message: { id?: unknown; payload?: unknown }) => {
  const handler = channelHandlers.get(String(message?.id ?? ''));
  if (handler) handler(message.payload);
});

async function invoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
  const result = (await ipcRenderer.invoke('shotloom:command', command, args ?? {})) as InvokeResult;
  if (result?.ok) return result.value;
  // Tauri 的 invoke 以字符串拒绝，渲染进程按同一协议解析本地化错误信封。
  throw result?.error;
}

const api = {
  invoke,
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  listen(event: string, handler: Listener): () => void {
    const name = `shotloom:event:${event}`;
    const wrapped = (_event: IpcRendererEvent, payload: unknown) => handler(payload);
    ipcRenderer.on(name, wrapped);
    return () => { ipcRenderer.removeListener(name, wrapped); };
  },
  createChannel(id: string, handler: Listener): () => void {
    channelHandlers.set(id, handler);
    return () => { channelHandlers.delete(id); };
  },
  convertFileSrc(path: string): string {
    return `shotloom://asset/${encodeURIComponent(String(path))}`;
  },
  dialog: {
    open: (options: unknown) => ipcRenderer.invoke('shotloom:dialog-open', options),
    save: (options: unknown) => ipcRenderer.invoke('shotloom:dialog-save', options),
  },
  window: {
    control: (action: string, value?: unknown) => ipcRenderer.invoke('shotloom:window', action, value),
    onResized: (handler: Listener) => api.listen('window-resized', handler),
    onCloseRequested: (handler: Listener) => api.listen('window-close-requested', handler),
  },
  update: {
    check: () => ipcRenderer.invoke('shotloom:update-check'),
    download: (id: string) => ipcRenderer.invoke('shotloom:update-download', id),
    cancel: (id: string) => ipcRenderer.invoke('shotloom:update-cancel', id),
    install: (id: string) => ipcRenderer.invoke('shotloom:update-install', id),
    relaunch: () => ipcRenderer.invoke('shotloom:relaunch'),
    onProgress: (handler: Listener) => api.listen('update-progress', handler),
  },
  platform: process.platform,
  versions: { electron: process.versions.electron, node: process.versions.node },
};

contextBridge.exposeInMainWorld('shotloomDesktop', api);
