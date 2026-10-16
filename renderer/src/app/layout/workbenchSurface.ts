import { useSyncExternalStore } from "react";

/**
 * 剪辑台、文本编辑器和 3D 导演台这类"大工作区"渲染进 shell 内容区里的同一个挂载点，
 * 而不是铺满整个窗口的浮层：左侧导航保持可见，浮层的层叠上下文由 section.content 隔离，
 * 因此不再需要 1500/1100/240 这种应用级 z-index 去盖住其他界面。
 */
let root: HTMLElement | null = null;
const listeners = new Set<() => void>();

export function setWorkbenchSurfaceRoot(next: HTMLElement | null): void {
  if (root === next) return;
  root = next;
  for (const listener of listeners) listener();
}

/** 挂载点在 AppShell 提交后才存在，取不到时调用方本轮不渲染浮层。 */
export function useWorkbenchSurfaceRoot(): HTMLElement | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => root,
    () => null,
  );
}
