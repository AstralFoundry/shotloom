import { localAssetLibrary, loadLocalAssetLibrary } from '../../store/localAssetLibraryStore';
import { nodeAssetCollections } from '../adapters/canvas/canvasMediaSelection';
import { useAppStore } from '../store/appStore';
import { t } from '@/i18n';
import {
  type CSSProperties,
  type RefObject,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import {
  type ReactFlowState,
  useStore,
} from "@xyflow/react";
import { desktopApi } from "../../services/desktopApi.ts";
import { store } from "../../store/projectStore.ts";
import { subscribeDomain } from "../../store/domainReactivity.ts";
import { settingsStore } from "../../store/settingsStore.ts";
import { selectedTextOutput, textNodeContent } from "../../utils/textNodeContent.ts";
import { canvasNodeToolbarOffset } from "../../utils/canvasNodeChrome.ts";
import {
  NODE_TOOLBAR_TOOLS,
  nodeToolbarOverflowIds,
  nodeToolbarScope,
  type NodeToolDefinition,
} from "../../utils/canvasNodeToolbar.ts";
import { IconSymbol, type IconName } from "../components/IconSymbol";
import { recordCanvasHistory } from "../../store/canvasHistoryStore";
import { assetCategories, assetCategoryFor } from "../../domain/asset/assetCategories";
import { openMediaViewer } from "../store/overlayStore";
import { localMediaPath as mediaFilePath, selectedNodeMedia } from "../../utils/nodeMedia.ts";
import { copyTextNodeVersion, renameTextNodeVersion } from "../adapters/canvasAdapter";
import { CanvasToolbarCustomizeDialog } from "./CanvasToolbarCustomizeDialog";
import type { WorkflowNodeActions, WorkflowNodeData } from "./WorkflowCanvas";

/** Share the canvas stacking context with the detached clip editor and menus. */
function NodeToolbar({ nodeId, root, children, className, isVisible, offset }: {
  nodeId: string;
  root: HTMLElement | null;
  children: ReactNode;
  className: string;
  isVisible: boolean;
  offset: number;
}) {
  const transform = useStore((state) => {
    const node = state.nodeLookup.get(nodeId);
    if (!node) return null;
    const [x, y, zoom] = state.transform;
    const position = node.internals.positionAbsolute;
    const width = node.measured.width ?? node.width ?? 0;
    return `translate(${(position.x + width / 2) * zoom + x}px, ${position.y * zoom + y - offset}px) translate(-50%, -100%)`;
  });
  if (!root || !isVisible || !transform) return null;
  return createPortal(<div
    className={`react-flow__node-toolbar ${className}`}
    data-id={nodeId}
    style={{ position: "absolute", top: 0, left: 0, transform }}
  >{children}</div>, root);
}

type ToolbarMenuAction = {
  id: string;
  label: string;
  icon: IconName;
  disabled?: boolean | undefined;
  separator?: false;
  onSelect: () => void;
};

/**
 * 工具条上的一枚菜单项。⋮ 溢出清单和截帧的取帧位置菜单共用这一种形态，
 * 因此也共用同一套定位与关闭逻辑。
 */
type ToolbarMenuItem = ToolbarMenuAction | { id: string; separator: true };

/**
 * 注册表里的一项在当前节点上到底怎么按。解析不出来的工具不渲染按钮，
 * 也不进入溢出菜单——接线尚未完成时它只是不出现，而不是一个禁用摆设。
 */
interface ResolvedTool {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  /** 真实运行状态会让按钮文字随状态变化，比如音轨检测和拆分进行中。 */
  label?: string;
  /** 自带弹层的工具用 menuKey 认领自己的触发器 ref 和展开状态。 */
  menuKey?: Exclude<OpenMenu, null>;
  menu?: ToolbarMenuItem[];
}

type OpenMenu = "asset" | "frame" | "more" | null;

const MENU_MARGIN = 12;
const MENU_GAP = 7;

function useAnchoredMenuPlacement({
  open,
  root,
  triggerRef,
  menuRef,
  align,
  placementRevision,
}: {
  open: boolean;
  root: HTMLElement | null;
  triggerRef: RefObject<HTMLElement | null>;
  menuRef: RefObject<HTMLElement | null>;
  align: "start" | "end";
  placementRevision: string;
}) {
  const [placement, setPlacement] = useState<CSSProperties>({ visibility: "hidden" });
  useLayoutEffect(() => {
    if (!open || !root) return;
    setPlacement({ visibility: "hidden" });
    const sync = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const menu = menuRef.current;
      const rootBounds = root.getBoundingClientRect();
      if (!trigger || !menu) return;
      const width = menu.offsetWidth;
      const height = menu.offsetHeight;
      const anchorX = align === "end" ? trigger.right : trigger.left;
      const left = Math.max(
        MENU_MARGIN,
        Math.min(rootBounds.width - width - MENU_MARGIN, anchorX - rootBounds.left - (align === "end" ? width : 0)),
      );
      const below = trigger.bottom - rootBounds.top + MENU_GAP;
      const above = trigger.top - rootBounds.top - height - MENU_GAP;
      let top = below;
      if (below + height > rootBounds.height - MENU_MARGIN && above >= MENU_MARGIN) top = above;
      top = Math.max(MENU_MARGIN, Math.min(rootBounds.height - height - MENU_MARGIN, top));
      setPlacement({ left, top, visibility: "visible" });
    };
    const frame = requestAnimationFrame(sync);
    const observer = new ResizeObserver(sync);
    observer.observe(root);
    if (triggerRef.current) observer.observe(triggerRef.current);
    window.addEventListener("resize", sync);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", sync);
    };
    // refs 是稳定对象，它们指向谁由 placementRevision 反映
  }, [open, placementRevision, root, align]);
  return placement;
}

