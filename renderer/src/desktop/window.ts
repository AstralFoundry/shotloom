import { desktopBridge } from './core.ts';

/**
 * 当前窗口的能力集，对应 tauriApi 里实际用到的 `getCurrentWindow()` 方法。
 * 关闭请求先由主进程拦下，再交给渲染进程决定：只有 `destroy()` 会真正关闭。
 */

export interface CloseRequestedEvent {
  preventDefault(): void;
}

export type UnlistenFn = () => void;

export interface DesktopWindow {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  isMaximized(): Promise<boolean>;
  close(): Promise<void>;
  destroy(): Promise<void>;
  title(): Promise<string>;
  setTitle(title: string): Promise<void>;
  onResized(handler: () => void): Promise<UnlistenFn>;
  onCloseRequested(handler: (event: CloseRequestedEvent) => void): Promise<UnlistenFn>;
}

export function getCurrentWindow(): DesktopWindow {
  const bridge = desktopBridge();
  const control = async (action: string, value?: unknown) => {
    if (!bridge) return undefined;
    return await bridge.window.control(action, value);
  };
  return {
    minimize: async () => { await control('minimize'); },
    toggleMaximize: async () => { await control('maximize'); },
    isMaximized: async () => Boolean(await control('is-maximized')),
    close: async () => { await control('close'); },
    destroy: async () => { await control('destroy'); },
    title: async () => String(await control('title') ?? ''),
    setTitle: async (title: string) => { await control('set-title', title); },
    onResized: async (handler) => {
      if (!bridge) return () => undefined;
      const dispose = bridge.window.onResized(() => handler());
      return () => { dispose(); };
    },
    onCloseRequested: async (handler) => {
      if (!bridge) return () => undefined;
      const dispose = bridge.window.onCloseRequested(() => {
        // 主进程已经拦下了这次关闭；这里只把决定权交给调用方。
        handler({ preventDefault: () => undefined });
      });
      return () => { dispose(); };
    },
  };
}
