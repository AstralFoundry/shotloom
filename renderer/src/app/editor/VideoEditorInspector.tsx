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
export function VideoEditorInspector({
  selected,
  project,
  onUpdate,
  onDelete,
  onDuplicate,
  onCanvasAction,
}: {
  selected: VideoEditorSelection | null;
  project: VideoEditorProject;
  onUpdate: (updates: Record<string, unknown>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onCanvasAction: (action: "centerClip" | "fitClip" | "coverClip") => void;
}) {
  if (!selected) {
    return (
      <aside className="ov-inspector">
        <div className="ov-inspector-empty">
          <IconSymbol name="cursor" />
          <strong>选择一个片段</strong>
          <span>在时间线或画布中选择内容后编辑参数</span>
        </div>
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
            <button onClick={() => onCanvasAction("centerClip")}>居中</button>
            <button onClick={() => onCanvasAction("fitClip")}>适应</button>
            <button onClick={() => onCanvasAction("coverClip")}>填充</button>
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
      <div className="ov-project-facts">
        <span>工程画布</span>
        <strong>{project.settings.width} × {project.settings.height}</strong>
        <small>{project.settings.fps} FPS · JSON v{project.version}</small>
      </div>
    </aside>
  );
}
