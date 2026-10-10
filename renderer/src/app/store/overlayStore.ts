import { create } from "zustand";

export type MediaKind = "image" | "video" | "text";
interface MediaPayload {
  src: string;
  kind?: MediaKind;
  title?: string;
  filePath?: string;
  onSave?: (text: string) => void;
  getTextVersions?: () => Array<{ id: string; content: string; createdAt: string; name?: string }>;
  onRenameVersion?: (id: string, name: string) => boolean;
  onCopyVersion?: (id: string) => boolean;
  onCaptureFrame?: (seconds: number) => void | Promise<void>;
}
interface OverlayState {
  toast: string;
  toastTone: "default" | "success";
  media: {
    open: boolean;
    src: string;
    kind: MediaKind;
    title: string;
    filePath: string;
    onSave: ((text: string) => void) | null;
    getTextVersions: (() => Array<{ id: string; content: string; createdAt: string; name?: string }>) | null;
    onRenameVersion: ((id: string, name: string) => boolean) | null;
    onCopyVersion: ((id: string) => boolean) | null;
    onCaptureFrame: ((seconds: number) => void | Promise<void>) | null;
  };
  toastTimer: number | null;
  showToast: (message: string, tone?: "default" | "success") => void;
  openMedia: (payload: MediaPayload) => boolean;
  closeMedia: () => void;
}

export const useOverlayStore = create<OverlayState>((set, get) => ({
  toast: "",
  toastTone: "default",
  toastTimer: null,
  media: {
    open: false,
    src: "",
    kind: "image",
    title: "",
    filePath: "",
    onSave: null,
    getTextVersions: null,
    onRenameVersion: null,
    onCopyVersion: null,
    onCaptureFrame: null,
  },
  showToast: (message, tone = "default") => {
    if (get().toastTimer) window.clearTimeout(get().toastTimer!);
    const toastTimer = window.setTimeout(
      () => set({ toast: "", toastTone: "default", toastTimer: null }),
      tone === "success" ? 3600 : 2400,
    );
    set({ toast: String(message || ""), toastTone: tone, toastTimer });
  },
  openMedia: (payload) => {
    const kind = payload.kind === "video" || payload.kind === "text" ? payload.kind : "image";
    const src = String(payload.src || "");
    if (kind !== "text" && !src.trim()) return false;
    set({
      media: {
        open: true,
        src,
        kind,
        title: String(payload.title || "媒体预览"),
        filePath: String(payload.filePath || ""),
        onSave: payload.onSave || null,
        getTextVersions: payload.getTextVersions || null,
        onRenameVersion: payload.onRenameVersion || null,
        onCopyVersion: payload.onCopyVersion || null,
        onCaptureFrame: payload.onCaptureFrame || null,
      },
    });
    return true;
  },
  closeMedia: () =>
    set((state) => ({
      media: { ...state.media, open: false, onSave: null },
    })),
}));

export const showToast = (message: string) =>
  useOverlayStore.getState().showToast(message);
export const showSuccessToast = (message: string) =>
  useOverlayStore.getState().showToast(message, "success");
export const openMediaViewer = (payload: MediaPayload) =>
  useOverlayStore.getState().openMedia(payload);
