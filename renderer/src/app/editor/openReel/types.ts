import type { VideoEditorAsset } from "../videoEditorTypes";

export type VideoEditorIntent =
  | { type: "import" }
  | { type: "play" }
  | { type: "export"; target: "canvas" | "local"; presetId: string };

export interface VideoEditorController {
  activate?: () => void;
  persist: (project: Record<string, unknown>) => void;
  close: () => void;
  expand?: () => void;
  consumeIntent?: () => void;
  /**
   * 选择器里的「本地上传」入口：弹操作系统文件框并把选中的文件收进项目。
   * 剪辑台的候选素材来自宿主资源目录（services/editorMediaCatalog），不是这个入口。
   */
  importDeviceFiles?: () => Promise<VideoEditorAsset[]>;
  recoverMediaFile?: (type: VideoEditorAsset["type"]) => Promise<VideoEditorAsset | null>;
  /** 把编辑器内拖入的文件字节写入 Shotloom 项目素材，返回可再次交给剪辑器的资产。 */
  ingestEditorFiles?: (
    files: Array<{ name: string; mime?: string; bytes: ArrayBuffer }>,
  ) => Promise<VideoEditorAsset[]>;
}

export interface VideoEditorWorkspaceProps {
  nodeId: string;
  sessionKey?: string;
  expanded?: boolean;
  canvasNode?: boolean;
  selected?: boolean;
  intent?: VideoEditorIntent;
  title?: string;
  project?: Record<string, unknown>;
  assets?: VideoEditorAsset[];
  controller: VideoEditorController;
  agentPanel?: boolean;
}
