import {
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  NodeToolbar,
  Position,
  type ReactFlowState,
  useStore,
} from "@xyflow/react";
import { desktopApi } from "../../services/desktopApi.js";
import { selectedTextOutput, textNodeContent } from "../../utils/textNodeContent.mjs";
import { canvasNodeToolbarOffset } from "../../utils/canvasNodeChrome.mjs";
import { IconSymbol } from "../components/IconSymbol";
import { ImageCropDialog } from "../components/ImageCropDialog";
import { assetCategories } from "../constants/navigation";
import { openMediaViewer } from "../store/overlayStore";
import { selectedLocalMediaPath } from "./canvasScreenGeometry";
import type { WorkflowNodeActions, WorkflowNodeData } from "./WorkflowCanvas";

export function CanvasNodeToolbar({
  node,
  selected,
  dragging,
  semanticZoom,
  actions,
  mentionInCopilot,
  canvasOverlayRoot,
}: {
  node: WorkflowNodeData;
  selected: boolean;
  dragging: boolean;
  semanticZoom: number;
  actions: WorkflowNodeActions;
  mentionInCopilot: ((nodeId: string) => void) | null;
  canvasOverlayRoot: HTMLElement | null;
}) {
  const [assetScopeMenuOpen, setAssetScopeMenuOpen] = useState(false);
  const [assetCategory, setAssetCategory] = useState("");
  const [audioTrackState, setAudioTrackState] = useState<
    "idle" | "checking" | "present" | "absent"
  >("idle");
  const [audioSplitRunning, setAudioSplitRunning] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const [dragReleaseSettling, setDragReleaseSettling] = useState(false);
  const [assetMenuPlacement, setAssetMenuPlacement] = useState<CSSProperties>({
    visibility: "hidden",
  });
  const assetTriggerRef = useRef<HTMLButtonElement>(null);
  const assetMenuRef = useRef<HTMLDivElement>(null);
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
  const localMediaPath = selectedLocalMediaPath(node);
  const canSaveToAssets = Boolean(localMediaPath);
  const isLocalVideo = node.type === "videoGeneration" && Boolean(localMediaPath);
  const isLocalImage = node.type === "imageGeneration" && Boolean(localMediaPath);
  const canExtractAudio = isLocalVideo && audioTrackState === "present";
  const uploadLabels: Record<string, string> = {
    imageGeneration: "图片",
    videoGeneration: "视频",
    audioGeneration: "音频",
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
  const useSubtleUploadToolbar = canUpload && !isTextNode;
  const toolbarOffset = canvasNodeToolbarOffset(semanticZoom, useSubtleUploadToolbar);
  const textOutputs = Array.isArray(node.generatedOutputs)
    ? node.generatedOutputs as Array<Record<string, unknown>>
    : [];
  const currentTextOutput = selectedTextOutput(node) as Record<string, unknown> | null;
  const textContent = textNodeContent(node);

  useEffect(() => {
    if (!selected) {
      setAssetScopeMenuOpen(false);
      setAssetCategory("");
    }
  }, [selected]);

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

  useLayoutEffect(() => {
    if (!assetScopeMenuOpen || !canvasOverlayRoot) return;
    const sync = () => {
      const trigger = assetTriggerRef.current?.getBoundingClientRect();
      const menu = assetMenuRef.current;
      const rootBounds = canvasOverlayRoot.getBoundingClientRect();
      if (!trigger || !menu) return;
      const margin = 12;
      const gap = 7;
      const width = menu.offsetWidth;
      const height = menu.offsetHeight;
      const left = Math.max(
        margin,
        Math.min(rootBounds.width - width - margin, trigger.right - rootBounds.left - width),
      );
      const below = trigger.bottom - rootBounds.top + gap;
      const above = trigger.top - rootBounds.top - height - gap;
      let top = below;
      if (below + height > rootBounds.height - margin && above >= margin) top = above;
      top = Math.max(margin, Math.min(rootBounds.height - height - margin, top));
      setAssetMenuPlacement({ left, top, visibility: "visible" });
    };
    const frame = requestAnimationFrame(sync);
    const observer = new ResizeObserver(sync);
    observer.observe(canvasOverlayRoot);
    if (assetTriggerRef.current) observer.observe(assetTriggerRef.current);
    window.addEventListener("resize", sync);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [assetScopeMenuOpen, assetPlacementRevision, canvasOverlayRoot]);

  function openTextDetail() {
    openMediaViewer({
      src: textContent,
      kind: "text",
      title: String(node.title || "文本详情"),
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
    });
  }

  const hasToolbar = isTextNode || canUpload || mentionInCopilot ||
    canSaveToAssets || isLocalVideo;
  return (
    <>
      {hasToolbar && (
        <NodeToolbar
          className={`canvas-node-selection-toolbar${useSubtleUploadToolbar ? " canvas-node-selection-toolbar--subtle" : ""}${nodeChromeHidden ? " canvas-node-selection-toolbar--hidden" : ""} nodrag nopan`}
          isVisible={selected}
          position={Position.Top}
          offset={toolbarOffset}
        >
          {isTextNode && (
            <>
              <span className="canvas-node-toolbar-label">文本节点</span>
              <button
                className="canvas-node-toolbar-icon"
                type="button"
                title="复制全文"
                disabled={!textContent}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  void navigator.clipboard.writeText(textContent).then(
                    () => actions.notify("文本已复制"),
                    () => actions.notify("文本复制失败"),
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
              title={`上传${uploadLabel}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                void actions.upload(node.id);
              }}
            >
              <IconSymbol name="upload" />
              <span>上传{uploadLabel}</span>
            </button>
          )}
          {isLocalVideo && (
            <button
              type="button"
              title={audioSplitRunning ? "正在后台拆分音视频" : canExtractAudio ? "拆分为无声视频和音乐" : audioTrackState === "checking" ? "正在检测音轨" : "当前视频不包含音轨"}
              disabled={!canExtractAudio || audioSplitRunning}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                setAudioSplitRunning(true);
                void Promise.resolve(actions.extractAudio(node.id)).finally(() =>
                  setAudioSplitRunning(false)
                );
              }}
            >
              <IconSymbol name="waveform" />
              <span>{audioSplitRunning ? "拆分中…" : canExtractAudio ? "音频分离" : audioTrackState === "checking" ? "检测音轨…" : "无音轨"}</span>
            </button>
          )}
          {isLocalImage && (
            <button
              type="button"
              title="裁剪图片"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                setCropOpen(true);
              }}
            >
              <IconSymbol name="crop" />
              <span>裁剪</span>
            </button>
          )}
          {canSaveToAssets && (
            <div className="canvas-node-asset-action">
              <button
                ref={assetTriggerRef}
                type="button"
                title="选择资产保存范围"
                aria-haspopup="menu"
                aria-expanded={assetScopeMenuOpen}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  setAssetScopeMenuOpen((open) => {
                    if (open) setAssetCategory("");
                    else setAssetMenuPlacement({ visibility: "hidden" });
                    return !open;
                  });
                }}
              >
                <IconSymbol name="archive" />
                <span>存为资产</span>
                <IconSymbol className="canvas-node-asset-chevron" name="chevron-down" />
              </button>
              {assetScopeMenuOpen && canvasOverlayRoot && createPortal(
                <div
                  ref={assetMenuRef}
                  className={`canvas-node-asset-scope-menu canvas-node-asset-scope-menu--portal${nodeChromeHidden ? " canvas-node-asset-scope-menu--hidden" : ""} nodrag nopan nowheel`}
                  role="menu"
                  style={assetMenuPlacement}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <header className="canvas-node-asset-menu-head">
                    <IconSymbol name="archive" />
                    <span><strong>存为资产</strong><small>选择类型与保存位置</small></span>
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
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!assetCategory}
                      onClick={(event) => {
                        event.stopPropagation();
                        setAssetScopeMenuOpen(false);
                        void actions.saveToAssets(node.id, "project", assetCategory);
                        setAssetCategory("");
                      }}
                    >
                      <IconSymbol name="folder" />
                      <strong>存到项目</strong>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!assetCategory}
                      onClick={(event) => {
                        event.stopPropagation();
                        setAssetScopeMenuOpen(false);
                        void actions.saveToAssets(node.id, "global", assetCategory);
                        setAssetCategory("");
                      }}
                    >
                      <IconSymbol name="archive" />
                      <strong>存到全局</strong>
                    </button>
                  </div>
                </div>,
                canvasOverlayRoot,
              )}
            </div>
          )}
          {mentionInCopilot && (canUpload || canExtractAudio || canSaveToAssets) && (
            <span className="canvas-node-toolbar-divider" />
          )}
          {mentionInCopilot && (
            <button
              className="canvas-node-toolbar-icon"
              type="button"
              title={`加入对话：${node.title || node.type}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                mentionInCopilot(node.id);
              }}
            >
              <IconSymbol name="chat" />
            </button>
          )}
          {isTextNode && (
            <button
              className="canvas-node-toolbar-icon"
              type="button"
              title="打开完整文本"
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
      {cropOpen && isLocalImage && createPortal(
        <ImageCropDialog
          source={localMediaPath}
          title={String(node.title || "图片")}
          onCancel={() => setCropOpen(false)}
          onConfirm={(rect) => actions.cropImage(node.id, rect)}
        />,
        document.body,
      )}
    </>
  );
}
