import { create } from "zustand";

export type AppRoute =
  | "projects"
  | "skills"
  | "plugins"
  | "creation"
  | "tasks"
  | "assets"
  | "materials";

// 技能是全局目录，不隶属任何工程，因此进入它不要求先打开工程。
const PROJECT_FREE_ROUTES = new Set<AppRoute>(["projects", "skills", "plugins"]);

export interface ProjectSummary {
  id: string;
  name: string;
  filePath: string | null;
  projectDir: string | null;
  nodeCount: number;
  edgeCount: number;
}

interface AppState {
  assetBrowserRequest: { scope: 'library' | 'local'; category: string; name: string; assetId: string } | null;
  revealAsset: (scope: 'library' | 'local', category: string, name: string, assetId: string) => void;
  clearAssetBrowserRequest: () => void;
  route: AppRoute;
  openingProjectPath: string | null;
  setOpeningProjectPath: (path: string | null) => void;
  assetCategory: string;
  assetKeyword: string;
  sidebarCollapsed: boolean;
  canvasPromptFontSize: number;
  setCanvasPromptFontSize: (size: number) => void;
  currentProject: ProjectSummary | null;
  setRoute: (route: AppRoute) => boolean;
  setAssetCategory: (category: string) => void;
  toggleSidebar: () => void;
  setCurrentProject: (project: ProjectSummary | null) => void;
}

const SIDEBAR_KEY = "shotloom:sidebar-collapsed";
const PROMPT_FONT_SIZE_KEY = "shotloom:canvas-prompt-font-size";

function initialPromptFontSize() {
  const size = typeof window === "undefined" ? 0 : Number(window.localStorage.getItem(PROMPT_FONT_SIZE_KEY));
  return Number.isInteger(size) && size >= 10 && size <= 20 ? size : 16;
}

function initialSidebarState() {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(SIDEBAR_KEY) !== "0";
}

export const useAppStore = create<AppState>((set, get) => ({
  assetBrowserRequest: null,
  revealAsset: (scope, category, name, assetId) => set({ assetBrowserRequest: { scope, category, name, assetId } }),
  clearAssetBrowserRequest: () => set({ assetBrowserRequest: null }),
  route: "projects",
  openingProjectPath: null,
  setOpeningProjectPath: (openingProjectPath) => set({ openingProjectPath }),
  assetCategory: "characters",
  assetKeyword: "",
  sidebarCollapsed: initialSidebarState(),
  canvasPromptFontSize: initialPromptFontSize(),
  setCanvasPromptFontSize: (canvasPromptFontSize) => {
    window.localStorage.setItem(PROMPT_FONT_SIZE_KEY, String(canvasPromptFontSize));
    set({ canvasPromptFontSize });
  },
  currentProject: null,
  setRoute: (route) => {
    if (!PROJECT_FREE_ROUTES.has(route) && !get().currentProject) return false;
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
