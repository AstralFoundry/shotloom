import { create } from "zustand";

export type MediaKind = "image" | "video" | "text";
interface MediaPayload {
  src: string;
  kind?: MediaKind;
  title?: string;
  filePath?: string;
  onSave?: (text: string) => void;
}
interface OverlayState {
  toast: string;
  media: {
    open: boolean;
    src: string;
    kind: MediaKind;
    title: string;
    filePath: string;
    onSave: ((text: string) => void) | null;
  };
  toastTimer: number | null;
  showToast: (message: string) => void;
  openMedia: (payload: MediaPayload) => boolean;
  closeMedia: () => void;
}

export const useOverlayStore = create<OverlayState>((set, get) => ({
  toast: "",
  toastTimer: null,
  media: {
    open: false,
    src: "",
    kind: "image",
    title: "",
    filePath: "",
    onSave: null,
  },
  showToast: (message) => {
    if (get().toastTimer) window.clearTimeout(get().toastTimer!);
    const toastTimer = window.setTimeout(
      () => set({ toast: "", toastTimer: null }),
      2400,
    );
    set({ toast: String(message || ""), toastTimer });
  },
  openMedia: (payload) => {
    const src = String(payload.src || "").trim();
    if (!src) return false;
    set({
      media: {
        open: true,
        src,
        kind: payload.kind === "video" || payload.kind === "text"
          ? payload.kind
          : "image",
        title: String(payload.title || "媒体预览"),
        filePath: String(payload.filePath || ""),
        onSave: payload.onSave || null,
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
export const openMediaViewer = (payload: MediaPayload) =>
  useOverlayStore.getState().openMedia(payload);
