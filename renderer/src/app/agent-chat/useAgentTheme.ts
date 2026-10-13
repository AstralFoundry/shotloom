import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "shotloom:agent-theme";

type Theme = "light" | "dark";

let current: Theme = readStored();
const listeners = new Set<() => void>();

function readStored(): Theme {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 助手面板的明暗偏好。应用其余部分还没有暗色，所以作用域只在面板根元素上。 */
export function useAgentTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(subscribe, () => current, () => current);
  const toggle = useCallback(() => {
    current = current === "dark" ? "light" : "dark";
    try {
      window.localStorage.setItem(STORAGE_KEY, current);
    } catch {
      /* 隐私模式下写入失败只影响记忆，不影响本次切换 */
    }
    listeners.forEach((listener) => listener());
  }, []);
  return [theme, toggle];
}
