export type OpenReelAssetType = "video" | "audio" | "image";

export type OpenReelAssetPayload = {
  key: string;
  name: string;
  type: OpenReelAssetType;
  mime?: string;
  bytes: ArrayBuffer;
  duration?: number;
  width?: number;
  height?: number;
};

export type OpenReelNativeState = Record<string, unknown>;
export type OpenReelNativeToolResult = {
  ok: boolean; summary: string; data?: unknown;
  error?: { code: string; message: string; recoverable?: boolean };
  image?: { dataUrl: string; mimeType?: string };
  outputs?: Array<{ filePath: string; filename: string; size: number }>;
};

export type OpenReelBridgeState = {
  native: OpenReelNativeState | null;
  overview?: OpenReelNativeState;
  session?: unknown;
  playhead: number;
  selectedClipIds: string[];
  canUndo: boolean;
  canRedo: boolean;
  duration: number;
};

export type OpenReelActionResult = {
  success: boolean;
  validateOnly: boolean;
  results: Array<{ type: string; success: boolean; error?: unknown }>;
  state: OpenReelBridgeState;
  error?: string | undefined;
};

export type OpenReelImportedAsset = {
  key: string;
  mediaId: string;
  name?: string;
  type?: OpenReelAssetType;
  duration?: number;
  width?: number;
  height?: number;
};

export type OpenReelActionCatalog = {
  version: number;
  description: string;
  denylist: string[];
  actions: Array<{ type: string; description: string; params: string }>;
};


export type ClipStudioPresentation = "canvas" | "editor";
export type ClipStudioAnchor = { x: number; y: number; top?: number };
export type ClipStudioLayout = { row: number; rail: number; ruler: number; previewGap: number };
export type ClipStudioAction = { type: string; params?: Record<string, unknown> };
export type ClipStudioExportOptions = { target?: "canvas" | "local"; presetId?: string; format?: "video" | "srt"; anchor?: ClipStudioAnchor };
export type ClipStudioLoadPayload = {
  name: string; width: number; height: number; fps: number; duration: number;
  assets: OpenReelAssetPayload[]; tracks: Array<{
    id: string; type: "video" | "audio" | "image" | "text" | "graphics";
    name: string; locked?: boolean; hidden?: boolean; muted?: boolean;
    clips: Array<{ id: string; mediaKey: string; start: number; duration: number; inPoint: number; outPoint: number; sourceConnectionId?: string; speed?: number; volume?: number; transform?: { x?: number; y?: number; width?: number; height?: number; opacity?: number; angle?: number; fit?: "fit" | "fill" } }>;
    transitions: Array<{ id: string; clipAId: string; clipBId: string; type: string; duration: number }>;
  }>;
  nativeProject?: Record<string, unknown> | null; session?: unknown;
};
export type ClipStudioExportResult = { buffer: ArrayBuffer; mime: string; size: number };
export type NativeExportSettings = {
  width: number; height: number; frameRate: number; totalFrames: number;
  codec: string; format: string; audioSampleRate: number; audioChannels: number;
  proresProfile?: string;
};
export type NativeExportReceipt = { filePath: string; filename: string; size: number; codec: string; format: string };
export type ClipStudioNativeExport = {
  start: (settings: NativeExportSettings) => Promise<string>;
  write: (jobId: string, kind: 'frame' | 'audio', bytes: ArrayBuffer, position: number) => Promise<void>;
  finish: (jobId: string) => Promise<NativeExportReceipt>;
  cancel: (jobId: string) => Promise<void>;
};
export type ClipStudioHost = {
  nativeExport?: ClipStudioNativeExport;
  ready: Promise<void>;
  persistenceKey: string;
  app: { locale?: string; theme?: "light" | "dark" | "auto"; region?: string; onChange?: (listener: (next: { locale?: string; theme?: string }) => void) => () => void };
  project: { changed: () => void; bindFlush: (flush: () => Promise<void>) => () => void };
  storage: { get: (key: string) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void>; delete: (key: string) => Promise<void> };
  media: {
    fetchAgentMedia: (url: string) => Promise<{ bytes: ArrayBuffer; mime: string }>;
    listIncoming: () => Promise<unknown[]>;
    read: (candidate: unknown) => Promise<ArrayBuffer>;
    removeOwned: (assetKey: string) => Promise<void>;
  };
  ui: {
    saveAgentFile: (filename: string, bytes: ArrayBuffer, mime: string) => Promise<{ filePath: string; filename: string; size: number }>;
    notify: (message: string, level?: "info" | "success" | "error") => Promise<void> | void;
    requestImport: () => Promise<void> | void;
    requestExport: (options: ClipStudioExportOptions) => Promise<void> | void;
    requestExpand: () => void; requestActivate: () => void; requestClose: () => void;
    requestRelink: (mediaId: string) => Promise<void> | void;
    ingestFiles: (files: Array<{ name: string; mime?: string; bytes: ArrayBuffer }>) => Promise<OpenReelAssetPayload[]>;
    exitFullscreen?: () => void;
  };
};
export type ClipStudioRuntimeEvents = {
  onState: (state: OpenReelBridgeState) => void;
  onStatus: (phase: string) => void;
  onError: (error: Error) => void;
  onExportProgress: (progress: { phase: string; progress: number }) => void;
};
export type ClipStudioRuntimeController = {
  executeNativeTool: (name: string, input: Record<string, unknown>) => Promise<OpenReelNativeToolResult>;
  ready: Promise<void>;
  load: (payload: ClipStudioLoadPayload) => Promise<OpenReelBridgeState>;
  getState: () => Promise<OpenReelBridgeState>;
  importAssets: (assets: OpenReelAssetPayload[]) => Promise<OpenReelImportedAsset[]>;
  relinkMedia: (mediaId: string, asset: OpenReelAssetPayload) => Promise<OpenReelActionResult>;
  executeActions: (actions: ClipStudioAction[], options?: { validateOnly?: boolean; description?: string }) => Promise<OpenReelActionResult>;
  undo: () => Promise<OpenReelBridgeState>; redo: () => Promise<OpenReelBridgeState>;
  seek: (time: number) => Promise<OpenReelBridgeState>; togglePlayback: () => Promise<void>;
  setPresentation: (presentation: ClipStudioPresentation, layout?: ClipStudioLayout) => void;
  setActive: (active: boolean) => void;
  export: (options?: { format?: "video" | "srt"; settings?: { width?: number; height?: number; fps?: number } }) => Promise<ClipStudioExportResult>;
  cancelExport: () => void;
  getActionCatalog: () => OpenReelActionCatalog;
  dispose: () => Promise<void>;
};
export type ClipStudioRuntimeOptions = {
  root: HTMLElement; shadowRoot: ShadowRoot; host: ClipStudioHost;
  presentation: ClipStudioPresentation; active: boolean; layout?: ClipStudioLayout;
  events: ClipStudioRuntimeEvents;
};
export type ClipStudioRuntimeModule = { createRuntime: (options: ClipStudioRuntimeOptions) => ClipStudioRuntimeController };
