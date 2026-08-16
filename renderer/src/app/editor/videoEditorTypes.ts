export type VideoEditorAssetType = "video" | "audio" | "image";
export type VideoEditorTrackType = "video" | "audio" | "text" | "overlay" | "effect" | "transition";
export type VideoEditorClipType = "video" | "audio" | "text" | "image" | "effect" | "transition";

export interface VideoEditorTransform extends Record<string, unknown> {
  x: number;
  y: number;
  width: number;
  height: number;
  opacity?: number;
  angle?: number;
  zIndex?: number;
}

export interface VideoEditorAsset extends Record<string, unknown> {
  id: string;
  type: VideoEditorAssetType;
  name: string;
  sourceFile?: string;
  sourceUrl: string;
  duration?: number;
  width?: number;
  height?: number;
}

export interface VideoEditorClip extends Record<string, unknown> {
  id: string;
  type: VideoEditorClipType;
  timelineStart: number;
  assetId?: string;
  duration?: number;
  trimStart?: number;
  trimEnd?: number;
  speed?: number;
  muted?: boolean;
  volume?: number;
  text?: string;
  transform?: VideoEditorTransform;
  effects?: string[];
  style?: Record<string, unknown>;
}

export interface VideoEditorTrack extends Record<string, unknown> {
  id: string;
  type: VideoEditorTrackType;
  name: string;
  locked: boolean;
  hidden: boolean;
  muted: boolean;
  clips: VideoEditorClip[];
}

export interface VideoEditorProject extends Record<string, unknown> {
  schema: "shotloom.video-edit";
  version: 2;
  settings: {
    width: number;
    height: number;
    fps: number;
    backgroundColor: string;
    [key: string]: unknown;
  };
  assets: VideoEditorAsset[];
  tracks: VideoEditorTrack[];
  updatedAt: string;
  lastExport?: Record<string, unknown>;
}
