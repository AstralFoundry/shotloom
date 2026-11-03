import { useSyncExternalStore } from "react";
import { isShotloomMode } from "../shotloom-mode";

export const COMPACT_EDITOR_QUERY = "(max-width: 1100px), (pointer: coarse) and (max-width: 1366px)";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(COMPACT_EDITOR_QUERY);
  media.addEventListener("change", onChange);
  window.addEventListener("resize", onChange);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener("resize", onChange);
  };
}

// 宿主剪辑台使用容器宽度，保留完整桌面布局。
// 参考实现在同一宽度下依然保留完整的桌面布局，所以宿主模式不参与紧凑版换向。
function getSnapshot(): boolean {
  if (isShotloomMode) return false;
  return window.innerWidth <= 1100 || window.matchMedia(COMPACT_EDITOR_QUERY).matches;
}

export function useCompactEditor(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
