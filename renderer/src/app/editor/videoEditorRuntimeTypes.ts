import type { MutableRefObject } from "react";

export interface VideoEditorRuntime {
  replaceProject: (project: unknown) => void;
  selectClip: (id: string) => void;
  updateClip: (id: string, updates: Record<string, unknown>) => Promise<unknown>;
  resetView: () => void;
  seek: (seconds: number) => Promise<unknown>;
  play: () => Promise<unknown>;
  pause: () => void;
  frameNext: () => Promise<unknown>;
  framePrev: () => Promise<unknown>;
  destroy: () => void;
}

export type VideoEditorRuntimeRef = MutableRefObject<VideoEditorRuntime | null>;
