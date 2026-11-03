import { t } from '@/i18n';
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
  /** 文本编辑器右侧文本 Agent 面板绑定的节点；为空则不显示面板。 */
  textAgentNodeId?: string;
}
interface OverlayState {
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
    textAgentNodeId: string;
  };
  openMedia: (payload: MediaPayload) => boolean;
  closeMedia: () => void;
}

export const useOverlayStore = create<OverlayState>((set) => ({
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
    textAgentNodeId: "",
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
        title: String(payload.title || t("ui.overlayStore.text.e28fa8da")),
        filePath: String(payload.filePath || ""),
        onSave: payload.onSave || null,
        getTextVersions: payload.getTextVersions || null,
        onRenameVersion: payload.onRenameVersion || null,
        onCopyVersion: payload.onCopyVersion || null,
        onCaptureFrame: payload.onCaptureFrame || null,
        textAgentNodeId: String(payload.textAgentNodeId || ""),
      },
    });
    return true;
  },
  closeMedia: () =>
    set((state) => ({
      media: { ...state.media, open: false, onSave: null },
    })),
}));

export const openMediaViewer = (payload: MediaPayload) =>
  useOverlayStore.getState().openMedia(payload);
