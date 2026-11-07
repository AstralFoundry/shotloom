import { t } from '@/i18n';
import { memo, useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { type ReactFlowState, useStore } from "@xyflow/react";
import {
  CanvasNodeLabelRootContext,
  CanvasOverlayRootContext,
  type WorkflowNodeRenderer,
} from "./WorkflowCanvas";
import { IconSymbol } from "../components/IconSymbol";
import { GenerationNodePreview } from "./GenerationNodePreview";
import { GenerationNodeComposer } from "./GenerationNodeComposer";
import { generationNodeState } from "./generationNodeState";
import { setEditorCaret } from "./promptReferenceEditor";

const generationTypes = new Set([
  "imageGeneration",
  "videoGeneration",
  "audioGeneration",
  "textGeneration",
]);

function ScreenSpaceComposer({
  nodeId,
  children,
}: {
  nodeId: string;
  children: ReactNode;
}) {
  const root = useContext(CanvasOverlayRootContext);
  const dragging = useStore((state: ReactFlowState) =>
    Boolean(state.nodeLookup.get(nodeId)?.dragging),
  );
  const [dragReleaseSettling, setDragReleaseSettling] = useState(false);
  const hidden = dragging || dragReleaseSettling;
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
  const selectPlacement = useCallback((state: ReactFlowState) => {
    const internal = state.nodeLookup.get(nodeId);
    const [viewportX, viewportY, zoom] = state.transform;
    const position = internal?.internals.positionAbsolute;
    const width = Number(internal?.measured.width || internal?.width || 0);
    const height = Number(internal?.measured.height || internal?.height || 0);
    const rootWidth = Number(root?.clientWidth || 570);
    const composerWidth = Math.min(570, Math.max(320, rootWidth - 24));
    const desiredLeft = viewportX + (Number(position?.x || 0) + width / 2) * zoom;
    return {
      left: Math.max(composerWidth / 2 + 12, Math.min(rootWidth - composerWidth / 2 - 12, desiredLeft)),
      top: viewportY + (Number(position?.y || 0) + height) * zoom + 10,
      width: composerWidth,
    };
  }, [nodeId, root]);
  const placement = useStore(
    selectPlacement,
    (left, right) => left.left === right.left && left.top === right.top && left.width === right.width,
  );
  if (!root) return null;
  return createPortal(
    <div
      className={`work-composer-anchor${hidden ? " work-composer-anchor--hidden" : ""}`}
      style={placement}
      aria-hidden={hidden}
    >
      {children}
    </div>,
    root,
  );
}

export const GenerationNode: WorkflowNodeRenderer = memo(({
  node,
  selected,
  incomingInputs = [],
  actions,
  imageCropMode = null,
  onImageCropClose,
  imageAnnotationOpen = false,
  onImageAnnotationClose,
  imageWatermarkOpen = false,
  onImageWatermarkClose,
  imageAngleOpen = false,
  onImageAngleClose,
  imageLightingOpen = false,
  onImageLightingClose,
  imageMaskOpen = false,
  onImageMaskClose,
  imageEmotionOpen = false,
  onImageEmotionClose,
  semanticZoom = 1,
}) => {
  const promptRef = useRef<HTMLDivElement>(null);
  const labelRoot = useContext(CanvasNodeLabelRootContext);
  const state = generationNodeState(node, selected, incomingInputs);
  const { busy, displayTitle, metaIcon } = state;
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const titleEditCancelled = useRef(false);

  function commitTitle() {
    if (!titleEditCancelled.current && titleDraft?.trim() && titleDraft.trim() !== displayTitle) {
      const title = titleDraft.trim();
      actions.update(node.id, { title, titleOverride: title });
    }
    setTitleDraft(null);
  }

  function startFromStarter(prompt: string) {
    actions.select(node.id);
    actions.update(node.id, { prompt });
    // 输入面板只在节点选中后挂载，等它进入屏幕空间后再聚焦。
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const textarea = promptRef.current;
        if (!textarea) return;
        textarea.focus();
        setEditorCaret(textarea, prompt.length);
      });
    });
  }

  const nodeLabel = (
    <div className={`work-node-kicker${displayTitle ? "" : " unlabeled"}`}>
      {displayTitle && (
        <IconSymbol className="work-node-type-icon" name={metaIcon} aria-hidden="true" />
      )}
      {titleDraft !== null ? (
        <input
          className="work-node-title-input nodrag nopan"
          autoFocus
          aria-label={t("ui.ProjectsView.text.1cd80fd7")}
          value={titleDraft}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setTitleDraft(event.target.value)}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onBlur={commitTitle}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              titleEditCancelled.current = true;
              setTitleDraft(null);
            }
          }}
        />
      ) : displayTitle && (
        <span
          className="work-node-title nodrag nopan"
          title={displayTitle}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            titleEditCancelled.current = false;
            setTitleDraft(displayTitle);
          }}
        >{displayTitle}</span>
      )}
      {selected && node.type === "imageGeneration" && state.activeKind === "image" && (
        <div className="work-node-kicker-actions">
          <button
            title={t("ui.GenerationNode.title.0e8e1c60")}
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              void actions.applyColoredPencil(node.id);
            }}
          >
            <IconSymbol name="pencil" />
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div
      className="work-node-wrapper"
      onClick={(e) => {
        e.stopPropagation();
        actions.select(node.id);
      }}
    >
      {labelRoot && createPortal(nodeLabel, labelRoot)}
      <GenerationNodePreview
        node={node}
        selected={selected}
        state={state}
        actions={actions}
        imageCropMode={imageCropMode}
        onImageCropClose={onImageCropClose}
        imageAnnotationOpen={imageAnnotationOpen}
        onImageAnnotationClose={onImageAnnotationClose}
        imageWatermarkOpen={imageWatermarkOpen}
        onImageWatermarkClose={onImageWatermarkClose}
        imageAngleOpen={imageAngleOpen}
        onImageAngleClose={onImageAngleClose}
        imageLightingOpen={imageLightingOpen}
        onImageLightingClose={onImageLightingClose}
        imageMaskOpen={imageMaskOpen}
        onImageMaskClose={onImageMaskClose}
        imageEmotionOpen={imageEmotionOpen}
        onImageEmotionClose={onImageEmotionClose}
        semanticZoom={semanticZoom}
        onStarter={startFromStarter}
      />
      {/* 纯上传资源节点的内容就是那个文件本身，没有可再生成的提示词语义，不显示下方输入面板。 */}
      {selected && !imageCropMode && !imageMaskOpen && !imageEmotionOpen && !state.uploadedResource && (
        <ScreenSpaceComposer nodeId={node.id}>
          <GenerationNodeComposer
            node={node}
            state={state}
            actions={actions}
            promptRef={promptRef}
          />
        </ScreenSpaceComposer>
      )}
    </div>
  );
});

export const generationNodeRenderers = Object.fromEntries(
  [...generationTypes].map((type) => [type, GenerationNode]),
);
