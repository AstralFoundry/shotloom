import { desktopBridge } from './core.ts';

/**
 * 原生事件订阅，返回取消函数。与 Tauri `listen` 的调用方式一致：
 * handler 收到 `{ payload }`，取消函数在组件卸载时调用。
 */

export type UnlistenFn = () => void;

export interface Event<T> { payload: T }

export async function listen<T>(event: string, handler: (event: Event<T>) => void): Promise<UnlistenFn> {
  const bridge = desktopBridge();
  if (!bridge) return () => undefined;
  const dispose = bridge.listen(event, (payload) => handler({ payload: payload as T }));
  return () => { dispose(); };
}
