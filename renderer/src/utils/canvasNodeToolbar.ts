import { t } from '../i18n/index.ts';
import type { IconName } from "@/app/components/IconSymbol";

/**
 * 画布节点选中工具条的唯一契约：有哪些工具、用户把它们排成什么样。
 *
 * 工具清单与自定义排布放在一个模块里，是因为二者互相定义对方：
 * 排布的合法取值来自清单，清单里哪些按钮真的出现又由排布决定。
 *
 * 这里不判断"当前节点能不能执行某个工具"——那需要真实媒体与运行状态，
 * 由 CanvasNodeToolbar 的 wiring 解析负责。解析不出 wiring 的工具不渲染按钮，
 * 也不进 ⋮ 溢出清单，但它仍然是全局排布偏好里的一项：编辑工具栏弹窗改的是
 * "这类节点该显示哪些工具"，与某个具体节点此刻能不能跑是两件事。
 *
 * 本模块属于 utils：设置域要在这里规范化磁盘值，界面要在这里读清单，
 * 两边必须消费同一份定义，不能有第二份。
 */

export type NodeToolbarScope = "image" | "video";

/**
 * 交互类别决定按钮的 aria 角色与弹层归属，不决定权限，也不用来猜用户意图。
 */
export type NodeToolInteraction =
  | "instant"
  | "opens_mode"
  | "opens_dialog"
  | "opens_panel"
  | "side_effect";

export interface NodeToolDefinition {
  id: string;
  label: string;
  icon: IconName;
  interaction: NodeToolInteraction;
}

/**
 * 右侧固定区（存为资产、加入对话、打开完整文本）把结果交还给产品，不加工素材本身，
 * 因此不在这张可自定义清单里，也不参与持久排布——它们由 CanvasNodeToolbar 直接呈现。
 */

export const NODE_TOOLBAR_TOOLS: Record<NodeToolbarScope, NodeToolDefinition[]> = {
  image: [
    { id: "crop", label: t("ui.ImageCropEditor.text.f06f360f"), icon: "crop", interaction: "opens_mode" },
    { id: "annotate", label: t("ui.canvasMediaActions.suffix.c57f2cf0"), icon: "pencil", interaction: "opens_mode" },
    { id: "split-grid", label: t("ui.canvasMediaActions.text.08b65689"), icon: "grid", interaction: "opens_mode" },
    { id: "watermark", label: t("ui.canvasMediaActions.suffix.d52f4ea8"), icon: "stamp", interaction: "opens_panel" },
    { id: "angle", label: t("imageRecipe.tool.angle.label"), icon: "camera", interaction: "opens_panel" },
    { id: "lighting", label: t("imageRecipe.tool.lighting.label"), icon: "sun", interaction: "opens_panel" },
    { id: "mask-edit", label: t("imageMask.tool.label"), icon: "brush", interaction: "opens_mode" },
    { id: "emotion", label: t("imageEmotion.tool.label"), icon: "smile", interaction: "opens_mode" },
    { id: "reverse-prompt", label: t("imageReverse.tool.label"), icon: "scan-text", interaction: "instant" },
    { id: "history", label: t("imageHistory.tool.label"), icon: "clock", interaction: "opens_dialog" },
  ],
  video: [
    { id: "clip", label: t("ui.videoEditorActions.text.801f1d23"), icon: "scissors", interaction: "side_effect" },
    { id: "extract-frame", label: t("ui.canvasNodeToolbar.label.4ee06a4b"), icon: "camera", interaction: "opens_mode" },
    { id: "extract-audio", label: t("ui.CanvasNodeToolbar.text.4fcd8517"), icon: "waveform", interaction: "instant" },
  ],
};

export const NODE_TOOLBAR_DEFAULT_PINNED: Record<NodeToolbarScope, string[]> = {
  image: ["crop", "annotate", "split-grid", "watermark", "angle", "lighting", "mask-edit", "emotion", "reverse-prompt", "history"],
  video: ["clip", "extract-frame", "extract-audio"],
};

export const CANVAS_TOOLBAR_LAYOUT_VERSION = 1;

export interface CanvasToolbarCustomization {
  layoutVersion: number;
  showLabels: boolean;
  pinned: Record<NodeToolbarScope, string[]>;
}

const SCOPES = Object.keys(NODE_TOOLBAR_TOOLS) as NodeToolbarScope[];

export function nodeToolbarScope(nodeType: unknown): NodeToolbarScope | null {
  if (nodeType === "imageGeneration") return "image";
  if (nodeType === "videoGeneration") return "video";
  return null;
}

export function nodeToolbarToolIds(scope: NodeToolbarScope) {
  return NODE_TOOLBAR_TOOLS[scope].map((tool) => tool.id);
}

export function nodeToolbarTool(scope: NodeToolbarScope, toolId: string) {
  return NODE_TOOLBAR_TOOLS[scope].find((tool) => tool.id === toolId) || null;
}

export function defaultCanvasToolbarCustomization(): CanvasToolbarCustomization {
  return {
    layoutVersion: CANVAS_TOOLBAR_LAYOUT_VERSION,
    showLabels: false,
    pinned: {
      image: [...NODE_TOOLBAR_DEFAULT_PINNED.image],
      video: [...NODE_TOOLBAR_DEFAULT_PINNED.video],
    },
  };
}

/**
 * 只保留该作用域真实存在的 id 并按首次出现去重。
 * 注册表删掉一个工具之后，磁盘上的旧排布不是错误，它只是不再出现，所以不该报错也不该清空其余项。
 */
function normalizePinned(scope: NodeToolbarScope, value: unknown) {
  const known = new Set(nodeToolbarToolIds(scope));
  if (!Array.isArray(value)) return [...NODE_TOOLBAR_DEFAULT_PINNED[scope]];
  const picked: string[] = [];
  for (const item of value) {
    const id = typeof item === "string" ? item : "";
    if (!known.has(id) || picked.includes(id)) continue;
    picked.push(id);
  }
  return picked;
}

export function normalizeCanvasToolbarCustomization(
  value: unknown = {},
): CanvasToolbarCustomization {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
  // 结构版本对不上就整体回到默认：跨版本的排布没有可以安全搬运的语义。
  if (
    source.layoutVersion !== undefined
    && Number(source.layoutVersion) !== CANVAS_TOOLBAR_LAYOUT_VERSION
  ) {
    return defaultCanvasToolbarCustomization();
  }
  const pinned = source.pinned && typeof source.pinned === "object"
    ? (source.pinned as Record<string, any>)
    : {};
  return {
    layoutVersion: CANVAS_TOOLBAR_LAYOUT_VERSION,
    showLabels: source.showLabels === true,
    pinned: {
      image: normalizePinned("image", pinned.image),
      video: normalizePinned("video", pinned.video),
    },
  };
}

/** ⋮ 更多的溢出项：注册表全量去掉已钉住的，顺序始终来自注册表而不是用户。 */
export function nodeToolbarOverflowIds(scope: NodeToolbarScope, pinned: string[]) {
  const pinnedSet = new Set(pinned);
  return nodeToolbarToolIds(scope).filter((id) => !pinnedSet.has(id));
}

/** 供「编辑工具栏」弹窗按作用域遍历，避免界面自己复制一份作用域清单。 */
export function nodeToolbarScopes() {
  return [...SCOPES];
}
