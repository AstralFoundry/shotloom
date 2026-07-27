import { create } from "zustand";

export type AppRoute =
  | "projects"
  | "creation"
  | "tasks"
  | "assets"
  | "materials";

export interface ProjectSummary {
  id: string;
  name: string;
  filePath: string | null;
  projectDir: string | null;
  nodeCount: number;
  edgeCount: number;
}

interface AppState {
  route: AppRoute;
  assetCategory: string;
  assetKeyword: string;
  sidebarCollapsed: boolean;
  currentProject: ProjectSummary | null;
  setRoute: (route: AppRoute) => boolean;
  setAssetCategory: (category: string) => void;
  toggleSidebar: () => void;
  setCurrentProject: (project: ProjectSummary | null) => void;
}

const SIDEBAR_KEY = "shotloom:sidebar-collapsed";

function initialSidebarState() {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(SIDEBAR_KEY) !== "0";
}

export const useAppStore = create<AppState>((set, get) => ({
  route: "projects",
  assetCategory: "characters",
  assetKeyword: "",
  sidebarCollapsed: initialSidebarState(),
  currentProject: null,
  setRoute: (route) => {
    if (route !== "projects" && !get().currentProject) return false;
    set({ route });
    return true;
  },
  setAssetCategory: (assetCategory) => set({ assetCategory, assetKeyword: "" }),
  toggleSidebar: () => {
    const sidebarCollapsed = !get().sidebarCollapsed;
    window.localStorage.setItem(SIDEBAR_KEY, sidebarCollapsed ? "1" : "0");
    set({ sidebarCollapsed });
  },
  setCurrentProject: (currentProject) => set({ currentProject }),
}));
