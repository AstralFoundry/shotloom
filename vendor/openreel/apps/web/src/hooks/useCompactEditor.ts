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

// 宿主桌面保留完整布局，手机使用现有的预览与面板切换。
function getSnapshot(): boolean {
  if (isShotloomMode) return window.matchMedia('(max-width: 700px), (max-width: 920px) and (max-height: 500px)').matches;
  return window.innerWidth <= 1100 || window.matchMedia(COMPACT_EDITOR_QUERY).matches;
}

export function useCompactEditor(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
