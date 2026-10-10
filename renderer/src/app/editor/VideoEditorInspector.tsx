import { IconSymbol } from "../components/IconSymbol";
import { trackMeta } from "./videoEditorCatalog";
import { VideoEditorPanelHeading } from "./VideoEditorPanelHeading";
import type {
  VideoEditorClip,
  VideoEditorProject,
  VideoEditorTrack,
  VideoEditorTransform,
} from "./videoEditorTypes";

export interface VideoEditorSelection {
  clip: VideoEditorClip;
  track: VideoEditorTrack;
  index: number;
}

const canvasPresets = [
  { label: "9:16", width: 1080, height: 1920 },
  { label: "1:1", width: 1080, height: 1080 },
  { label: "16:9", width: 1920, height: 1080 },
] as const;

// 画布格式属于工程级设置，与是否选中片段无关，因此不放进选中态分支。
function CanvasFormatSection({
  project,
  onUpdateSettings,
}: {
  project: VideoEditorProject;
  onUpdateSettings: (patch: { width: number; height: number }) => void;
}) {
  return (
    <div className="ov-project-facts">
      <span>工程画布</span>
      <strong>{project.settings.width} × {project.settings.height}</strong>
      <div className="ov-canvas-presets">
        {canvasPresets.map((preset) => {
          const active = project.settings.width === preset.width
            && project.settings.height === preset.height;
          return (
            <button
              key={preset.label}
              type="button"
              className={active ? "active" : ""}
              title={`${preset.label} · ${preset.width}×${preset.height}`}
              onClick={() => onUpdateSettings({ width: preset.width, height: preset.height })}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      <small>{project.settings.fps} FPS · JSON v{project.version}</small>
    </div>
  );
}

export function VideoEditorInspector({
  selected,
  project,
  onUpdate,
  onDelete,
  onDuplicate,
  onCanvasAction,
  onUpdateSettings,
}: {
  selected: VideoEditorSelection | null;
  project: VideoEditorProject;
  onUpdate: (updates: Record<string, unknown>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onCanvasAction: (action: "centerClip" | "fitClip" | "coverClip") => void;
  onUpdateSettings: (patch: { width: number; height: number }) => void;
}) {
  if (!selected) {
    return (
      <aside className="ov-inspector is-empty">
        <div className="ov-inspector-empty">
          <IconSymbol name="cursor" />
          <strong>选择一个片段</strong>
          <span>在时间线或画布中选择内容后编辑参数</span>
        </div>
        <CanvasFormatSection project={project} onUpdateSettings={onUpdateSettings} />
      </aside>
    );
  }
  const clip = selected.clip;
  const transform: Partial<VideoEditorTransform> = clip.transform || {};
  const isVisual = ["video", "image", "text"].includes(clip.type);
  return (
    <aside className="ov-inspector">
      <VideoEditorPanelHeading title="检查器" count={1} />
      <div className="ov-selected">
        <i>{trackMeta[selected.track.type]?.code}</i>
        <div>
          <strong>{clip.type === "text" ? clip.text : clip.type}</strong>
          <small>{clip.id}</small>
        </div>
      </div>
      <div className="ov-inspector-section">
        <h4>时间</h4>
        <label>
          <span>开始</span>
          <input
            type="number"
            min="0"
            step=".1"
            value={clip.timelineStart}
            onChange={(event) =>
              onUpdate({ timelineStart: Number(event.target.value) })}
          />
        </label>
        {!["video", "audio"].includes(clip.type) && (
          <label>
            <span>时长</span>
            <input
              type="number"
              min=".08"
              step=".1"
              value={clip.duration}
              onChange={(event) =>
                onUpdate({ duration: Number(event.target.value) })}
            />
          </label>
        )}
        {["video", "audio"].includes(clip.type) && (
          <>
            <label>
              <span>速度</span>
              <select
                value={clip.speed || 1}
                onChange={(event) =>
                  onUpdate({ speed: Number(event.target.value) })}
              >
                {[.5, .75, 1, 1.25, 1.5, 2].map((rate) => (
                  <option key={rate} value={rate}>{rate}×</option>
                ))}
              </select>
            </label>
            <label className="ov-check">
              <span>保留声音</span>
              <input
                type="checkbox"
                checked={!clip.muted}
                onChange={(event) => onUpdate({ muted: !event.target.checked })}
              />
            </label>
          </>
        )}
      </div>
      {clip.type === "text" && (
        <div className="ov-inspector-section">
          <h4>文字</h4>
          <textarea
            value={clip.text}
            rows={3}
            onChange={(event) => onUpdate({ text: event.target.value })}
          />
          <label>
            <span>字体</span>
            <select
              value={String(clip.style?.fontFamily || "PingFang SC")}
              onChange={(event) =>
                onUpdate({
                  style: { ...clip.style, fontFamily: event.target.value },
                })}
            >
              <option value="PingFang SC">苹方黑体</option>
              <option value="Songti SC">宋体标题</option>
              <option value="Kaiti SC">楷体</option>
              <option value="Hiragino Sans GB">冬青黑体</option>
            </select>
          </label>
          <label>
            <span>字号</span>
            <input
              type="number"
              value={Number(clip.style?.fontSize || 72)}
              onChange={(event) =>
                onUpdate({
                  style: {
                    ...clip.style,
                    fontSize: Number(event.target.value),
                  },
                })}
            />
          </label>
          <label>
            <span>字重</span>
            <select
              value={Number(clip.style?.fontWeight || 600)}
              onChange={(event) =>
                onUpdate({
                  style: { ...clip.style, fontWeight: Number(event.target.value) },
                })}
            >
              <option value="400">常规</option>
              <option value="500">中等</option>
              <option value="600">半粗</option>
              <option value="700">粗体</option>
            </select>
          </label>
          <label>
            <span>对齐</span>
            <select
              value={String(clip.style?.align || "center")}
              onChange={(event) =>
                onUpdate({ style: { ...clip.style, align: event.target.value } })}
            >
              <option value="left">左对齐</option>
              <option value="center">居中</option>
              <option value="right">右对齐</option>
            </select>
          </label>
          <label>
            <span>颜色</span>
            <input
              type="color"
              value={String(clip.style?.color || "#ffffff")}
              onChange={(event) =>
                onUpdate({
                  style: { ...clip.style, color: event.target.value },
                })}
            />
          </label>
        </div>
      )}
      {isVisual && (
        <div className="ov-inspector-section ov-transform-section">
          <h4>画布变换</h4>
          <div className="ov-transform-presets">
            <button title="在画布中居中，不改尺寸" onClick={() => onCanvasAction("centerClip")}>居中</button>
            <button title="等比缩小到画布内，多余部分留边" onClick={() => onCanvasAction("fitClip")}>适应</button>
            <button title="居中裁剪铺满画布" onClick={() => onCanvasAction("coverClip")}>填充</button>
          </div>
          {(["x", "y", "width", "height", "angle", "opacity"] as const).map((
            key,
          ) => (
            <label key={key}>
              <span>
                {({
                  x: "X",
                  y: "Y",
                  width: "宽度",
                  height: "高度",
                  angle: "旋转",
                  opacity: "不透明度",
                })[key]}
              </span>
              <input
                type="number"
                step={key === "opacity" ? .05 : 1}
                value={Number(transform[key] ?? (key === "opacity" ? 1 : 0))}
                onChange={(event) =>
                  onUpdate({
                    transform: {
                      ...transform,
                      [key]: Number(event.target.value),
                    },
                  })}
              />
            </label>
          ))}
        </div>
      )}
      <div className="ov-inspector-actions">
        <button onClick={onDuplicate}>复制片段</button>
        <button className="danger" onClick={onDelete}>
          <IconSymbol name="trash" />删除
        </button>
      </div>
      <CanvasFormatSection project={project} onUpdateSettings={onUpdateSettings} />
    </aside>
  );
}
