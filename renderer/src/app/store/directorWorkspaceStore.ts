import { create } from "zustand";

/**
 * 画布工作区里的整页 3D 导演台开关。它不改 AppShell 的顶层路由：
 * 侧栏高亮仍停在「画布」，内容区临时让给导演台，关闭后回到同一个画布。
 */
interface DirectorWorkspaceState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useDirectorWorkspaceStore = create<DirectorWorkspaceState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
