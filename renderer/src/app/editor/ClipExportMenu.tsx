import { t } from '@/i18n';
import { Dropdown, type MenuProps } from "antd";
import { showErrorMessage } from "../../store/notificationStore";
import { clipExportPresets } from "./editorMediaPresentation";

/**
 * 导出菜单由 antd Dropdown 定位：目标分组用 Menu group 同时列出，
 * 不再自己监听 Escape、量尺寸或维护 ResizeObserver。
 */
export function ClipExportMenu({ anchor, project, onClose, onExport }: {
  anchor: { x: number; y: number; top?: number };
  project: unknown;
  onClose: () => void;
  onExport: (options: { target: "canvas" | "local"; presetId?: string; format?: "video" | "srt" }) => Promise<unknown>;
}) {
  const run = (options: Parameters<typeof onExport>[0]) => {
    onClose();
    void onExport(options).catch((cause) => {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      showErrorMessage(cause instanceof Error ? cause.message : String(cause));
    });
  };

  const presetItems = (target: "canvas" | "local") =>
    clipExportPresets(project).map((preset) => ({
      key: `${target}:${preset.id}`,
      label: (
        <span className="clip-export-item">
          <strong>
            {preset.label}
            {preset.recommended ? t("ui.ClipExportMenu.text.a727b813") : ""}
          </strong>
          <span>{preset.desc}</span>
        </span>
      ),
    }));

  const items: MenuProps["items"] = [
    {
      type: "group",
      label: t("ui.ClipExportMenu.text.dc3c7852"),
      children: presetItems("canvas"),
    },
    {
      type: "group",
      label: t("ui.ClipExportMenu.text.bbcd1bff"),
      children: presetItems("local"),
    },
    { type: "divider" },
    { key: "srt", label: t("ui.ClipExportMenu.text.1e20ec9d") },
  ];

  function onClick({ key }: { key: string }) {
    if (key === "srt") return run({ target: "local", format: "srt" });
    const [target, presetId] = key.split(":");
    run({ target: target as "canvas" | "local", presetId: presetId ?? "" });
  }

  return (
    <Dropdown
      open
      trigger={[]}
      placement="bottomRight"
      menu={{ items, onClick }}
      onOpenChange={(open) => { if (!open) onClose(); }}
    >
      <span
        className="clip-export-anchor"
        style={{ position: "fixed", left: anchor.x, top: anchor.y }}
      />
    </Dropdown>
  );
}
