import type { IconName } from "../components/IconSymbol";
import stickerActionUrl from "../../assets/stickers/action.svg?no-inline";
import stickerHeartUrl from "../../assets/stickers/heart.svg?no-inline";
import stickerStarUrl from "../../assets/stickers/star.svg?no-inline";
import type { VideoEditorAsset, VideoEditorProject } from "./videoEditorTypes";
import { videoEditorEffectKeys, videoEditorTransitionKeys } from "../../utils/videoEditorEffects.mjs";

export const tools: Array<{ id: string; label: string; icon: IconName }> = [
  { id: "media", label: "素材", icon: "film" },
  { id: "text", label: "文字", icon: "text" },
  { id: "stickers", label: "图形", icon: "shapes" },
  { id: "effects", label: "特效", icon: "spark" },
  { id: "transitions", label: "转场", icon: "shuffle" },
  { id: "adjust", label: "调整", icon: "sliders" },
];
export const trackMeta: Record<string, { code: string; icon: IconName }> = {
  video: { code: "V", icon: "film" },
  audio: { code: "A", icon: "sliders" },
  text: { code: "T", icon: "text" },
  overlay: { code: "O", icon: "image" },
  effect: { code: "FX", icon: "spark" },
  transition: { code: "TR", icon: "layers" },
};
export const transitions = videoEditorTransitionKeys.map((key, index) => ({ key, name: ["溶解", "方向推移", "方向扭曲", "圆形展开", "像素化", "交叉缩放"][index] }));
export const effects = videoEditorEffectKeys.map((key, index) => ({ key, name: ["暗角", "故障", "像素", "色散", "胶片"][index] }));
export const textPresets = [{
  id: "subtitle",
  name: "清晰字幕",
  sample: "对白字幕",
  fontFamily: "PingFang SC",
  fontSize: 52,
  fontWeight: 600,
  y: .78,
}, {
  id: "cinema",
  name: "银幕标题",
  sample: "银幕标题",
  fontFamily: "Songti SC",
  fontSize: 76,
  fontWeight: 600,
  y: .42,
}, {
  id: "chapter",
  name: "章节标题",
  sample: "第一幕",
  fontFamily: "PingFang SC",
  fontSize: 60,
  fontWeight: 700,
  y: .18,
}];
export const builtInStickers: VideoEditorAsset[] = [{
  id: "sticker-star",
  type: "image",
  name: "明星",
  sourceUrl: stickerStarUrl,
  width: 512,
  height: 512,
}, {
  id: "sticker-action",
  type: "image",
  name: "动作",
  sourceUrl: stickerActionUrl,
  width: 512,
  height: 512,
}, {
  id: "sticker-love",
  type: "image",
  name: "心情",
  sourceUrl: stickerHeartUrl,
  width: 512,
  height: 512,
}];
export const builtInStickerById = new Map(builtInStickers.map((asset) => [asset.id, asset]));

/** 素材面板拖到时间线时使用的拖拽类型；同时写 text/plain 作为回退。 */
export const EDITOR_ASSET_DRAG_TYPE = "application/x-shotloom-editor-asset";

export function applyBuiltInStickerSources(project: VideoEditorProject) {
  for (const asset of project.assets || []) {
    const builtIn = builtInStickerById.get(asset.id);
    if (builtIn) asset.sourceUrl = builtIn.sourceUrl;
  }
  for (const track of project.tracks || []) {
    for (const clip of track.clips || []) {
      const builtIn = clip.assetId ? builtInStickerById.get(clip.assetId) : undefined;
      if (builtIn && clip.type === "image") clip.src = builtIn.sourceUrl;
    }
  }
  return project;
}