function ToolbarPortalMenu({
  items,
  root,
  menuRef,
  style,
  hidden,
  onClose,
}: {
  items: ToolbarMenuItem[];
  root: HTMLElement | null;
  menuRef: RefObject<HTMLDivElement | null>;
  style: CSSProperties;
  hidden: boolean;
  onClose: () => void;
}) {
  if (!root) return null;
  return createPortal(
    <div
      ref={menuRef}
      className={`canvas-node-toolbar-menu${hidden ? " canvas-node-toolbar-menu--hidden" : ""} nodrag nopan nowheel`}
      role="menu"
      style={style}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {items.map((item) => item.separator ? (
        <span className="canvas-node-toolbar-menu-separator" key={item.id} />
      ) : (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
            item.onSelect();
          }}
        >
          <IconSymbol name={item.icon} />
          <span>{item.label}</span>
        </button>
      ))}
    </div>,
    root,
  );
}

/**
 * 工具条与「编辑工具栏」弹窗读的是设置域里的排布偏好。React Flow 的节点包装是 memo 的，
 * 工作台级的领域通知传不进节点，所以这里必须自己订阅，否则弹窗落盘后背后所见不会变。
 * 快照取排布对象本身而不是全局 revision：画布高频写入不该重渲染每一枚工具条。
 */
function getToolbarCustomization() {
  return settingsStore.canvasToolbarCustomization;
}

