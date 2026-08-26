import { IconSymbol } from "../components/IconSymbol";
import { tools } from "./videoEditorCatalog";
import type { VideoEditorAsset } from "./videoEditorTypes";

export function VideoEditorTopBar({
  title,
  trackCount,
  canUndo,
  canRedo,
  exporting,
  exportDisabled,
  exportError,
  onUndo,
  onRedo,
  onResetView,
  onClose,
  onExport,
}: {
  title: string;
  trackCount: number;
  canUndo: boolean;
  canRedo: boolean;
  exporting: boolean;
  exportDisabled: boolean;
  exportError: string;
  onUndo: () => void;
  onRedo: () => void;
  onResetView: () => void;
  onClose: () => void;
  onExport: () => void;
}) {
  return (
    <header className="ov-topbar">
      <div className="ov-brand">
        <span><IconSymbol name="film" /></span>
        <div>
          <strong>{title}</strong>
          <small>{trackCount} 条轨道 · 自动保存</small>
        </div>
      </div>
      <div className="ov-history">
        <button title="撤销" aria-label="撤销" disabled={!canUndo} onClick={onUndo}>
          <IconSymbol name="undo" />
        </button>
        <button title="重做" aria-label="重做" disabled={!canRedo} onClick={onRedo}>
          <IconSymbol name="redo" />
        </button>
        <button title="重置画布视图" aria-label="重置画布视图" onClick={onResetView}>
          <IconSymbol name="maximize" />
        </button>
      </div>
      <div className="ov-actions">
        {exportError && <span>{exportError}</span>}
        <button disabled={exporting} onClick={onClose}>关闭</button>
        <button className="primary" disabled={exporting || exportDisabled} onClick={onExport}>
          <IconSymbol name="download" />
          {exporting ? "正在导出…" : "导出成片"}
        </button>
      </div>
    </header>
  );
}

export function VideoEditorToolRail({
  activeTool,
  onSelect,
}: {
  activeTool: string;
  onSelect: (toolId: string) => void;
}) {
  return (
    <nav className="ov-toolrail">
      {tools.map((tool) => (
        <button
          key={tool.id}
          className={activeTool === tool.id ? "active" : ""}
          onClick={() => onSelect(tool.id)}
        >
          <IconSymbol name={tool.icon} />
          <span>{tool.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function VideoEditorImportBrowser({
  browser,
  onClose,
  onImport,
}: {
  browser: { title: string; items: VideoEditorAsset[]; loading: boolean } | null;
  onClose: () => void;
  onImport: (asset: VideoEditorAsset) => void;
}) {
  if (!browser) return null;
  return (
    <div
      className="ov-import-browser-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="ov-import-browser">
        <header>
          <div>
            <strong>从{browser.title}导入</strong>
            <span>选择一个素材添加到当前剪辑工程</span>
          </div>
          <button onClick={onClose}>关闭</button>
        </header>
        {browser.loading ? (
          <div className="ov-import-browser-empty">正在读取素材…</div>
        ) : browser.items.length ? (
          <div className="ov-import-browser-grid">
            {browser.items.map((asset) => (
              <button key={asset.id} onClick={() => onImport(asset)}>
                <IconSymbol name={asset.type === "video" ? "film" : asset.type === "image" ? "image" : "waveform"} />
                <span>
                  <strong>{asset.name}</strong>
                  <small>
                    {asset.type.toUpperCase()}
                    {asset.duration ? ` · ${formatTime(asset.duration)}` : ""}
                  </small>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="ov-import-browser-empty">这里还没有可导入的素材</div>
        )}
      </section>
    </div>
  );
}

function formatTime(seconds: number) {
  const value = Math.max(0, Number(seconds) || 0);
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${(value % 60).toFixed(1).padStart(4, "0")}`;
}
