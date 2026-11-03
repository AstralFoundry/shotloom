import { t } from '@/i18n';
import type { VideoEditorProject } from "./videoEditorTypes";

export function editorMediaClock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "00:00";
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60).toString().padStart(2, "0");
  const rest = (total % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
}

export interface ClipExportPreset {
  id: string;
  label: string;
  desc: string;
  recommended?: boolean;
  /** 目标画布尺寸；缺省表示沿用工程自己的 settings。 */
  size?: { width: number; height: number; fps: number };
}

/** Presets apply to one export, never to the editable project settings. */
export function clipExportPresets(project: unknown): ClipExportPreset[] {
  const source = project && typeof project === "object" ? project as VideoEditorProject : null;
  const settings = source?.settings;
  const match: ClipExportPreset = settings
    ? {
        id: "match",
        label: t("ui.editorMediaPresentation.label.a03ff92e"),
        desc: t("ui.editorMediaPresentation.text.59575f8b", { value0: settings.width, value1: settings.height }),
        recommended: true,
      }
    : { id: "match", label: t("ui.editorMediaPresentation.label.a03ff92e"), desc: t("ui.editorMediaPresentation.desc.88124080"), recommended: true };
  return [
    match,
    ...(settings && settings.height > settings.width ? [] : [{ id: "4k", label: t("ui.editorMediaPresentation.label.41e3fe20"), desc: "3840×2160 - YouTube 4K", size: { width: 3840, height: 2160, fps: 30 } }]),
    { id: "1080p60", label: "1080p 60fps", desc: t("ui.editorMediaPresentation.desc.d7122cf9"), size: { width: 1920, height: 1080, fps: 60 } },
  ];
}

