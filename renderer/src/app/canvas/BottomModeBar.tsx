import { t } from '@/i18n';
import { Checkbox } from "antd";
import { useState } from "react";
import type { AgentLayoutMode } from "../../services/agentLayoutService";
import { IconSymbol } from "../components/IconSymbol";

interface BottomModeBarProps {
  canUndo: boolean;
  canRedo: boolean;
  shortcutLabels: { fitView: string; autoLayout: string };
  onUndo: () => void;
  onRedo: () => void;
  onMaterialPicker: () => void;
  onAutoLayout: (options?: { mode?: AgentLayoutMode; includeConnected?: boolean }) => boolean;
  onMergeVideos: () => void;
  onCreateSection?: () => void;
}
export function BottomModeBar(
  {
    canUndo,
    canRedo,
    shortcutLabels,
    onUndo,
    onRedo,
    onMaterialPicker,
    onAutoLayout,
    onMergeVideos,
    onCreateSection,
  }: BottomModeBarProps,
) {
  const [help, setHelp] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [includeConnected, setIncludeConnected] = useState(true);
  const [layoutConfirmation, setLayoutConfirmation] = useState(false);
  const shortcuts = [
    { label: t("ui.BottomModeBar.label.a187522f"), keys: shortcutLabels.fitView },
    { label: t("ui.canvasAdapter.text.7ea05931"), keys: shortcutLabels.autoLayout },
    { label: t("ui.BottomModeBar.label.d4e529ba"), keys: "⌘/Ctrl Z · ⇧⌘/Ctrl Z" },
    { label: t("ui.BottomModeBar.label.b3222c83"), keys: "⌘/Ctrl C · ⌘/Ctrl V" },
    { label: t("ui.BottomModeBar.label.97d81e5f"), keys: "⌘/Ctrl V" },
    { label: t("ui.BottomModeBar.label.49294c14"), keys: "⇧⌘/Ctrl C" },
    { label: t("ui.BottomModeBar.label.312a774f"), keys: t("ui.BottomModeBar.keys.dec115af") },
    { label: t("ui.BottomModeBar.label.602f4575"), keys: "⌘/Ctrl L" },
    { label: t("ui.BottomModeBar.label.156b0106"), keys: "⌘/Ctrl A · ⇧⌘/Ctrl A" },
    { label: t("ui.BottomModeBar.label.9649c108"), keys: "⌘/Ctrl Enter · ⇧⌘/Ctrl Enter" },
    { label: t("ui.BottomModeBar.label.96ae473a"), keys: t("ui.BottomModeBar.keys.8ce999e3") },
    { label: t("ui.BottomModeBar.label.600601f7"), keys: "Delete · Esc" },
  ];
  return (
    <div className="bottom-mode-switch">
      <div className="bottom-mode-group">
        <button title={t("ui.BottomModeBar.title.9fcefd8d")} disabled={!canUndo} onClick={onUndo}>
          <IconSymbol name="undo" />
        </button>
        <button title={t("ui.BottomModeBar.title.1238f0d3")} disabled={!canRedo} onClick={onRedo}>
          <IconSymbol name="redo" />
        </button>
      </div>
      <div className="bottom-mode-divider" />
      <div className="bottom-mode-group">
        <button title={t('canvas.section.createHint')} aria-label={t('canvas.section.create')} onClick={onCreateSection}>
          <IconSymbol name="layers" />
        </button>
        <button
          className="bottom-material-trigger"
          title={t("ui.BottomModeBar.title.23678ecb")}
          aria-label={t("ui.BottomModeBar.title.23678ecb")}
          onClick={onMaterialPicker}
        >
          <IconSymbol name="folder" />
        </button>
        <button
          title={t("ui.BottomModeBar.title.a5727ff5")}
          className={layoutOpen ? "active" : ""}
          onClick={() => {
            setHelp(false);
            setLayoutOpen((value) => !value);
          }}
        >
          <IconSymbol name="columns" />
        </button>
      </div>
      <div className="bottom-mode-divider" />
      <div className="bottom-mode-group">
        <button title={t("ui.BottomModeBar.title.18ba6fed")} onClick={onMergeVideos}>
          <IconSymbol name="link" />
        </button>
        <button
          title={t("ui.BottomModeBar.title.31e33107")}
          className={help ? "active" : ""}
          onClick={() => setHelp((value) => !value)}
        >
          <IconSymbol name="help" />
        </button>
      </div>
      {layoutOpen && (
        <div className="canvas-layout-menu" onClick={(event) => event.stopPropagation()}>
          <strong>{t("ui.BottomModeBar.text.cdb29857")}</strong>
          <span>{t("ui.BottomModeBar.text.ffa60850")}</span>
          <div className="canvas-layout-options">
            {([
              ["workflow", t("ui.BottomModeBar.text.22181626"), "workflow"],
              ["horizontal", t("ui.BottomModeBar.text.5f14560d"), "columns"],
              ["vertical", t("ui.BottomModeBar.text.f96695fe"), "list"],
              ["grid", t("ui.BottomModeBar.text.cd1bbb12"), "grid"],
            ] as const).map(([mode, label, icon]) => (
              <button
                key={mode}
                onClick={() => {
                  const changed = onAutoLayout({ mode, includeConnected });
                  setLayoutOpen(false);
                  setLayoutConfirmation(changed);
                }}
              >
                <IconSymbol name={icon} />
                {label}
              </button>
            ))}
          </div>
          <div className="canvas-layout-connected">
            <Checkbox
              checked={includeConnected}
              onChange={(event) => setIncludeConnected(event.target.checked)}
            >
              {t("ui.BottomModeBar.text.df42ff54")}
            </Checkbox>
          </div>
        </div>
      )}
      {layoutConfirmation && (
        <div className="canvas-layout-confirm" onClick={(event) => event.stopPropagation()}>
          <span>{t("ui.BottomModeBar.text.e64b9a12")}</span>
          <button onClick={() => setLayoutConfirmation(false)}>{t("ui.BottomModeBar.text.d046ac70")}</button>
          <button
            onClick={() => {
              onUndo();
              setLayoutConfirmation(false);
            }}
          >
            {t("ui.BottomModeBar.title.9fcefd8d")}</button>
        </div>
      )}
      {help && (
        <div
          className="canvas-shortcut-help"
          onClick={(e) => e.stopPropagation()}
        >
          <strong>{t("ui.BottomModeBar.text.ad1c63b4")}</strong>
          <dl>
            {shortcuts.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.keys}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
