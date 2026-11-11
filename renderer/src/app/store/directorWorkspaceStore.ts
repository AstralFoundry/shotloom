import { create } from "zustand";
import { useAppStore } from './appStore';

const SESSION_KEY = 'shotloom:director-workspace-open';

function rememberOpenProject(open: boolean) {
  try {
    const projectId = useAppStore.getState().currentProject?.id;
    if (open && projectId) window.localStorage.setItem(SESSION_KEY, projectId);
    else window.localStorage.removeItem(SESSION_KEY);
  } catch { /* browser storage unavailable */ }
}

/**
 * 画布工作区里的整页 3D 导演台开关。它不改 AppShell 的顶层路由：
 * 侧栏高亮仍停在「画布」，内容区临时让给导演台，关闭后回到同一个画布。
 */
interface DirectorWorkspaceState {
  open: boolean;
  setOpen: (open: boolean) => void;
  restoreForProject: (projectId: string) => void;
}

export const useDirectorWorkspaceStore = create<DirectorWorkspaceState>((set) => ({
  open: false,
  setOpen: (open) => {
    rememberOpenProject(open);
    set({ open });
  },
  restoreForProject: (projectId) => {
    try { set({ open: window.localStorage.getItem(SESSION_KEY) === projectId }); }
    catch { set({ open: false }); }
  },
}));
