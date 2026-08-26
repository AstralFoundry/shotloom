import { IconSymbol } from "../components/IconSymbol";
import { effects, textPresets, transitions } from "./videoEditorCatalog";
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
  const importSourceMenu = importMenu ? <ImportSourceMenu onImport={onImport} /> : null;
  if (activeTool === "media") {
    return (
      <>
        <div className="ov-library-heading">
          <strong>素材</strong>
          <span>{allAssets.length}</span>
          <button onClick={() => onToggleImportMenu("all")}><IconSymbol name="download" /> 导入</button>
        </div>
        {importSourceMenu}
        {allAssets.length === 0 && (
          <button className="ov-import" onClick={() => onToggleImportMenu("all")}>
            <IconSymbol name="download" />
            <strong>导入视频、图片或音频</strong>
            <span>点击选择本地文件</span>
          </button>
        )}
        <div className="ov-asset-grid">
          {allAssets.map((asset) => (
            <article key={asset.id} className="ov-asset-card">
              <button className="ov-asset-preview" title="定位到时间线" onClick={() => onActivateAsset(asset)}>
                <span className="ov-asset-thumbnail">
                  {asset.type === "image" ? <img src={asset.sourceUrl} /> : asset.type === "video" ? (
                    asset.id === primaryVideoAssetId && sourceThumbnail ? <img src={sourceThumbnail} /> : (
                      <video
                        src={runtimeMediaUrls[asset.id] || (asset.id === primaryVideoAssetId ? playbackUrl : asset.sourceUrl)}
                        muted
                        playsInline
                        preload="auto"
                        onLoadedData={(event) => {
                          if (asset.id === primaryVideoAssetId && !sourceThumbnail) onCaptureThumbnail(event.currentTarget);
                        }}
                      />
                    )
                  ) : <IconSymbol name="sliders" />}
                </span>
                <strong>{asset.name}</strong>
                <small>{asset.type.toUpperCase()}{asset.duration ? ` · ${formatEditorTime(asset.duration)}` : ""}</small>
              </button>
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
        </div>
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
