import { useMemo, useState } from "react";
import { IconSymbol } from "../components/IconSymbol";
import { EDITOR_ASSET_DRAG_TYPE, effects, textPresets, transitions } from "./videoEditorCatalog";
import { formatEditorTime } from "./videoEditorFormat";
import { VideoEditorPanelHeading } from "./VideoEditorPanelHeading";
import type { VideoEditorAsset } from "./videoEditorTypes";

type ImportSource = "device" | "library" | "local" | "files";

function ImportSourceMenu({ onImport }: { onImport: (source: ImportSource) => void }) {
  return (
    <div className="ov-import-source-menu">
      <strong>选择素材来源</strong>
      <button onClick={() => onImport("library")}>项目素材</button>
      <button onClick={() => onImport("local")}>通用素材库</button>
      <button onClick={() => onImport("files")}>素材文件</button>
      <button onClick={() => onImport("device")}>本地文件</button>
    </div>
  );
}

export function VideoEditorToolPanel({
  activeTool,
  allAssets,
  stickerAssets,
  importMenu,
  textNotice,
  toolNotice,
  videoClipCount,
  primaryVideoAssetId,
  sourceThumbnail,
  playbackUrl,
  runtimeMediaUrls,
  onToggleImportMenu,
  onImport,
  onActivateAsset,
  onDeleteAsset,
  onCaptureThumbnail,
  onAddText,
  onAddAsset,
  onAddTransition,
  onAddEffect,
}: {
  activeTool: string;
  allAssets: VideoEditorAsset[];
  stickerAssets: VideoEditorAsset[];
  importMenu: "all" | "image" | "";
  textNotice: string;
  toolNotice: string;
  videoClipCount: number;
  primaryVideoAssetId?: string;
  sourceThumbnail: string;
  playbackUrl: string;
  runtimeMediaUrls: Record<string, string>;
  onToggleImportMenu: (kind: "all" | "image") => void;
  onImport: (source: ImportSource) => void;
  onActivateAsset: (asset: VideoEditorAsset) => void;
  onDeleteAsset: (assetId: string) => void;
  onCaptureThumbnail: (video: HTMLVideoElement) => void;
  onAddText: (preset: (typeof textPresets)[number]) => void;
  onAddAsset: (asset: VideoEditorAsset) => void;
  onAddTransition: (key: string) => void;
  onAddEffect: (key: string) => void;
}) {
  const [mediaQuery, setMediaQuery] = useState("");
  const [mediaView, setMediaView] = useState<"grid" | "list">("grid");
  const visibleAssets = useMemo(() => allAssets.filter((asset) =>
    asset.name.toLocaleLowerCase().includes(mediaQuery.trim().toLocaleLowerCase())
  ), [allAssets, mediaQuery]);
  const importSourceMenu = importMenu ? <ImportSourceMenu onImport={onImport} /> : null;
  if (activeTool === "media") {
    return (
      <>
        <div className="ov-library-heading">
          <strong>素材</strong>
          <span>{allAssets.length}</span>
          <button onClick={() => onToggleImportMenu("all")}><IconSymbol name="download" /> 导入</button>
        </div>
        <div className="ov-media-controls">
          <label>
            <IconSymbol name="search" />
            <input value={mediaQuery} onChange={(event) => setMediaQuery(event.target.value)} placeholder="搜索媒体" aria-label="搜索媒体" />
          </label>
          <div role="group" aria-label="素材视图">
            <button type="button" title="宫格视图" aria-pressed={mediaView === "grid"} className={mediaView === "grid" ? "active" : ""} onPointerDown={(event) => event.stopPropagation()} onClick={() => setMediaView("grid")}><IconSymbol name="grid" /></button>
            <button type="button" title="列表视图" aria-pressed={mediaView === "list"} className={mediaView === "list" ? "active" : ""} onPointerDown={(event) => event.stopPropagation()} onClick={() => setMediaView("list")}><IconSymbol name="list" /></button>
          </div>
        </div>
        {importSourceMenu}
        <div className={`ov-asset-grid view-${mediaView}`}>
          {visibleAssets.map((asset) => (
            <article
              key={asset.id}
              className="ov-asset-card"
              draggable
              // 拖到时间线即可落进指针对应的位置；同时写 text/plain 作为回退。
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData(EDITOR_ASSET_DRAG_TYPE, asset.id);
                event.dataTransfer.setData("text/plain", asset.id);
              }}
            >
              {/* 预览区刻意不用 button：Tauri 在 macOS 上跑 WKWebView，从按钮内部发起拖拽不可靠。
                  键盘可达性由 role + tabIndex + Enter/Space 保住。 */}
              <div
                className="ov-asset-preview"
                role="button"
                tabIndex={0}
                title="点击定位到时间线，或拖到时间线上放置"
                onClick={() => onActivateAsset(asset)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onActivateAsset(asset);
                }}
              >
                <span className="ov-asset-thumbnail">
                  {/* 缩略图必须关掉原生拖拽：否则拖起来的是图片本身，
                      dataTransfer 里没有素材 id，时间线的落点判定会拿不到东西。 */}
                  {asset.type === "image"
                    ? <img src={asset.sourceUrl} draggable={false} />
                    : asset.type === "video" ? (
                    asset.id === primaryVideoAssetId && sourceThumbnail
                      ? <img src={sourceThumbnail} draggable={false} />
                      : (
                        <video
                          src={runtimeMediaUrls[asset.id] || (asset.id === primaryVideoAssetId ? playbackUrl : asset.sourceUrl) || undefined}
                          muted
                          playsInline
                          preload="auto"
                          draggable={false}
                          onLoadedData={(event) => {
                            if (asset.id === primaryVideoAssetId && !sourceThumbnail) onCaptureThumbnail(event.currentTarget);
                          }}
                        />
                      )
                  ) : <IconSymbol name="sliders" />}
                </span>
                <strong>{asset.name}</strong>
                <small>{asset.type.toUpperCase()}{asset.duration ? ` · ${formatEditorTime(asset.duration)}` : ""}</small>
              </div>
              <button
                className="ov-asset-delete"
                title="删除素材及其时间线片段"
                aria-label={`删除素材 ${asset.name}`}
                onClick={() => onDeleteAsset(asset.id)}
              >
                <IconSymbol name="trash" />
              </button>
            </article>
          ))}
          {!mediaQuery && <button className="ov-media-add" onClick={() => onToggleImportMenu("all")}><IconSymbol name="upload" /><span>添加媒体</span></button>}
        </div>
        {allAssets.length > 0 && visibleAssets.length === 0 && <p className="ov-media-empty">没有匹配的素材</p>}
      </>
    );
  }
  if (activeTool === "text") {
    return (
      <>
        <VideoEditorPanelHeading title="文字与字幕" count={textPresets.length} />
        <div className="ov-text-presets">
          {textPresets.map((preset) => (
            <button key={preset.id} className={`ov-preset-card text-preset is-${preset.id}`} onClick={() => onAddText(preset)}>
              <strong style={{ fontFamily: preset.fontFamily }}>{preset.name}</strong>
              <span>{preset.sample} · 添加到当前时间</span>
            </button>
          ))}
        </div>
        {textNotice && <div className="ov-text-notice">{textNotice}</div>}
        <p className="ov-panel-note">文字是独立轨道，可在画布中拖动、缩放和旋转。</p>
      </>
    );
  }
  if (activeTool === "stickers") {
    return (
      <>
        <div className="ov-library-heading">
          <strong>贴图</strong>
          <span>{stickerAssets.length}</span>
          <button onClick={() => onToggleImportMenu("image")}><IconSymbol name="download" /> 导入图片</button>
        </div>
        {importSourceMenu}
        <div className="ov-sticker-grid">
          {stickerAssets.map((asset) => (
            <button key={asset.id} onClick={() => onAddAsset(asset)}>
              <img src={asset.sourceUrl} />
              <span>{asset.name}</span>
            </button>
          ))}
        </div>
        {toolNotice && <div className="ov-tool-notice">{toolNotice}</div>}
        <p className="ov-panel-note">点击添加到当前画面；选中后可在检查器调整位置、大小、旋转与透明度。</p>
      </>
    );
  }
  if (activeTool === "transitions") {
    return (
      <>
        <VideoEditorPanelHeading title="转场" count={transitions.length} />
        <div className="ov-preset-list">
          {transitions.map((item) => (
            <button key={item.key} onClick={() => onAddTransition(item.key)} disabled={videoClipCount < 2}>
              <i /><strong>{item.name}</strong><small>{item.key}</small>
            </button>
          ))}
        </div>
        {toolNotice && <div className="ov-tool-notice">{toolNotice}</div>}
        <p className="ov-panel-note">
          {videoClipCount < 2 ? "当前只有一段视频。先移动播放头并切分，或添加第二段视频素材。" : "选择接缝后的片段并应用，转场会连接前后两段视频。"}
        </p>
      </>
    );
  }
  return (
    <>
      <VideoEditorPanelHeading title="视觉特效" count={effects.length} />
      <div className="ov-preset-list">
        {effects.map((item) => (
          <button key={item.key} onClick={() => onAddEffect(item.key)}>
            <i className="effect-swatch" /><strong>{item.name}</strong><small>{item.key}</small>
          </button>
        ))}
      </div>
      {toolNotice && <div className="ov-tool-notice">{toolNotice}</div>}
      <p className="ov-panel-note">特效从当前播放头开始，应用后可直接在画布预览。</p>
    </>
  );
}