export function CanvasNodeToolbar({
  node,
  selected,
  dragging,
  semanticZoom,
  actions,
  addNodeMention,
  canvasOverlayRoot,
  imageCropMode,
  onImageCropOpen,
  imageAnnotationOpen,
  onImageAnnotationOpen,
  imageWatermarkOpen,
  onImageWatermarkOpen,
}: {
  node: WorkflowNodeData;
  selected: boolean;
  dragging: boolean;
  semanticZoom: number;
  actions: WorkflowNodeActions;
  addNodeMention: ((nodeId: string) => void) | null;
  canvasOverlayRoot: HTMLElement | null;
  imageCropMode: "crop" | "grid" | null;
  onImageCropOpen: (mode: "crop" | "grid") => void;
  imageAnnotationOpen: boolean;
  onImageAnnotationOpen: () => void;
  imageWatermarkOpen: boolean;
  onImageWatermarkOpen: () => void;
}) {
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const [assetCategory, setAssetCategory] = useState('other');
  const [collectionBusy, setCollectionBusy] = useState(false);
  const collectionSnapshot = useSyncExternalStore(subscribeDomain,
    () => selected ? JSON.stringify(nodeAssetCollections(store.project, node, localAssetLibrary.catalog)) : '{}',
    () => '{}');
  const collections = JSON.parse(collectionSnapshot);
  const collect = async (scope: 'project' | 'global') => {
    setCollectionBusy(true);
    try { await actions.saveToAssets(node.id, scope, assetCategory); }
    finally { setCollectionBusy(false); }
  };
  const reveal = (scope: 'project' | 'global') => {
    const asset = collections[scope];
    if (!asset) return;
    useAppStore.getState().revealAsset(scope === 'project' ? 'library' : 'local', assetCategoryFor(asset.category).id, asset.name || '', asset.id);
    setOpenMenu(null);
  };
  const [audioTrackState, setAudioTrackState] = useState<
    "idle" | "checking" | "present" | "absent"
  >("idle");
  const [audioSplitRunning, setAudioSplitRunning] = useState(false);
  const [dragReleaseSettling, setDragReleaseSettling] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const assetTriggerRef = useRef<HTMLButtonElement>(null);
  const assetMenuRef = useRef<HTMLDivElement>(null);
  const frameTriggerRef = useRef<HTMLButtonElement>(null);
  const frameMenuRef = useRef<HTMLDivElement>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const nodeChromeHidden = Boolean(dragging || dragReleaseSettling);
  const assetPlacementRevision = useStore((state: ReactFlowState) => {
    const internal = state.nodeLookup.get(node.id);
    const position = internal?.internals.positionAbsolute;
    return [
      ...state.transform,
      Number(position?.x || 0),
      Number(position?.y || 0),
      Number(internal?.measured.width || internal?.width || 0),
      Number(internal?.measured.height || internal?.height || 0),
    ].join(":");
  });
  const localMediaPath = mediaFilePath(selectedNodeMedia(node));
  const canSaveToAssets = Boolean(localMediaPath || (node.type === "textGeneration" && textNodeContent(node)));
  const isLocalVideo = node.type === "videoGeneration" && Boolean(localMediaPath);
  const isLocalImage = node.type === "imageGeneration" && Boolean(localMediaPath);
  const canExtractAudio = isLocalVideo && audioTrackState === "present";
  const scope = nodeToolbarScope(
    isLocalImage ? "imageGeneration" : isLocalVideo ? "videoGeneration" : "",
  );
  const uploadLabels: Record<string, string> = {
    imageGeneration: t("ui.canvasMediaActions.text.be8da62e"),
    videoGeneration: t("ui.canvasMediaActions.text.fa4e33b6"),
    audioGeneration: t("ui.canvasAdapter.label.461189f1"),
  };
  const mediaOutputs = Array.isArray(node.generatedOutputs)
    ? node.generatedOutputs as Array<Record<string, unknown>>
    : [];
  const hasMediaContent = Boolean(
    node.uploadedFile ||
    node.filePath ||
    node.previewUrl ||
    node.url ||
    mediaOutputs.some((output) =>
      output.filePath || output.path || output.previewUrl || output.url || output.remoteUrl
    ),
  );
  const uploadLabel = uploadLabels[node.type] || "";
  const canUpload = Boolean(uploadLabel && !hasMediaContent);
  const isTextNode = node.type === "textGeneration";
  // 3D 导演台在详情面板里和 Agent 一起工作，节点上不再挂引用入口；@ 引用仍然可用。
  const mentionNode = node.type === "threeDDirector" || node.type === "clipStudio" ? null : addNodeMention;
  const useSubtleUploadToolbar = canUpload && !isTextNode;
  const toolbarOffset = canvasNodeToolbarOffset(semanticZoom, useSubtleUploadToolbar);
  const textOutputs = Array.isArray(node.generatedOutputs)
    ? node.generatedOutputs as Array<Record<string, unknown>>
    : [];
  const currentTextOutput = selectedTextOutput(node) as Record<string, unknown> | null;
  const textContent = textNodeContent(node);

  const customization = useSyncExternalStore(
    subscribeDomain,
    getToolbarCustomization,
    getToolbarCustomization,
  );
  const pinnedIds = scope ? customization.pinned[scope] : [];
  const showLabels = customization.showLabels;

  const assetMenuPlacement = useAnchoredMenuPlacement({
    open: openMenu === "asset",
    root: canvasOverlayRoot,
    triggerRef: assetTriggerRef,
    menuRef: assetMenuRef,
    align: "end",
    placementRevision: assetPlacementRevision,
  });
  const frameMenuPlacement = useAnchoredMenuPlacement({
    open: openMenu === "frame",
    root: canvasOverlayRoot,
    triggerRef: frameTriggerRef,
    menuRef: frameMenuRef,
    align: "start",
    placementRevision: assetPlacementRevision,
  });
  const moreMenuPlacement = useAnchoredMenuPlacement({
    open: openMenu === "more",
    root: canvasOverlayRoot,
    triggerRef: moreTriggerRef,
    menuRef: moreMenuRef,
    align: "start",
    placementRevision: assetPlacementRevision,
  });

  useEffect(() => {
    if (!selected) {
      setOpenMenu(null);
      setAssetCategory("");
      setCustomizeOpen(false);
    }
  }, [selected]);

  useEffect(() => {
    if (!openMenu) return;
    const pairs: Record<Exclude<OpenMenu, null>, Array<RefObject<HTMLElement | null>>> = {
      asset: [assetTriggerRef, assetMenuRef],
      frame: [frameTriggerRef, frameMenuRef],
      more: [moreTriggerRef, moreMenuRef],
    };
    const owned = pairs[openMenu];
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && owned.some((ref) => ref.current?.contains(target))) return;
      setOpenMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [openMenu]);

  useEffect(() => {
    if (!selected || !isLocalVideo) {
      setAudioTrackState("idle");
      return;
    }
    let active = true;
    setAudioTrackState("checking");
    void desktopApi.file.hasAudio(localMediaPath).then(
      (hasAudio: boolean) => {
        if (active) setAudioTrackState(hasAudio ? "present" : "absent");
      },
      () => {
        if (active) setAudioTrackState("absent");
      },
    );
    return () => {
      active = false;
    };
  }, [isLocalVideo, localMediaPath, selected]);

  useLayoutEffect(() => {
    if (dragging) {
      setDragReleaseSettling(true);
      return;
    }
    if (!dragReleaseSettling) return;
    let revealFrame = 0;
    let revealTimer = 0;
    const settleFrame = requestAnimationFrame(() => {
      revealFrame = requestAnimationFrame(() => {
        revealTimer = window.setTimeout(() => setDragReleaseSettling(false), 64);
      });
    });
    return () => {
      cancelAnimationFrame(settleFrame);
      if (revealFrame) cancelAnimationFrame(revealFrame);
      if (revealTimer) window.clearTimeout(revealTimer);
    };
  }, [dragReleaseSettling, dragging]);

  function openTextDetail() {
    openMediaViewer({
      src: textContent,
      kind: "text",
      title: String(node.title || t("ui.CanvasNodeToolbar.text.d3321cbb")),
      filePath: String(currentTextOutput?.filePath || ""),
      onSave: (content) => {
        actions.update(node.id, {
          textContent: content,
          generatedOutputs: currentTextOutput
            ? textOutputs.map((output) =>
              output.id === currentTextOutput.id ? { ...output, content } : output
            )
            : textOutputs,
          updatedAt: new Date().toISOString(),
        });
      },
      getTextVersions: () => ((store.project.nodes.find((item: WorkflowNodeData) => item.id === node.id) as WorkflowNodeData | undefined)?.textVersions || []) as Array<{ id: string; content: string; createdAt: string; name?: string }>,
      onRenameVersion: (id, name) => renameTextNodeVersion(node.id, id, name),
      onCopyVersion: (id) => copyTextNodeVersion(node.id, id),
    });
  }

  function captureFrame(seconds: number | 'last') {
    void Promise.resolve(actions.captureVideoFrame(node.id, seconds)).catch((cause) =>
      actions.notify(cause instanceof Error ? cause.message : t("ui.CanvasNodeToolbar.text.22c39936")),
    );
  }

  function resolveTool(tool: NodeToolDefinition): ResolvedTool | null {
    if (!scope) return null;
    switch (tool.id) {
      case "crop":
        return {
          title: t("ui.CanvasNodeToolbar.title.424dce5b"),
          pressed: imageCropMode === "crop",
          onClick: () => onImageCropOpen("crop"),
        };
      case "split-grid":
        return {
          title: t("ui.CanvasNodeToolbar.title.7c040e38"),
          pressed: imageCropMode === "grid",
          onClick: () => onImageCropOpen("grid"),
        };
      case "annotate":
        return {
          title: t("ui.CanvasNodeToolbar.title.8ee90cf6"),
          pressed: imageAnnotationOpen,
          onClick: onImageAnnotationOpen,
        };
      case "watermark":
        return {
          title: t("ui.CanvasNodeToolbar.title.779c0c42"),
          pressed: imageWatermarkOpen,
          onClick: onImageWatermarkOpen,
        };
      case "clip":
        return { title: t("ui.videoEditorActions.text.7a0935e7"), onClick: () => void actions.createClipNode(node.id) };
      case "extract-frame":
        return {
          title: t("ui.CanvasNodeToolbar.title.2a66d8fa"),
          menuKey: "frame",
          onClick: () => setOpenMenu((current) => (current === "frame" ? null : "frame")),
          menu: [
            { id: "frame-first", label: t("ui.CanvasNodeToolbar.label.f19f6b6d"), icon: "camera", onSelect: () => captureFrame(0) },
            { id: "frame-last", label: t("ui.CanvasNodeToolbar.label.35b12241"), icon: "camera", onSelect: () => captureFrame('last') },
          ],
        };
      case "extract-audio":
        return {
          title: audioSplitRunning
            ? t("ui.CanvasNodeToolbar.text.212b005b")
            : canExtractAudio
              ? t("ui.CanvasNodeToolbar.text.9b9c4d64")
              : audioTrackState === "checking"
                ? t("ui.CanvasNodeToolbar.text.a6c78708")
                : t("ui.CanvasNodeToolbar.text.78904ab2"),
          label: audioSplitRunning ? t("ui.CanvasNodeToolbar.text.a40a8b7f") : canExtractAudio ? t("ui.CanvasNodeToolbar.text.4fcd8517") : audioTrackState === "checking" ? t("ui.CanvasNodeToolbar.text.193a94a5") : t("ui.CanvasNodeToolbar.text.dde19df4"),
          disabled: !canExtractAudio || audioSplitRunning,
          onClick: () => {
            setAudioSplitRunning(true);
            void Promise.resolve(actions.extractAudio(node.id)).finally(() =>
              setAudioSplitRunning(false),
            );
          },
        };
      default:
        return null;
    }
  }

  const wired = scope
    ? NODE_TOOLBAR_TOOLS[scope]
        .map((tool) => ({ tool, resolved: resolveTool(tool) }))
        .filter((entry): entry is { tool: NodeToolDefinition; resolved: ResolvedTool } => Boolean(entry.resolved))
    : [];
  const pinnedTools = pinnedIds
    .map((id) => wired.find((entry) => entry.tool.id === id))
    .filter((entry): entry is (typeof wired)[number] => Boolean(entry));
  const overflowTools = scope
    ? nodeToolbarOverflowIds(scope, pinnedIds)
        .map((id) => wired.find((entry) => entry.tool.id === id))
        .filter((entry): entry is (typeof wired)[number] => Boolean(entry))
    : [];
  const customizeItem: ToolbarMenuItem = {
    id: "customize-toolbar",
    label: t("ui.CanvasNodeToolbar.label.17e589f3"),
    icon: "sliders",
    onSelect: () => setCustomizeOpen(true),
  };
  const overflowItems: ToolbarMenuItem[] = overflowTools.map(({ tool, resolved }) => ({
    id: tool.id,
    label: resolved.label || tool.label,
    icon: tool.icon,
    disabled: resolved.disabled,
    onSelect: resolved.onClick,
  }));
  const categoryItems: ToolbarMenuItem[] = assetCategories.map(category => ({
    id: `category-${category.purpose}`,
    label: t('assets.collection.purposeItem', { label: category.label, mark: assetCategoryFor(node.artifactType).id === category.id ? ' ✓' : '' }),
    icon: category.icon,
    onSelect: () => {
      if (assetCategoryFor(node.artifactType).id === category.id) return;
      recordCanvasHistory(t("ui.CanvasNodeToolbar.text.24bc593f"));
      actions.update(node.id, { artifactType: category.purpose });
    },
  }));
  const moreItems: ToolbarMenuItem[] = scope
    ? [...overflowItems, ...(overflowItems.length ? [{ id: "customize-separator", separator: true } as const] : []), customizeItem, { id: "category-separator", separator: true }, ...categoryItems]
    : categoryItems;
  const showMoreButton = categoryItems.length > 0;
  const hasFixedZone = canSaveToAssets || Boolean(mentionNode) || (isTextNode && Boolean(textContent));
  const hasToolbar = isTextNode || canUpload || mentionNode ||
    canSaveToAssets || wired.length > 0;

  const menuTriggerRefs = {
    asset: assetTriggerRef,
    frame: frameTriggerRef,
    more: moreTriggerRef,
  } as const;

  function renderToolButton(entry: (typeof wired)[number]) {
    const { tool, resolved } = entry;
    const label = resolved.label || tool.label;
    return (
      <button
        key={tool.id}
        ref={resolved.menuKey ? menuTriggerRefs[resolved.menuKey] : undefined}
        type="button"
        title={resolved.title}
        aria-haspopup={resolved.menuKey ? "menu" : undefined}
        aria-expanded={resolved.menuKey ? openMenu === resolved.menuKey : undefined}
        aria-pressed={tool.interaction === "opens_mode" ? Boolean(resolved.pressed) : undefined}
        disabled={resolved.disabled}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          resolved.onClick();
        }}
      >
        <IconSymbol name={tool.icon} />
        {showLabels && <span>{label}</span>}
        {resolved.menuKey && <IconSymbol className="canvas-node-asset-chevron" name="chevron-down" />}
      </button>
    );
  }

  return (
    <>
      {hasToolbar && (
        <NodeToolbar
          nodeId={node.id}
          root={canvasOverlayRoot}
          className={`canvas-node-selection-toolbar${useSubtleUploadToolbar ? " canvas-node-selection-toolbar--subtle" : ""}${nodeChromeHidden ? " canvas-node-selection-toolbar--hidden" : ""} nodrag nopan`}
          isVisible={selected && !imageAnnotationOpen}
          offset={toolbarOffset}
        >
          {isTextNode && (
            <>
              <span className="canvas-node-toolbar-label">{t("ui.CanvasNodeToolbar.text.d80ef14f")}</span>
              <button
                className="canvas-node-toolbar-icon"
                type="button"
                title={t("ui.CanvasNodeToolbar.title.ecb629bb")}
                disabled={!textContent}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  void navigator.clipboard.writeText(textContent).then(
                    () => actions.notify(t("ui.CanvasNodeToolbar.text.605dc592")),
                    () => actions.notify(t("ui.CanvasNodeToolbar.text.32f1a7e9")),
                  );
                }}
              >
                <IconSymbol name="copy" />
              </button>
            </>
          )}
          {canUpload && (
            <button
              className="canvas-node-upload-action"
              type="button"
              title={t("ui.CanvasNodeToolbar.text.ec576d13", { value0: uploadLabel })}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                void actions.upload(node.id);
              }}
            >
              <IconSymbol name="upload" />
              <span>{t("ui.CanvasContextMenu.text.a977650d")}{uploadLabel}</span>
            </button>
          )}
          {pinnedTools.map(renderToolButton)}
          {showMoreButton && (
            <button
              ref={moreTriggerRef}
              className="canvas-node-toolbar-icon"
              type="button"
              title={t("ui.CanvasNodeToolbar.title.5c26bd92")}
              aria-haspopup="menu"
              aria-expanded={openMenu === "more"}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                setOpenMenu((current) => (current === "more" ? null : "more"));
              }}
            >
              <IconSymbol name="more" />
            </button>
          )}
          {hasFixedZone && (pinnedTools.length > 0 || canUpload || isTextNode) && (
            <span className="canvas-node-toolbar-divider" />
          )}
          {canSaveToAssets && (
            <div className="canvas-node-asset-action">
              <button
                ref={assetTriggerRef}
                type="button"
                title={t("assets.collection.collect")}
                aria-haspopup="menu"
                aria-expanded={openMenu === "asset"}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  setOpenMenu((current) => {
                    if (current !== "asset") {
                      setAssetCategory(assetCategoryFor(node.artifactType).id);
                      void loadLocalAssetLibrary().catch(error => console.warn('Asset catalog unavailable', error));
                    }
                    return current === "asset" ? null : "asset";
                  });
                }}
              >
                <IconSymbol name="archive" />
                <span>{t("assets.collection.collect")}</span>
                <IconSymbol className="canvas-node-asset-chevron" name="chevron-down" />
              </button>
              {openMenu === "asset" && canvasOverlayRoot && createPortal(
                <div
                  ref={assetMenuRef}
                  className={`canvas-node-asset-scope-menu canvas-node-asset-scope-menu--portal${nodeChromeHidden ? " canvas-node-asset-scope-menu--hidden" : ""} nodrag nopan nowheel`}
                  role="menu"
                  style={assetMenuPlacement}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <header className="canvas-node-asset-menu-head">
                    <IconSymbol name="archive" />
                    <span><strong>{t("assets.collection.collect")}</strong><small>{t("assets.collection.hint")}</small></span>
                  </header>
                  <div className="canvas-node-asset-category-grid">
                    {assetCategories.map((category) => (
                      <button
                        className={assetCategory === category.id ? "active" : ""}
                        key={category.id}
                        type="button"
                        aria-pressed={assetCategory === category.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          setAssetCategory(category.id);
                        }}
                      >
                        <IconSymbol name={category.icon} />
                        <span>{category.label}</span>
                      </button>
                    ))}
                  </div>
                  <div className="canvas-node-asset-destinations">
                    {(['project', 'global'] as const).map(scope => {
                      const saved = collections[scope];
                      const categoryChanged = saved && assetCategoryFor(saved.category).id !== assetCategory;
                      return <div key={scope} className="canvas-node-asset-destination">
                        <strong>{t(scope === 'project' ? 'assets.collection.project' : 'assets.collection.global')}</strong>
                        {saved && <small>{t(scope === 'project' ? 'assets.collection.savedProject' : 'assets.collection.savedGlobal')}</small>}
                        <div>
                          {saved && <button type="button" role="menuitem" onClick={() => reveal(scope)}>{t('assets.collection.view')}</button>}
                          {(!saved || categoryChanged) && <button type="button" role="menuitem" disabled={collectionBusy}
                            onClick={() => void collect(scope)}>{t(saved ? 'assets.collection.update' : 'assets.collection.collect')}</button>}
                        </div>
                      </div>;
                    })}
                  </div>
                </div>,
                canvasOverlayRoot,
              )}
            </div>
          )}
          {mentionNode && (
            <button
              className="canvas-node-toolbar-icon"
              type="button"
              title={t("ui.CanvasNodeToolbar.text.efa6948e", { value0: node.title || node.type })}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                mentionNode(node.id);
              }}
            >
              <IconSymbol name="chat" />
            </button>
          )}
          {isTextNode && textContent && (
            <button
              className="canvas-node-toolbar-icon"
              type="button"
              title={t("ui.CanvasNodeToolbar.title.5fbaa77b")}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                openTextDetail();
              }}
            >
              <IconSymbol name="maximize" />
            </button>
          )}
        </NodeToolbar>
      )}
      {openMenu === "more" && (
        <ToolbarPortalMenu
          items={moreItems}
          root={canvasOverlayRoot}
          menuRef={moreMenuRef}
          style={moreMenuPlacement}
          hidden={nodeChromeHidden}
          onClose={() => setOpenMenu(null)}
        />
      )}
      {openMenu === "frame" && (
        <ToolbarPortalMenu
          items={wired.find((entry) => entry.resolved.menuKey === "frame")?.resolved.menu || []}
          root={canvasOverlayRoot}
          menuRef={frameMenuRef}
          style={frameMenuPlacement}
          hidden={nodeChromeHidden}
          onClose={() => setOpenMenu(null)}
        />
      )}
      <CanvasToolbarCustomizeDialog
        open={customizeOpen}
        customization={customization}
        onClose={() => setCustomizeOpen(false)}
      />
    </>
  );
}
