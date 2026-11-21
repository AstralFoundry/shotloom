import { batchColumnHandle, parseBatchCellHandle } from '@/domain/graph/BatchTable';
import { PluginNodeContextMenu } from './PluginNodeContextMenu';
import { capabilitiesForNode } from '../../domain/provider/plugins/PluginCapabilities';
import { isStoryboardScriptNode } from "@/domain/graph/StoryboardScript";
import { canvasInputIndex } from './canvasInputIndex';
import { createCanvasWheelZoom, zoomViewportAt } from "./canvasWheelZoom";
import { CanvasConnectionDraft, canvasEdgeTypes } from "./CanvasConnection";
import { CANVAS_WHEEL_IDLE_MS, createCanvasWheelOwnership, createCanvasWheelPan } from './canvasWheelPan';
import { CircleDashed, Search, Map as MapIcon, CircleHelp } from 'lucide-react';
import { Button, Dropdown, Popover, Slider } from 'antd';
import { alignCanvasSelection, type CanvasAlignment } from '../../utils/canvasSelectionLayout';
import { CanvasMinimap } from "./CanvasMinimap";
import { CanvasDisplaySettings } from "./CanvasDisplaySettings";
import { canvasEdgeVisible, type CanvasAppearance } from "../../utils/canvasAppearance";
import { settingsStore, saveAppSettings } from "../../store/settingsStore";
import { subscribeDomain } from "../../store/domainReactivity";
import type { AgentLayoutMode } from "../../services/agentLayoutService";
import { t } from '@/i18n';
import {
  type ComponentType,
  createContext,
  type DragEvent as ReactDragEvent,
  forwardRef,
  memo,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import {
  applyNodeChanges,
  type Connection,
  ConnectionMode,
  type Edge,
  Handle,
  type Node,
  type NodeChange,
  type OnNodeDrag,
  NodeResizer,
  type NodeProps,
  type ResizeParams,
  type OnMoveEnd,
  ReactFlow,
  type ReactFlowInstance,
  Position,
  useNodesState,
  useNodesInitialized,
  useStore,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { defaultCanvasNodeDimensions } from "../../services/agentLayoutService";
import { IconSymbol } from "../components/IconSymbol";
import type { ImageCropRect } from "../components/ImageCropEditor";
import {
  draggedCanvasPositions,
  reconcileCanvasNodes,
} from "../../utils/canvasNodeDrag.ts";
import {
  CANVAS_NODE_LABEL_HEIGHT,
  CANVAS_NODE_LABEL_OFFSET,
  canvasNodePortBounds,
} from "../../utils/canvasNodeChrome.ts";
import { CanvasNodeToolbar } from "./CanvasNodeToolbar";
import { isCanvasDomEvent, isEditableCanvasEvent } from "./canvasEventScope";
import { GenerationHistoryDialog } from "./GenerationHistoryDialog";
import { CanvasContextMenu } from "./CanvasContextMenu";
import { CanvasSectionNode, SectionDragFeedbackContext, CanvasSectionNodesContext, type SectionDragFeedback } from "./CanvasSectionNode";
import { canvasSectionMembers, canvasSectionDropTarget } from "../../domain/graph/CanvasSections.ts";
import { ARTIFACT_DRAG_TYPE } from "../agent-chat/artifactHelpers";
import {
  canvasMenuPosition,
  canvasBottomRowLayout,
  screenPixel,
  workflowNodeDimensions as nodeDimensions,
} from "./canvasScreenGeometry";

export interface WorkflowNodeData extends Record<string, unknown> {
  id: string;
  type: string;
  title?: string;
  x?: number;
  y?: number;
  canvasWidth?: number;
  canvasHeight?: number;
  canvasSectionId?: string | null;
  canvasSectionAutoLayout?: boolean;
  archived?: boolean;
  status?: string;
  selected?: boolean;
}
export interface WorkflowEdgeData extends Record<string, unknown> {
  inputRole?: string;
  inputSlot?: string;
  required?: boolean;
}
export interface WorkflowIncomingInput extends Record<string, unknown> {
  edgeId: string;
  nodeId: string;
  name: string;
  inputRole?: string;
  inputSlot?: string;
}
export type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  data?: WorkflowEdgeData;
};
export type WorkflowReferenceCandidate = {
  id: string;
  name: string;
  kind: "image" | "video" | "audio";
  group: "current" | "asset";
  media: Record<string, unknown>;
};
export interface WorkflowNodeActions {
  selectSectionContents?: (id: string) => void;
  arrangeSection?: (id: string) => void;
  createClipNode: (id: string) => void | Promise<void>;
  update: (id: string, patch: Record<string, unknown>) => void;
  select: (id: string) => void;
  delete: (id: string) => void;
  upload: (id: string) => void | Promise<void>;
  addReference: (id: string, slot?: string) => void | Promise<void>;
  listReferenceCandidates: (id: string) => WorkflowReferenceCandidate[];
  insertReferenceMention: (id: string, sourceId: string, draft: string, start: number, end: number) => Promise<{ prompt: string; caret: number } | null>;
  setInputMode: (id: string, mode: string) => void;
  removeIncomingEdge: (id: string, edgeId: string) => void;
  run: (id: string) => void;
  useResource: (id: string) => void;
  saveToAssets: (
    id: string,
    scope: "project" | "global",
    category: string,
  ) => void | Promise<void>;
  extractAudio: (id: string) => void | Promise<void>;
  cropImage: (id: string, rect: ImageCropRect) => void | Promise<void>;
  createAnnotationNode: (id: string, blob: Blob) => void | Promise<boolean>;
  createWatermarkNode: (id: string, blob: Blob) => void | Promise<boolean>;
  splitImageGrid: (id: string, rows: number, cols: number, selected: number[], rect: ImageCropRect) => void | Promise<void>;
  captureVideoFrame: (id: string, seconds: number | 'last') => void | Promise<void>;
  replaceResource: (id: string) => void;
  archiveResource: (id: string) => void;
  selectOutput: (nodeId: string, outputId: string) => void;
  getDirectorIncomingImages: (
    id: string,
  ) => Promise<Array<{ edgeId: string; nodeId: string; name: string; url: string }>>;
  removeDirectorIncomingEdge: (id: string, edgeId: string) => void;
  exportDirectorPrompt: (id: string, title: string, prompt: string) => void;
  flushDirectorScene: (id: string) => Promise<void>;
  createDirectorVideo: (imageId: string, title: string, prompt: string) => void;
  exportDirectorAsset: (
    id: string,
    dataUrl: string,
    name: string,
    kind: "image" | "video",
    directorContext?: Record<string, unknown>,
  ) => Promise<{ nodeId: string } | null>;
  notify: (message: string) => void;
  applyColoredPencil: (id: string) => void | Promise<void>;
  applyImageRecipe: (id: string, kind: "angle" | "lighting", params: unknown) => boolean;
  applyMaskEdit: (id: string, input: {
    prompt: string;
    maskFilePath: string;
    model?: string;
    config?: Record<string, unknown>;
  }) => boolean;
  applyEmotionEdit: (id: string, input: {
    maskFilePath: string;
    presetId: string;
    extraPrompt?: string;
    faceRect: { x: number; y: number; width: number; height: number };
  }) => boolean;
  createReversePromptNode: (id: string) => boolean;
}
export type WorkflowNodeRenderer = ComponentType<{
  node: WorkflowNodeData;
  selected: boolean;
  resizing?: boolean;
  inputRevision?: string;
  incomingInputs?: WorkflowIncomingInput[];
  actions: WorkflowNodeActions;
  semanticZoom?: number;
  imageCropMode?: "crop" | "grid" | null;
  onImageCropClose?: () => void;
  imageAnnotationOpen?: boolean;
  onImageAnnotationClose?: () => void;
  imageWatermarkOpen?: boolean;
  onImageWatermarkClose?: () => void;
  imageAngleOpen?: boolean;
  onImageAngleClose?: () => void;
  imageLightingOpen?: boolean;
  onImageLightingClose?: () => void;
  imageMaskOpen?: boolean;
  onImageMaskClose?: () => void;
  imageEmotionOpen?: boolean;
  onImageEmotionClose?: () => void;
}>;
type CanvasPortSide = 'left' | 'right';

export interface WorkflowCanvasController {
  createSection?: (position?: { x: number; y: number }) => void;
  moveNodes: (
    positions: Array<{ id: string; x: number; y: number }>,
    options?: { recordHistory?: boolean },
  ) => void;
  selectNodes: (ids: string[]) => void;
  selectEdge: (id: string | null) => void;
  connect: (connection: Connection, options?: { history?: boolean }) => boolean | void | Promise<boolean | void>;
  portNodeTypes?: (nodeId: string, side: CanvasPortSide) => readonly string[];
  createNodeFromPort?: (nodeId: string, side: CanvasPortSide, type: string) => void | Promise<void>;
  onViewportActivity?: () => void;
  saveViewport: (viewport: Viewport) => void;
  createNodeAt: (type: string, position: { x: number; y: number }) => void | Promise<void>;
  createArtifactNodeAt: (artifactId: string, position: { x: number; y: number }) => void | Promise<void>;
  deleteSelection: () => void;
  copySelection?: (withUpstream?: boolean) => void | Promise<void>;
  pasteSelection?: () => void | Promise<void>;
  undo?: () => void;
  redo?: () => void;
  runSelection?: (stop?: boolean) => void;
  registerFitView?: (handler: (() => void) | null) => void;
  registerFocusNodes?: (
    handler: ((nodeIds: string[], options?: { keepZoom?: boolean }) => void) | null,
  ) => void;
}

const RendererContext = createContext<Record<string, WorkflowNodeRenderer>>({});
const ActionContext = createContext<WorkflowNodeActions | null>(null);
const CanvasPortMenuContext = createContext<((nodeId: string, side: CanvasPortSide, anchor: HTMLElement) => void) | null>(null);
export const MentionContext = createContext<((nodeId: string) => void) | null>(null);
export const CanvasOverlayRootContext = createContext<HTMLElement | null>(null);
export const CanvasHistoryContext = createContext<((nodeId: string) => void) | null>(null);
export const CanvasNodeLabelRootContext = createContext<HTMLElement | null>(null);
export const CanvasPreviewZoomContext = createContext(1);
const CanvasFocusNodesContext = createContext<((nodeIds: string[]) => void) | null>(null);

function CanvasNodeContent({
  width,
  height,
  children,
  deferOffscreen = false,
}: {
  width: number;
  height: number;
  children: ReactNode;
  deferOffscreen?: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  return (
    <div
      className="canvas-node-semantic-frame"
      onPlayCapture={() => setPlaying(true)}
      onPauseCapture={() => setPlaying(false)}
      onEndedCapture={() => setPlaying(false)}
      style={{
        width,
        height,
        // Keep DOM, editor state and media leases. The browser can skip layout
        // and paint offscreen; selected and playing nodes remain fully active.
        contentVisibility: deferOffscreen && !playing ? 'auto' : 'visible',
      }}
    >
      <div className="canvas-node-semantic-content" style={{ width, height }}>
        {children}
      </div>
    </div>
  );
}
const MIN_CANVAS_ZOOM = 0.1;
const MAX_CANVAS_ZOOM = 4;
const MEDIA_PREVIEW_ZOOM_SETTLE_MS = 220;
/** 空画布示意图的三张幽灵节点：portX 决定连接桩落在卡片左边还是右边。 */
const CANVAS_EMPTY_NODES = [
  { x: 4, y: 40, portX: 52 },
  { x: 132, y: 8, portX: 0 },
  { x: 132, y: 72, portX: 0 },
];
const MEDIA_NODE_TYPES = new Set([
  "imageGeneration",
  "videoGeneration",
  "audioGeneration",
  "threeDDirector",
]);
type FlowNode = Node<{
  node: WorkflowNodeData;
  inputRevision: string;
  incomingInputs: WorkflowIncomingInput[];
}>;
type FlowNodeCacheEntry = {
  input: WorkflowNodeData;
  selected: boolean;
  inputRevision: string;
  output: FlowNode;
};
type FlowEdgeCacheEntry = {
  signature: string;
  output: Edge<WorkflowEdgeData>;
};
type CanvasDebugEvent = {
  time: number;
  type: string;
  detail: unknown;
};
function traceCanvasEvent(type: string, detail: unknown) {
  if (!import.meta.env.DEV) return;
  const target = globalThis as typeof globalThis & {
    __shotloomCanvasDebug?: CanvasDebugEvent[];
  };
  const events = target.__shotloomCanvasDebug || [];
  events.push({ time: performance.now(), type, detail });
  if (events.length > 600) events.splice(0, events.length - 600);
  target.__shotloomCanvasDebug = events;
}
function toFlowNodes(
  nodes: WorkflowNodeData[],
  edges: WorkflowEdge[] = [],
  cache?: Map<string, FlowNodeCacheEntry>,
): FlowNode[] {
  const inputs = canvasInputIndex(nodes, edges, t("ui.WorkflowCanvas.text.a4c9a837"));
  const result = nodes
    .filter((node) => !node.archived)
    .map((node) => {
      const dimensions = nodeDimensions(node);
      const { width, height } = dimensions;
      const inputRevision = inputs.get(node.id)?.revision || '';
      const selected = Boolean(node.selected);
      const cached = cache?.get(node.id);
      const data = cached &&
          cached.input === node &&
          cached.inputRevision === inputRevision
        ? cached.output.data
        : {
            node,
            inputRevision,
            incomingInputs: inputs.get(node.id)?.inputs || [],
          };
      if (
        cached &&
        cached.input === node &&
        cached.selected === selected &&
        cached.inputRevision === inputRevision
      ) {
        return cached.output;
      }
      const output: FlowNode = {
        id: node.id,
        type: "panel",
        zIndex: node.type === 'canvasSection' ? -1 : 0,
        ...(node.type === 'canvasSection' ? { dragHandle: '.canvas-section-heading, .canvas-section-surface' } : {}),
        connectable: node.type !== 'canvasSection',
        className: [
          node.type === 'canvasSection' ? 'canvas-section-node' : '',
          MEDIA_NODE_TYPES.has(node.type) ? "canvas-media-node" : "",
          node.type === "imageGeneration" ? "canvas-node-image-generation" : "",
        ]
          .filter(Boolean)
          .join(" "),
        position: {
          x: Number(node.x) || 0,
          y: Number(node.y) || 0,
        },
        data,
        selected,
        // Preserve measured row and column handles when React Flow adopts a new node snapshot.
        ...(!isStoryboardScriptNode(node) && node.type !== "batchTable" && { handles: canvasNodePortBounds(width, height).filter(() => node.type !== 'canvasSection').map((handle) => ({
          ...handle,
          type: "source" as const,
          position: handle.id === "port-left" ? Position.Left : Position.Right,
        })) }),
        style: { width, height },
        width,
        height,
        // These dimensions also seed the resizer and minimap on external sync.
        measured: { width, height },
      };
      cache?.set(node.id, { input: node, selected, inputRevision, output });
      return output;
    });
  if (cache && cache.size > result.length) {
    const liveIds = new Set(result.map((node) => node.id));
    for (const id of cache.keys()) {
      if (!liveIds.has(id)) cache.delete(id);
    }
  }
  return result;
}
function FallbackNodeInner({ node, selected }: { node: WorkflowNodeData; selected: boolean }) {
  return (
    <article className={`react-workflow-node${selected ? " selected" : ""}`}>
      <header>
        <span>{node.type}</span>
        <i className={`status-${node.status || "idle"}`} />
      </header>
      <strong>{node.title || t("ui.WorkflowCanvas.text.c599f9df")}</strong>
    </article>
  );
}
const FallbackNode = memo(FallbackNodeInner);

const CanvasNode = memo(function CanvasNode({ data, selected, dragging }: NodeProps<FlowNode>) {
  const registry = useContext(RendererContext);
  const actions = useContext(ActionContext)!;
  const addNodeMention = useContext(MentionContext);
  const item = data.node;
  const [resizing, setResizing] = useState(false);
  const [resizeDimensions, setResizeDimensions] = useState<{ width: number; height: number } | null>(null);
  const resizeBinding = useRef({ item, actions });
  resizeBinding.current = { item, actions };
  // Keep XYFlow's drag behavior bound while the node renders live dimensions.
  const onResize = useCallback((_event: unknown, size: ResizeParams) => {
    setResizing(true);
    setResizeDimensions({ width: size.width, height: size.height });
  }, []);
  const onResizeEnd = useCallback((_event: unknown, size: ResizeParams) => {
    const { item, actions } = resizeBinding.current;
    const width = Math.round(size.width);
    const height = Math.round(size.height);
    setResizeDimensions({ width, height });
    setResizing(false);
    actions.update(item.id, {
      x: Math.round(size.x), y: Math.round(size.y),
      canvasWidth: width, canvasHeight: height, canvasSizeManuallySet: true, updatedAt: new Date().toISOString(),
    });
  }, []);
  useEffect(() => {
    const saved = nodeDimensions(item);
    if (!resizing && resizeDimensions && saved.width === resizeDimensions.width && saved.height === resizeDimensions.height) {
      setResizeDimensions(null);
    }
  }, [resizing, resizeDimensions, item.canvasWidth, item.canvasHeight]);
  const [imageCropMode, setImageCropMode] = useState<"crop" | "grid" | null>(null);
  const [imageAnnotationOpen, setImageAnnotationOpen] = useState(false);
  const [imageWatermarkOpen, setImageWatermarkOpen] = useState(false);
  const [imageAngleOpen, setImageAngleOpen] = useState(false);
  const [imageLightingOpen, setImageLightingOpen] = useState(false);
  const [imageMaskOpen, setImageMaskOpen] = useState(false);
  const [imageEmotionOpen, setImageEmotionOpen] = useState(false);
  const openGenerationHistory = useContext(CanvasHistoryContext);
  useEffect(() => {
    if (selected) return;
    setImageCropMode(null);
    setImageAnnotationOpen(false);
    setImageWatermarkOpen(false);
    setImageAngleOpen(false);
    setImageLightingOpen(false);
    setImageMaskOpen(false);
    setImageEmotionOpen(false);
  }, [selected]);
  const canvasOverlayRoot = useContext(CanvasOverlayRootContext);
  const focusCanvasNodes = useContext(CanvasFocusNodesContext);
  const [labelRoot, setLabelRoot] = useState<HTMLElement | null>(null);
  const Renderer = registry[item.type] || FallbackNode;
  const openPortMenu = useContext(CanvasPortMenuContext);
  const imageToolZoom = useStore(state =>
    imageWatermarkOpen || imageMaskOpen || imageEmotionOpen ? state.transform[2] : 1,
  );
  const resizable =
    item.type === "textGeneration" || item.type === "batchTable" ||
    item.type === "threeDDirector" || item.type === "clipStudio";
  const defaultSize = defaultCanvasNodeDimensions(item.type);
  const storyboardScript = isStoryboardScriptNode(item);
  function portMenuProps(side: CanvasPortSide) {
    if (!openPortMenu || storyboardScript || !item.type.endsWith('Generation')) return {};
    const label = side === 'left' ? t('canvas.port.createUpstream') : t('canvas.port.createDownstream');
    return {
      tabIndex: 0,
      role: 'button',
      'aria-haspopup': 'menu' as const,
      'aria-label': label,
      title: label,
      onClick: (event: ReactMouseEvent<HTMLDivElement>) => {
        event.stopPropagation();
        openPortMenu(item.id, side, event.currentTarget);
      },
      onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        openPortMenu(item.id, side, event.currentTarget);
      },
    };
  }
  const showNodeToolbar = !storyboardScript && item.type !== "batchTable" && !imageMaskOpen && !imageEmotionOpen;
  const minimum =
    item.type === "threeDDirector" || item.type === "clipStudio"
      ? { ...defaultSize, width: item.type === "clipStudio" ? 720 : defaultSize.width }
      : storyboardScript ? { width: 800, height: 300 }
        : item.type === "batchTable" ? { width: 760, height: 380 } : { width: 195, height: 135 };
  const dimensions = resizeDimensions || nodeDimensions(item);
  if (item.type === 'canvasSection') return <CanvasSectionNode node={item} selected={Boolean(selected)} dragging={dragging} actions={actions} />;
  return (
    <>
      {showNodeToolbar && <CanvasNodeToolbar
        node={item}
        selected={selected}
        dragging={dragging}
        actions={actions}
        addNodeMention={addNodeMention}
        canvasOverlayRoot={canvasOverlayRoot}
        imageCropMode={imageCropMode}
        onImageCropOpen={(mode) => {
          focusCanvasNodes?.([item.id]);
          // 裁剪和标注都要占满整张媒体卡片，二者不能同时打开。
          setImageAnnotationOpen(false);
          setImageWatermarkOpen(false);
          setImageAngleOpen(false);
          setImageLightingOpen(false);
          setImageMaskOpen(false);
          setImageEmotionOpen(false);
          setImageCropMode(mode);
        }}
        imageAnnotationOpen={imageAnnotationOpen}
        onImageAnnotationOpen={() => {
          focusCanvasNodes?.([item.id]);
          setImageCropMode(null);
          setImageWatermarkOpen(false);
          setImageAngleOpen(false);
          setImageLightingOpen(false);
          setImageMaskOpen(false);
          setImageEmotionOpen(false);
          setImageAnnotationOpen(true);
        }}
        imageWatermarkOpen={imageWatermarkOpen}
        onImageWatermarkOpen={() => {
          focusCanvasNodes?.([item.id]);
          setImageCropMode(null);
          setImageAnnotationOpen(false);
          setImageAngleOpen(false);
          setImageLightingOpen(false);
          setImageMaskOpen(false);
          setImageEmotionOpen(false);
          setImageWatermarkOpen(true);
        }}
        imageAngleOpen={imageAngleOpen}
        onImageAngleOpen={() => {
          focusCanvasNodes?.([item.id]);
          setImageCropMode(null);
          setImageAnnotationOpen(false);
          setImageWatermarkOpen(false);
          setImageLightingOpen(false);
          setImageMaskOpen(false);
          setImageEmotionOpen(false);
          setImageAngleOpen((current) => !current);
        }}
        imageLightingOpen={imageLightingOpen}
        onImageLightingOpen={() => {
          focusCanvasNodes?.([item.id]);
          setImageCropMode(null);
          setImageAnnotationOpen(false);
          setImageWatermarkOpen(false);
          setImageAngleOpen(false);
          setImageMaskOpen(false);
          setImageEmotionOpen(false);
          setImageLightingOpen((current) => !current);
        }}
        imageMaskOpen={imageMaskOpen}
        onImageMaskOpen={() => {
          focusCanvasNodes?.([item.id]);
          setImageCropMode(null);
          setImageAnnotationOpen(false);
          setImageWatermarkOpen(false);
          setImageAngleOpen(false);
          setImageLightingOpen(false);
          setImageEmotionOpen(false);
          setImageMaskOpen((current) => !current);
        }}
        onOpenGenerationHistory={openGenerationHistory ?? undefined}
        imageEmotionOpen={imageEmotionOpen}
        onImageEmotionOpen={() => {
          focusCanvasNodes?.([item.id]);
          setImageCropMode(null);
          setImageAnnotationOpen(false);
          setImageWatermarkOpen(false);
          setImageAngleOpen(false);
          setImageLightingOpen(false);
          setImageMaskOpen(false);
          setImageEmotionOpen((current) => !current);
        }}
      />}
      {selected && resizable && (
        <NodeResizer
          color="#171717"
          handleClassName="canvas-node-resize-handle nodrag"
          isVisible
          lineClassName="canvas-node-resize-line"
          keepAspectRatio={item.type === "threeDDirector"}
          minHeight={minimum.height}
          minWidth={minimum.width}
          maxHeight={item.type === "clipStudio" ? dimensions.height : Number.MAX_VALUE}
          onResize={onResize}
          onResizeEnd={onResizeEnd}
        />
      )}
      <div
        ref={setLabelRoot}
        className="canvas-node-label-anchor"
        style={{
          top: -CANVAS_NODE_LABEL_OFFSET,
          width: dimensions.width,
          height: CANVAS_NODE_LABEL_HEIGHT,
        }}
      />
      <Handle
        id="port-left"
        isConnectable={!storyboardScript && item.type !== "batchTable"}
        style={storyboardScript || item.type === "batchTable" ? { visibility: "hidden" } : undefined}
        className="canvas-flow-port canvas-flow-port-in"
        {...portMenuProps('left')}
        type="source"
        position={Position.Left}
      />
      <Handle
        id="port-right"
        isConnectable={!storyboardScript && item.type !== "batchTable"}
        style={storyboardScript || item.type === "batchTable" ? { visibility: "hidden" } : undefined}
        className="canvas-flow-port canvas-flow-port-out"
        {...portMenuProps('right')}
        type="source"
        position={Position.Right}
      />
      <CanvasNodeLabelRootContext.Provider value={labelRoot}>
      <CanvasNodeContent width={dimensions.width} height={dimensions.height}
        deferOffscreen={!storyboardScript && !selected && !resizing && !['threeDDirector', 'clipStudio', 'canvasSection', 'batchTable'].includes(item.type)}>
        <Renderer
          node={item}
          selected={selected}
          resizing={resizing}
          inputRevision={data.inputRevision}
          incomingInputs={data.incomingInputs}
          actions={actions}
          semanticZoom={imageToolZoom}
          imageCropMode={imageCropMode}
          onImageCropClose={() => setImageCropMode(null)}
          imageAnnotationOpen={imageAnnotationOpen}
          onImageAnnotationClose={() => setImageAnnotationOpen(false)}
          imageWatermarkOpen={imageWatermarkOpen}
          onImageWatermarkClose={() => setImageWatermarkOpen(false)}
          imageAngleOpen={imageAngleOpen}
          onImageAngleClose={() => setImageAngleOpen(false)}
          imageLightingOpen={imageLightingOpen}
          onImageLightingClose={() => setImageLightingOpen(false)}
          imageMaskOpen={imageMaskOpen}
          onImageMaskClose={() => setImageMaskOpen(false)}
          imageEmotionOpen={imageEmotionOpen}
          onImageEmotionClose={() => setImageEmotionOpen(false)}
        />
      </CanvasNodeContent>
      </CanvasNodeLabelRootContext.Provider>
    </>
  );
}, (previous, next) => previous.data === next.data && previous.selected === next.selected && previous.dragging === next.dragging);
const nodeTypes = { panel: CanvasNode };
type CanvasMenuState = {
  x: number;
  y: number;
  flowX: number;
  flowY: number;
  port?: { nodeId: string; side: CanvasPortSide; allowedTypes: readonly string[]; anchor: HTMLElement };
};
type CanvasMenuLayerHandle = {
  open: (menu: CanvasMenuState) => void;
  close: () => void;
};
const CanvasMenuLayer = memo(
  forwardRef<CanvasMenuLayerHandle, { controller: WorkflowCanvasController; onOpenPoseLibrary?: (() => void) | undefined }>(
    function CanvasMenuLayer({ controller, onOpenPoseLibrary }, ref) {
      const [menu, setMenu] = useState<CanvasMenuState | null>(null);
      useImperativeHandle(
        ref,
        () => ({
          open(next) {
            flushSync(() => setMenu(next));
          },
          close() {
            setMenu(null);
          },
        }),
        [],
      );
      if (!menu) return null;
      return (
        <CanvasContextMenu
          x={menu.x}
          y={menu.y}
          {...(menu.port ? { port: menu.port } : {})}
          onClose={() => {
            menu.port?.anchor.focus({ preventScroll: true });
            setMenu(null);
          }}
          onCreate={async (type) => {
            if (menu.port) {
              setMenu(null);
              await controller.createNodeFromPort?.(menu.port.nodeId, menu.port.side, type);
              return;
            }
            await controller.createNodeAt(type, {
              x: menu.flowX,
              y: menu.flowY,
            });
            setMenu(null);
          }}
          onOpenPoseLibrary={onOpenPoseLibrary ? () => { onOpenPoseLibrary(); setMenu(null); } : undefined}
        />
      );
    },
  ),
);

function CanvasReadySignal({ count, onReady }: { count: number; onReady: () => void }) {
  // Every canvas node has explicit dimensions and handles (archived nodes are
  // filtered out). This mode checks that geometry rather than waiting for the
  // optional DOM `measured` fields, which preset geometry does not populate.
  const initialized = useNodesInitialized({ includeHiddenNodes: true });
  useEffect(() => {
    if (count > 0 && !initialized) return;
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(onReady); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [count, initialized, onReady]);
  return null;
}

// Keep one extra tile around the screen so crossing world zero never exposes an edge.
function positionCanvasPattern(layer: HTMLDivElement | null, viewport: Viewport) {
  if (!layer || !Number.isFinite(viewport.zoom) || viewport.zoom <= 0) return;
  const base = layer.dataset.pattern === "grid" ? 32 : 24;
  let spacing = base * viewport.zoom;
  while (spacing >= base * 4 / 3) spacing /= 2;
  while (spacing < base * 2 / 3) spacing *= 2;
  // Fractional compositor translations blend every dot with its neighbours at
  // once. Align the repeating texture to display pixels, including at a tile wrap.
  const dpr = layer.ownerDocument.defaultView?.devicePixelRatio || 1;
  const tilePixels = Math.max(1, Math.round(spacing * dpr));
  spacing = tilePixels / dpr;
  const offset = (value: number) => {
    const pixels = Math.round((value + 48) * dpr);
    return ((pixels % tilePixels + tilePixels) % tilePixels) / dpr;
  };
  const size = `${spacing}px ${spacing}px`;
  if (layer.style.backgroundSize !== size) layer.style.backgroundSize = size;
  layer.style.transform = `translate3d(${offset(viewport.x)}px, ${offset(viewport.y)}px, 0)`;
}

export interface CanvasDockControls {
  panMode: boolean;
  setPanMode: (enabled: boolean) => void;
  createNode: (type: string) => void;
  openCanvasSettings: (panel: 'background' | 'edges') => void;
}

export function WorkflowCanvas({
  onOpenShortcuts,
  nodes,
  edges,
  selectedEdgeId,
  viewport,
  renderers = {},
  nodeActions,
  controller,
  overlay,
  addNodeMention,
  onOpenPoseLibrary,
  onReady,
  onAutoLayout,
}: {
  nodes: WorkflowNodeData[];
  edges: WorkflowEdge[];
  selectedEdgeId?: string | null;
  viewport: Viewport;
  renderers?: Record<string, WorkflowNodeRenderer>;
  nodeActions: WorkflowNodeActions;
  controller: WorkflowCanvasController;
  overlay?: (controls: CanvasDockControls) => ReactNode;
  onOpenShortcuts?: () => void;
  addNodeMention?: (nodeId: string) => void;
  onOpenPoseLibrary?: (() => void) | undefined;
  onReady?: () => void;
  onAutoLayout?: (options?: { mode?: AgentLayoutMode; includeConnected?: boolean }) => boolean;
}) {
  const initialZoom = Math.min(
    MAX_CANVAS_ZOOM,
    Math.max(MIN_CANVAS_ZOOM, Number(viewport.zoom) || 1),
  );
  const [previewZoom, setPreviewZoom] = useState(initialZoom);
  const flowNodeCache = useRef(new Map<string, FlowNodeCacheEntry>());
  const flowEdgeCache = useRef(new Map<string, FlowEdgeCacheEntry>());
  // useNodesState consumes its argument only on mount; evaluating toFlowNodes
  // on every render both repeats graph work and overwrites the live zoom cache.
  const [initialFlowNodes] = useState(() =>
    toFlowNodes(nodes, edges, flowNodeCache.current),
  );
  const [flowNodes, setFlowNodes, applyFlowNodeChanges] = useNodesState<FlowNode>(initialFlowNodes);
  const [instance, setInstance] = useState<ReactFlowInstance<
    FlowNode,
    Edge<WorkflowEdgeData>
  > | null>(null);
  const appearance = useSyncExternalStore(subscribeDomain, () => settingsStore.canvasAppearance);
  const updateAppearance = async (patch: Partial<CanvasAppearance>) => {
    try { await saveAppSettings({ canvasAppearance: { ...settingsStore.canvasAppearance, ...patch } }); }
    catch (cause) { nodeActions.notify(cause instanceof Error ? cause.message : String(cause)); }
  };
  const [displayRequest, setDisplayRequest] = useState<{ panel: 'background' | 'edges'; revision: number }>();
  const openCanvasSettings = (panel: 'background' | 'edges') => setDisplayRequest(current => ({ panel, revision: (current?.revision || 0) + 1 }));
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [minimapVisible, setMinimapVisible] = useState(false);
  const [historyNodeId, setHistoryNodeId] = useState<string | null>(null);
  const [zoomPercent, setZoomPercent] = useState(() => Math.round(initialZoom * 100));
  const draggingNodeIds = useRef(new Set<string>());
  const [sectionFeedback, setSectionFeedback] = useState<ReadonlyMap<string, SectionDragFeedback>>(new Map());
  const sectionFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (sectionFeedbackTimer.current) clearTimeout(sectionFeedbackTimer.current); }, []);
  const sectionDrag = useRef<{ origin: { x: number; y: number }; canvasOrigin: { x: number; y: number }; members: Map<string, { x: number; y: number; canvasX: number; canvasY: number }> } | null>(null);
  const previewZoomTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewportAnimationFrame = useRef<number | null>(null);
  const canvasRoot = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = canvasRoot.current;
    const dock = root?.querySelector<HTMLElement>('.bottom-mode-switch');
    const controls = root?.querySelector<HTMLElement>('.canvas-corner-controls');
    if (!root || !dock || !controls) return;
    const measure = () => {
      const bounds = root.getBoundingClientRect();
      const view = controls.getBoundingClientRect();
      const bar = dock.getBoundingClientRect();
      const layout = canvasBottomRowLayout(view, { left: bounds.left + 16, right: bounds.right - 16 }, bar.width, 16);
      root.style.setProperty('--canvas-main-toolbar-shift', `${layout.shift}px`);
      root.style.setProperty('--canvas-view-bottom', layout.stacked ? `${bar.height + 32}px` : `${16 + (bar.height - view.height) / 2}px`);
    };
    const observer = new ResizeObserver(measure);
    for (const element of [root, dock, controls]) observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);
  const [panMode, setPanMode] = useState(false);
  const [canvasOverlayRoot, setCanvasOverlayRoot] = useState<HTMLElement | null>(null);
  const menuLayer = useRef<CanvasMenuLayerHandle>(null);
  const [pluginContext, setPluginContext] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const visible = useMemo(() => nodes.filter((node) => !node.archived), [nodes]);
  const canonicalNodes = useMemo(
    () => toFlowNodes(visible, edges, flowNodeCache.current),
    [edges, visible],
  );
  useEffect(() => {
    traceCanvasEvent("external-sync", {
      canonicalIds: canonicalNodes.map((node) => node.id),
      positions: canonicalNodes.map((node) => [node.id, node.position.x, node.position.y]),
    });
    setFlowNodes((current) => {
      return reconcileCanvasNodes(current, canonicalNodes, draggingNodeIds.current);
    });
  }, [canonicalNodes]);
  const renderedNodes = flowNodes;
  const renderedNodesRef = useRef(renderedNodes);
  renderedNodesRef.current = renderedNodes;
  // A selected section moves its children through the existing controller;
  // do not independently align those same children a second time.
  const layoutSelection = useMemo(() => {
    const selectedSections = new Set(visible.filter(node => node.selected && node.type === 'canvasSection').map(node => node.id));
    return visible.filter(node => node.selected && !selectedSections.has(String(node.canvasSectionId || '')));
  }, [visible]);
  const alignSelection = (mode: CanvasAlignment) => {
    const positions = alignCanvasSelection(layoutSelection.map(node => ({
      id: node.id, x: Number(node.x) || 0, y: Number(node.y) || 0, ...nodeDimensions(node),
    })), mode);
    if (positions.length) controller.moveNodes(positions);
  };
  const ids = useMemo(() => new Set(visible.map((node) => node.id)), [visible]);
  const visibleById = useMemo(() => new Map(visible.map((node) => [node.id, node])), [visible]);
  const flowEdges = useMemo<Array<Edge<WorkflowEdgeData>>>(
    () => {
      const result = edges
        .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
        .map((edge) => {
          const source = visibleById.get(edge.source);
          const target = visibleById.get(edge.target);
          const sourceCenter = Number(source?.x || 0) + nodeDimensions(source!).width / 2;
          const targetCenter = Number(target?.x || 0) + nodeDimensions(target!).width / 2;
          const targetIsRight = targetCenter >= sourceCenter;
          const sourceHandle = edge.sourceHandle?.startsWith("storyboard-") ? edge.sourceHandle
            : targetIsRight ? "port-right" : "port-left";
          const batchColumnId = edge.data?.batchColumnId;
          const batchCell = Boolean(parseBatchCellHandle(edge.targetHandle));
          const targetHandle = target?.type === 'batchTable' && typeof batchColumnId === 'string' && batchColumnId
            ? batchColumnHandle(batchColumnId)
            : batchCell || edge.targetHandle?.startsWith("storyboard") || edge.targetHandle?.startsWith("batch-reference:")
              ? edge.targetHandle ?? null
              : targetIsRight ? "port-left" : "port-right";
          const selected = edge.id === selectedEdgeId;
          const connectedHighlight = Boolean(source?.selected || target?.selected);
          const signature = JSON.stringify([
            edge,
            sourceHandle,
            targetHandle,
            selected,
            connectedHighlight,
          ]);
          const cached = flowEdgeCache.current.get(edge.id);
          if (cached?.signature === signature) return cached.output;
          const output: Edge<WorkflowEdgeData> = {
            ...edge,
            sourceHandle,
            targetHandle,
            selected,
            className: connectedHighlight ? 'canvas-edge-connected-highlight' : '',
            type: "connection",
            ...(batchCell ? { zIndex: 11 } : {}),
          };
          flowEdgeCache.current.set(edge.id, { signature, output });
          return output;
        });
      const liveEdgeIds = new Set(result.map((edge) => edge.id));
      for (const id of flowEdgeCache.current.keys()) {
        if (!liveEdgeIds.has(id)) flowEdgeCache.current.delete(id);
      }
      return result;
    },
    [edges, ids, visibleById, selectedEdgeId],
  );
  const displayedEdges = useMemo(
    () => flowEdges.filter(edge => canvasEdgeVisible(edge, appearance.edges)),
    [flowEdges, appearance.edges],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      // Node lifetime is owned by the project graph. React Flow remove changes
      // are not allowed to transiently delete a controlled node during a drag.
      const interactiveChanges = changes.filter((change) => change.type !== "remove");
      if (import.meta.env.DEV) traceCanvasEvent("nodes-change", {
        changes: changes.map((change) => ({
          id: "id" in change ? change.id : change.item.id,
          type: change.type,
          dragging: change.type === "position" ? change.dragging : undefined,
          position: change.type === "position" ? change.position : undefined,
        })),
      });
      if (interactiveChanges.length) applyFlowNodeChanges(interactiveChanges);
      const selection = interactiveChanges.filter((change) => change.type === "select");
      if (selection.length) {
        const selected = new Set(
          applyNodeChanges(interactiveChanges, renderedNodesRef.current)
            .filter((node) => node.selected)
            .map((node) => node.id),
        );
        controller.selectNodes([...selected]);
      }
    },
    [applyFlowNodeChanges, controller],
  );
  const sectionIndex = useMemo(() => {
    const sections = visible.filter(node => node.type === 'canvasSection');
    const owners = new Map<string, string>();
    for (const section of sections) {
      for (const member of canvasSectionMembers(section, visible)) owners.set(member.id, section.id);
    }
    return { sections, owners };
  }, [visible]);
  const previewSectionDrop = useCallback((active: FlowNode[]) => {
    const feedback = new Map<string, SectionDragFeedback>();
    // Moving a frame carries its members; it does not reassign them to frames underneath.
    if (active.some(item => item.data.node.type === 'canvasSection')) return feedback;
    for (const item of active) {
      const node = item.data.node;
      const target = canvasSectionDropTarget({ ...node,
        x: Math.round(item.position.x), y: Math.round(item.position.y),
      }, sectionIndex.sections);
      const owner = sectionIndex.owners.get(node.id);
      if (owner && owner !== target?.id && !feedback.has(owner)) feedback.set(owner, 'leave');
      if (target && feedback.get(target.id) !== 'join') feedback.set(target.id, owner === target.id ? 'inside' : 'join');
    }
    return feedback;
  }, [sectionIndex]);
  const showSectionFeedback = useCallback((next: ReadonlyMap<string, SectionDragFeedback>) => {
    setSectionFeedback(current => current.size === next.size && [...next].every(([id, state]) => current.get(id) === state) ? current : next);
  }, []);
  const onNodeDragStart: OnNodeDrag<FlowNode> = useCallback(
    (_event, node, draggedNodes) => {
      if (sectionFeedbackTimer.current) clearTimeout(sectionFeedbackTimer.current);
      const activeNodes = draggedNodes.length ? draggedNodes : [node];
      showSectionFeedback(previewSectionDrop(activeNodes));
      activeNodes.forEach((item) => draggingNodeIds.current.add(item.id));
      const activeIds = new Set(activeNodes.map(item => item.id));
      const members = new Map<string, { x: number; y: number; canvasX: number; canvasY: number }>();
      for (const section of activeNodes.filter(item => item.data.node.type === 'canvasSection')) {
        for (const member of canvasSectionMembers(section.data.node, visible)) {
          if (activeIds.has(member.id)) continue;
          const flow = renderedNodesRef.current.find(item => item.id === member.id);
          if (flow) members.set(member.id, { ...flow.position, canvasX: Number(member.x) || 0, canvasY: Number(member.y) || 0 });
        }
      }
      members.forEach((_position, id) => draggingNodeIds.current.add(id));
      sectionDrag.current = { origin: { ...node.position }, canvasOrigin: { x: Number(node.data.node.x) || 0, y: Number(node.data.node.y) || 0 }, members };
    },
    [visible, previewSectionDrop, showSectionFeedback],
  );
  const onNodeDrag: OnNodeDrag<FlowNode> = useCallback((_event, node, draggedNodes) => {
    if (sectionIndex.sections.length) showSectionFeedback(previewSectionDrop(draggedNodes.length ? draggedNodes : [node]));
    const drag = sectionDrag.current;
    if (!drag?.members.size) return;
    const dx = node.position.x - drag.origin.x;
    const dy = node.position.y - drag.origin.y;
    setFlowNodes(current => current.map(item => {
      const origin = drag.members.get(item.id);
      return origin ? { ...item, position: { x: origin.x + dx, y: origin.y + dy } } : item;
    }));
  }, [setFlowNodes, previewSectionDrop, sectionIndex.sections.length, showSectionFeedback]);
  const onNodeDragStop: OnNodeDrag<FlowNode> = useCallback(
    (_event, node, draggedNodes) => {
      const stoppedNodes = draggedNodes.length ? draggedNodes : [node];
      stoppedNodes.forEach((item) => draggingNodeIds.current.delete(item.id));
      const moved = draggedCanvasPositions(node, draggedNodes, 1);
      const drag = sectionDrag.current;
      if (drag) {
        const dx = Math.round(node.position.x) - drag.canvasOrigin.x;
        const dy = Math.round(node.position.y) - drag.canvasOrigin.y;
        for (const [id, origin] of drag.members) {
          moved.push({ id, x: origin.canvasX + dx, y: origin.canvasY + dy });
          draggingNodeIds.current.delete(id);
        }
      }
      sectionDrag.current = null;
      const movedById = new Map(moved.map((item) => [item.id, item]));
      setFlowNodes((current) => current.map((item) => {
        const position = movedById.get(item.id);
        if (!position) return item;
        return {
          ...item,
          dragging: false,
          position: { x: position.x, y: position.y },
        };
      }));
      traceCanvasEvent("drag-stop", { moved });
      if (moved.length) controller.moveNodes(moved);
      const joined = new Map<string, SectionDragFeedback>();
      for (const [id, state] of previewSectionDrop(stoppedNodes)) {
        if (state === 'join') joined.set(id, 'joined');
      }
      showSectionFeedback(joined);
      if (joined.size) sectionFeedbackTimer.current = setTimeout(() => showSectionFeedback(new Map()), 900);
    },
    [controller, setFlowNodes, previewSectionDrop, showSectionFeedback],
  );
  useEffect(() => {
    // A cancelled pointer or a deactivated window may never deliver mouseup.
    // Finish through the drag library so it releases capture and emits the
    // same final node positions/history as an ordinary release.
    const finishInterruptedDrag = (event: Event) => {
      if (!draggingNodeIds.current.size) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      window.dispatchEvent(new MouseEvent("mouseup", { view: window, button: 0, buttons: 0 }));
    };
    window.addEventListener("pointercancel", finishInterruptedDrag);
    window.addEventListener("blur", finishInterruptedDrag);
    window.addEventListener("keydown", finishInterruptedDrag, true);
    return () => {
      window.removeEventListener("pointercancel", finishInterruptedDrag);
      window.removeEventListener("blur", finishInterruptedDrag);
      window.removeEventListener("keydown", finishInterruptedDrag, true);
    };
  }, []);
  const wheelOwnership = useMemo(createCanvasWheelOwnership, []);
  const pendingViewportSave = useRef<{ timer: ReturnType<typeof setTimeout>; viewport: Viewport } | null>(null);
  const scheduleViewportSave = useCallback((viewport: Viewport) => {
    if (pendingViewportSave.current) clearTimeout(pendingViewportSave.current.timer);
    const timer = setTimeout(() => {
      pendingViewportSave.current = null;
      controller.saveViewport(viewport);
    }, CANVAS_WHEEL_IDLE_MS);
    pendingViewportSave.current = { timer, viewport };
  }, [controller]);
  useEffect(() => () => {
    if (pendingViewportSave.current) {
      clearTimeout(pendingViewportSave.current.timer);
      controller.saveViewport(pendingViewportSave.current.viewport);
      pendingViewportSave.current = null;
    }
  }, [controller]);
  const onMoveEnd: OnMoveEnd = useCallback((event, next) => {
    if (event) scheduleViewportSave(next);
  }, [scheduleViewportSave]);
  const cancelViewportAnimation = useCallback(() => {
    if (viewportAnimationFrame.current !== null) cancelAnimationFrame(viewportAnimationFrame.current);
    viewportAnimationFrame.current = null;
  }, []);
  useEffect(() => () => {
    if (previewZoomTimer.current !== null) clearTimeout(previewZoomTimer.current);
    cancelViewportAnimation();
  }, [cancelViewportAnimation]);

  const applyCanvasViewport = useCallback((next: Viewport) => {
    if (!instance) return;
    const previousZoom = instance.getZoom();
    void instance.setViewport(next);
    scheduleViewportSave(next);
    if (next.zoom === previousZoom) return;
    setZoomPercent(Math.round(next.zoom * 100));
    if (previewZoomTimer.current !== null) clearTimeout(previewZoomTimer.current);
    previewZoomTimer.current = setTimeout(() => {
      previewZoomTimer.current = null;
      setPreviewZoom(next.zoom);
    }, MEDIA_PREVIEW_ZOOM_SETTLE_MS);
  }, [instance, scheduleViewportSave]);

  const patternLayer = useRef<HTMLDivElement>(null);
  const bindPattern = useCallback((element: HTMLDivElement | null) => {
    patternLayer.current = element;
    if (instance) positionCanvasPattern(element, instance.getViewport());
  }, [instance, appearance.pattern]);
  const onCameraMove = useCallback((_event: unknown, next: Viewport) => {
    controller.onViewportActivity?.();
    positionCanvasPattern(patternLayer.current, next);
  }, [controller]);

  // Keep the world and viewport subscribers on the same coordinates throughout the gesture.
  const wheelPan = useMemo(() => createCanvasWheelPan({
    read: () => instance?.getViewport() ?? { x: 0, y: 0 },
    apply: position => {
      if (instance) applyCanvasViewport({ ...position, zoom: instance.getZoom() });
    },
  }), [instance, applyCanvasViewport]);
  useEffect(() => () => wheelPan.dispose(), [wheelPan]);
  const setCanvasZoomAt = useCallback((requestedZoom: number, clientPoint?: { x: number; y: number }) => {
    const bounds = canvasRoot.current?.getBoundingClientRect();
    if (!instance || !bounds) return;
    wheelPan.flush();
    const current = instance.getViewport();
    const zoom = Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, requestedZoom));
    if (Math.abs(zoom - current.zoom) < 0.0005) return;
    cancelViewportAnimation();
    const center = clientPoint
      ? { x: clientPoint.x - bounds.left, y: clientPoint.y - bounds.top }
      : { x: bounds.width / 2, y: bounds.height / 2 };
    applyCanvasViewport(zoomViewportAt(current, zoom, center));
  }, [instance, applyCanvasViewport, cancelViewportAnimation, wheelPan]);
  const wheelZoom = useMemo(() => createCanvasWheelZoom({
    readZoom: () => instance?.getZoom() ?? 1,
    applyZoom: setCanvasZoomAt,
    min: MIN_CANVAS_ZOOM,
    max: MAX_CANVAS_ZOOM,
  }), [instance, setCanvasZoomAt]);
  useEffect(() => () => wheelZoom.dispose(), [wheelZoom]);
  useEffect(() => {
    const root = canvasRoot.current;
    if (!root) return;
    // React's delegated wheel listener is passive. Own cancellation at the
    // canvas boundary so scrolling inputs and portalled dialogs remain native.
    const onWheel = (event: WheelEvent) => {
      if (!isCanvasDomEvent(event, root)) return;
      const target = event.target instanceof Element ? event.target : null;
      if (event.defaultPrevented || !target || target.closest(
        '.ant-modal,.ant-dropdown,.ant-select-dropdown,.ant-popover,[role="dialog"],[role="menu"],[role="listbox"]',
      )) return;

      const zooming = event.ctrlKey || event.metaKey;
      const horizontal = event.shiftKey && !event.deltaX;
      const dx = horizontal ? event.deltaY : event.deltaX;
      const dy = horizontal ? 0 : event.deltaY;
      const owner = wheelOwnership.resolve(event.timeStamp, zooming || event.shiftKey, () => {
        if (Math.abs(dx) > Math.abs(dy)) return false;
        if (target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),audio[controls],video[controls]')) return true;
        const scroll = target.closest('.nowheel');
        if (!scroll) return false;
        const overflow = getComputedStyle(scroll);
        return (dy !== 0 && scroll.scrollHeight > scroll.clientHeight && /^(auto|scroll)$/.test(overflow.overflowY))
          || (dx !== 0 && scroll.scrollWidth > scroll.clientWidth && /^(auto|scroll)$/.test(overflow.overflowX));
      });
      if (owner === 'content') return;
      event.preventDefault();
      event.stopPropagation();

      if (event.buttons || draggingNodeIds.current.size) return;
      cancelViewportAnimation();
      if (zooming) {
        wheelZoom.enqueue(event.deltaY, { x: event.clientX, y: event.clientY });
        return;
      }
      wheelPan.enqueue(dx, dy, event.deltaMode, event.deltaMode === 2 ? root.clientHeight : 0);
    };
    root.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => root.removeEventListener('wheel', onWheel, { capture: true });
  }, [wheelZoom, wheelPan, wheelOwnership, cancelViewportAnimation]);
  const changeZoom = (delta: number) => {
    const zoom = Math.round(((instance?.getZoom() ?? initialZoom) + delta) * 10) / 10;
    setCanvasZoomAt(zoom);
  };
  const animateCanvasViewport = useCallback((target: Viewport, duration: number) => {
    if (!instance) return;
    cancelViewportAnimation();
    wheelZoom.dispose();
    wheelPan.flush();
    const current = instance.getViewport();
    const startedAt = performance.now();
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      if (progress === 1) {
        viewportAnimationFrame.current = null;
        applyCanvasViewport(target);
        return;
      }
      const eased = 1 - Math.pow(1 - progress, 3);
      applyCanvasViewport({
        x: current.x + (target.x - current.x) * eased,
        y: current.y + (target.y - current.y) * eased,
        zoom: current.zoom + (target.zoom - current.zoom) * eased,
      });
      viewportAnimationFrame.current = requestAnimationFrame(animate);
    };
    viewportAnimationFrame.current = requestAnimationFrame(animate);
  }, [instance, applyCanvasViewport, cancelViewportAnimation, wheelPan, wheelZoom]);
  const fitCanvasView = useCallback(() => {
    if (!instance || !canvasRoot.current) return;
    const bounds = canvasRoot.current.getBoundingClientRect();
    if (!visible.length) {
      animateCanvasViewport({ x: 0, y: 0, zoom: 1 }, 240);
      return;
    }
    const nodeBounds = visible.reduce(
      (result, node) => {
        const dimensions = nodeDimensions(node);
        const x = Number(node.x) || 0;
        const y = Number(node.y) || 0;
        result.minX = Math.min(result.minX, x);
        result.minY = Math.min(result.minY, y);
        result.maxX = Math.max(result.maxX, x + dimensions.width);
        result.maxY = Math.max(result.maxY, y + dimensions.height);
        return result;
      },
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    const contentWidth = Math.max(1, nodeBounds.maxX - nodeBounds.minX);
    const contentHeight = Math.max(1, nodeBounds.maxY - nodeBounds.minY);
    const zoom = Math.min(
      MAX_CANVAS_ZOOM,
      Math.max(
        MIN_CANVAS_ZOOM,
        Math.min((bounds.width * 0.78) / contentWidth, (bounds.height * 0.78) / contentHeight),
      ),
    );
    const x = screenPixel(bounds.width / 2 - ((nodeBounds.minX + nodeBounds.maxX) / 2) * zoom);
    const y = screenPixel(bounds.height / 2 - ((nodeBounds.minY + nodeBounds.maxY) / 2) * zoom);
    animateCanvasViewport({ x, y, zoom }, 240);
  }, [instance, animateCanvasViewport, visible]);
  /**
   * 把目标节点居中，走一次 360ms 缓动。keepZoom 给小地图这类"只挪视野"的入口用：
   * 语义缩放会连节点内容一起放大，为了一个概览点击把画面推到贴合尺寸会让过渡失去参照。
   */
  const focusCanvasNodes = useCallback((
    nodeIds: string[],
    options?: { keepZoom?: boolean },
  ) => {
    if (!instance || !canvasRoot.current) return;
    const ids = new Set(nodeIds);
    const targets = visible.filter((node) => ids.has(node.id));
    if (!targets.length) return;
    const bounds = targets.reduce((result, node) => {
      const dimensions = nodeDimensions(node);
      const x = Number(node.x) || 0;
      const y = Number(node.y) || 0;
      return {
        minX: Math.min(result.minX, x), minY: Math.min(result.minY, y),
        maxX: Math.max(result.maxX, x + dimensions.width),
        maxY: Math.max(result.maxY, y + dimensions.height),
      };
    }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    const viewport = canvasRoot.current.getBoundingClientRect();
    const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
    const contentHeight = Math.max(1, bounds.maxY - bounds.minY);
    const singleNodeFocus = targets.length === 1;
    const zoom = options?.keepZoom
      ? instance.getZoom()
      : Math.min(
        MAX_CANVAS_ZOOM,
        Math.max(
          singleNodeFocus ? 0.78 : MIN_CANVAS_ZOOM,
          Math.min(
            (viewport.width * (singleNodeFocus ? 0.82 : 0.68)) / contentWidth,
            (viewport.height * (singleNodeFocus ? 0.72 : 0.68)) / contentHeight,
          ),
        ),
      );
    const x = screenPixel(viewport.width / 2 - (bounds.minX + bounds.maxX) / 2 * zoom);
    const y = screenPixel(viewport.height / 2 - (bounds.minY + bounds.maxY) / 2 * zoom);
    animateCanvasViewport({ x, y, zoom }, 360);
  }, [instance, animateCanvasViewport, visible]);
  useEffect(() => {
    controller.registerFitView?.(instance ? fitCanvasView : null);
    return () => controller.registerFitView?.(null);
  }, [controller, fitCanvasView, instance]);
  useEffect(() => {
    controller.registerFocusNodes?.(instance ? focusCanvasNodes : null);
    return () => controller.registerFocusNodes?.(null);
  }, [controller, focusCanvasNodes, instance]);
  // MiniMap 内部用 useCallback([]) 冻结节点点击回调，只在挂载那一刻捕获一次闭包；
  // 入口因此只读一份最新实现，避免拿到挂载时的 instance 与节点快照。
  const focusNodesRef = useRef(focusCanvasNodes);
  focusNodesRef.current = focusCanvasNodes;
  const focusNodesFromCanvas = useCallback((nodeIds: string[]) => focusNodesRef.current(nodeIds), []);
  const minimapNodeClick = useRef<(nodeId: string) => void>(() => {});
  minimapNodeClick.current = (nodeId: string) => {
    controller.selectNodes([nodeId]);
    focusCanvasNodes([nodeId], { keepZoom: true });
  };
  function createNodeFromDock(type: string) {
    const bounds = canvasRoot.current?.getBoundingClientRect();
    if (!bounds || !instance) return;
    const center = instance.screenToFlowPosition({
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    }, { snapToGrid: false });
    void controller.createNodeAt(type, center);
  }
  function openMenu(event: globalThis.MouseEvent | ReactMouseEvent<Element>) {
    event.preventDefault();
    const bounds = canvasRoot.current?.getBoundingClientRect();
    if (!bounds) return;
    const menuPosition = canvasMenuPosition(event.clientX, event.clientY, bounds);
    const point = instance?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) || {
      x: 120,
      y: 90,
    };
    menuLayer.current?.open({
      x: menuPosition.x,
      y: menuPosition.y,
      flowX: point.x,
      flowY: point.y,
    });
  }
  const openPortMenu = useCallback((nodeId: string, side: CanvasPortSide, anchor: HTMLElement) => {
    const bounds = canvasRoot.current?.getBoundingClientRect();
    const allowedTypes = controller.portNodeTypes?.(nodeId, side);
    if (!bounds || !allowedTypes?.length) {
      menuLayer.current?.close();
      return;
    }
    const port = anchor.getBoundingClientRect();
    const clientX = side === 'left' ? port.left : port.right;
    const clientY = port.top + port.height / 2;
    const position = canvasMenuPosition(clientX, clientY, bounds, allowedTypes.length * 38 + 40, side);
    menuLayer.current?.open({ ...position, flowX: 0, flowY: 0, port: { nodeId, side, allowedTypes, anchor } });
  }, [controller]);

  function onArtifactDragOver(event: ReactDragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes(ARTIFACT_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }
  function onArtifactDrop(event: ReactDragEvent<HTMLElement>) {
    const artifactId = event.dataTransfer.getData(ARTIFACT_DRAG_TYPE);
    if (!artifactId || !instance) return;
    event.preventDefault();
    event.stopPropagation();
    const point = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    void controller.createArtifactNodeAt(artifactId, {
      x: point.x,
      y: point.y,
    });
  }
  const bindCanvasRoot = useCallback((element: HTMLElement | null) => {
    canvasRoot.current = element;
    setCanvasOverlayRoot(element);
  }, []);

  return (
    <RendererContext.Provider value={renderers}>
      <ActionContext.Provider value={nodeActions}>
        <MentionContext.Provider value={addNodeMention || null}>
        <CanvasPreviewZoomContext.Provider value={previewZoom}>
        <CanvasOverlayRootContext.Provider value={canvasOverlayRoot}>
        <CanvasFocusNodesContext.Provider value={focusNodesFromCanvas}>
        <CanvasHistoryContext.Provider value={setHistoryNodeId}>
        <SectionDragFeedbackContext.Provider value={sectionFeedback}>
        <CanvasSectionNodesContext.Provider value={visible}>
        <CanvasPortMenuContext.Provider value={openPortMenu}>
        <section
          ref={bindCanvasRoot}
          onDragOver={onArtifactDragOver}
          onDrop={onArtifactDrop}
          data-pattern={appearance.pattern}
          data-pointer-tool={panMode ? "pan" : "select"}
          data-color={appearance.color}
          className="react-workflow-canvas"
          tabIndex={0}
          onPointerDownCapture={(event) => {
            if (!isCanvasDomEvent(event.nativeEvent, event.currentTarget)) return;
            cancelViewportAnimation();
            wheelOwnership.reset();
            wheelZoom.dispose();
            wheelPan.flush();
            const target = event.target as Element;
            if (!target.closest("input,textarea,select,button,iframe,[contenteditable=true]")) {
              event.currentTarget.focus({ preventScroll: true });
            }
          }}
          onFocusCapture={() => wheelPan.flush()}
          onKeyDownCapture={() => wheelPan.flush()}
          onDragEnterCapture={() => wheelPan.flush()}
          onKeyDown={(event) => {
            if (!isCanvasDomEvent(event.nativeEvent, event.currentTarget)) return;
            const editable = isEditableCanvasEvent(event.nativeEvent);
            const command = event.metaKey || event.ctrlKey;
            const key = event.key.toLowerCase();
            if ((event.key === "Backspace" || event.key === "Delete") && !editable) {
              event.preventDefault();
              event.stopPropagation();
              controller.deleteSelection();
            }
            if (!editable && command && key === "c") {
              event.preventDefault();
              void controller.copySelection?.(event.shiftKey);
            }
            if (!editable && command && key === "v") {
              event.preventDefault();
              void controller.pasteSelection?.();
            }
            if (!editable && command && key === 'g') {
              event.preventDefault();
              controller.createSection?.();
            }
            if (!editable && command && event.shiftKey && key === 'l') {
              const sections = visible.filter(node => node.type === 'canvasSection' && node.selected);
              if (sections.length) {
                event.preventDefault();
                for (const section of sections) nodeActions.arrangeSection?.(section.id);
              }
            }
            if (!editable && command && key === "a") {
              event.preventDefault();
              const selectedType = event.shiftKey
                ? renderedNodes.find((node) => node.selected)?.data.node.type
                : "";
              controller.selectNodes(
                renderedNodes
                  .filter((node) => !selectedType || node.data.node.type === selectedType)
                  .map((node) => node.id),
              );
            }
            if (!editable && command && key === "l") {
              event.preventDefault();
              void updateAppearance({ edges: appearance.edges === "hidden" ? "all" : "hidden" });
            }
            if (!editable && command && key === "z") {
              event.preventDefault();
              event.shiftKey ? controller.redo?.() : controller.undo?.();
            }
            if (!editable && command && event.key === "Enter") {
              event.preventDefault();
              controller.runSelection?.(event.shiftKey);
            }
            if (!editable && event.key === "Escape") {
              menuLayer.current?.close();
              controller.selectNodes([]);
              controller.selectEdge(null);
            }
            if (
              !editable &&
              ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)
            ) {
              event.preventDefault();
              const step = event.shiftKey ? 10 : 1;
              const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
              const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
              const moved = renderedNodes
                .filter((node) => node.selected)
                .map((node) => ({
                  id: node.id,
                  x: node.position.x + dx,
                  y: node.position.y + dy,
                }));
              if (moved.length) {
                setFlowNodes((current) =>
                  current.map((node) => {
                    const next = moved.find((item) => item.id === node.id);
                    return next
                      ? {
                          ...node,
                          position: {
                            x: next.x,
                            y: next.y,
                          },
                        }
                      : node;
                  }),
                );
                controller.moveNodes(moved);
              }
            }
          }}
          onDoubleClick={(event) => {
            if ((event.target as Element).classList.contains("react-flow__pane")) openMenu(event);
          }}
        >
          {appearance.pattern !== "solid" && <div aria-hidden="true" className="canvas-world-pattern" data-pattern={appearance.pattern} ref={bindPattern} />}
          {pluginContext && <PluginNodeContextMenu key={pluginContext.nodeId} {...pluginContext} onClose={() => setPluginContext(null)} />}
          <ReactFlow
            onNodeContextMenu={(event, flowNode) => {
              const node = flowNode.data.node;
              if (!capabilitiesForNode(node, undefined, 'contextMenu').length) return;
              event.preventDefault(); event.stopPropagation();
              setPluginContext({ nodeId: node.id, x: event.clientX, y: event.clientY });
            }}
            nodes={renderedNodes}
            edges={displayedEdges}
            nodeTypes={nodeTypes}
            proOptions={{ hideAttribution: true }}
            edgeTypes={canvasEdgeTypes}
            connectionLineComponent={CanvasConnectionDraft}
            onlyRenderVisibleElements={false}
            defaultViewport={{ x: viewport.x, y: viewport.y, zoom: initialZoom }}
            minZoom={MIN_CANVAS_ZOOM}
            maxZoom={MAX_CANVAS_ZOOM}
            nodesDraggable={!panMode}
            autoPanOnNodeDrag={false}
            nodesConnectable
            connectOnClick
            connectionMode={ConnectionMode.Loose}
            connectionRadius={64 / Math.max(MIN_CANVAS_ZOOM, zoomPercent / 100)}
            selectionOnDrag={!panMode}
            panOnDrag={panMode ? [0, 1, 2] : [1, 2]}
            preventScrolling={false}
            zoomActivationKeyCode={null}
            zoomOnScroll={false}
            zoomOnPinch={false}
            zoomOnDoubleClick={false}
            multiSelectionKeyCode={["Meta", "Control", "Shift"]}
            deleteKeyCode={null}
            onInit={setInstance}
            onNodesChange={onNodesChange}
            onNodeDragStart={onNodeDragStart}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            elevateNodesOnSelect={false}
            onConnect={(connection) => void controller.connect(connection)}
            onEdgeClick={(_event, edge) => controller.selectEdge(edge.id)}
            onPaneClick={() => {
              menuLayer.current?.close();
              controller.selectNodes([]);
              controller.selectEdge(null);
            }}
            onMove={onCameraMove}
            onMoveEnd={onMoveEnd}
            onPaneContextMenu={openMenu}
          >
            {instance && onReady && <CanvasReadySignal count={renderedNodes.length} onReady={onReady} />}
            {minimapVisible && (
              <CanvasMinimap onNodeClick={nodeId => minimapNodeClick.current(nodeId)} onViewportChange={controller.saveViewport} />
            )}
          </ReactFlow>
          {!visible.length && (
            <div className="canvas-empty-copy">
              <span className="canvas-empty-graph" aria-hidden="true">
                <svg viewBox="0 0 188 112" fill="none">
                  <path className="canvas-empty-edge" d="M 56 56 C 92 56 96 24 132 24" />
                  <path className="canvas-empty-edge" d="M 56 56 C 92 56 96 88 132 88" />
                  {CANVAS_EMPTY_NODES.map((node) => (
                    <g key={`${node.x}-${node.y}`} className="canvas-empty-node">
                      <rect
                        className="canvas-empty-card"
                        x={node.x}
                        y={node.y}
                        width="52"
                        height="32"
                        rx="7"
                      />
                      <rect x={node.x + 8} y={node.y + 9} width="22" height="4" rx="2" className="canvas-empty-bar" />
                      <rect x={node.x + 8} y={node.y + 19} width="34" height="4" rx="2" className="canvas-empty-bar canvas-empty-bar-soft" />
                      <circle className="canvas-empty-port" cx={node.x + node.portX} cy={node.y + 16} r="2.4" />
                    </g>
                  ))}
                </svg>
              </span>
              <div className="canvas-empty-text">
                <strong>{t("ui.WorkflowCanvas.text.cc0866d6")}{t("ui.WorkflowCanvas.text.a360c413")}</strong>
                <small>
                  {t("ui.WorkflowCanvas.text.eb168abe")}<i /> {t("ui.WorkflowCanvas.text.e29468f5")}<i /> {t("ui.WorkflowCanvas.text.1351cfc7")}
                </small>
              </div>
            </div>
          )}
          <CanvasMenuLayer ref={menuLayer} controller={controller} onOpenPoseLibrary={onOpenPoseLibrary} />
          {layoutSelection.length > 1 && <div className="canvas-selection-layout" onPointerDown={event => event.stopPropagation()}>
            <Dropdown menu={{ items: (['left', 'centerX', 'right', 'top', 'centerY', 'bottom', 'distributeX', 'distributeY'] as const).map(mode => ({
              key: mode, label: t(`canvas.selection.${mode}`), disabled: mode.startsWith('distribute') && layoutSelection.length < 3,
            })), onClick: ({ key }) => alignSelection(key as CanvasAlignment) }} trigger={['click']}>
              <Button>{t('canvas.selection.align')}</Button>
            </Dropdown>
          </div>}
          <div
            className="canvas-corner-controls"
            role="toolbar" aria-label={t('canvas.view.controls')}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="canvas-view-pill">
              <CanvasDisplaySettings appearance={appearance} onChange={updateAppearance} onAutoLayout={onAutoLayout} layoutOnly {...(displayRequest ? { requestedPanel: displayRequest } : {})} />
              <button className="canvas-corner-map" type="button" title={t('canvas.view.connections')} aria-label={t('canvas.view.connections')} aria-pressed={appearance.edges === 'hidden'} onClick={() => void updateAppearance({ edges: appearance.edges === 'hidden' ? 'all' : 'hidden' })}><CircleDashed /></button>
              <span className="canvas-corner-divider" aria-hidden="true" />
              <div className="canvas-zoom-group">
              <Popover trigger="click" placement="topLeft" open={zoomMenuOpen} onOpenChange={setZoomMenuOpen} arrow={false} styles={{ container: { padding: 4 } }} content={
                <div className="canvas-precision-menu" onKeyDown={event => { if (event.key === 'Escape') setZoomMenuOpen(false); }}>
                  <button type="button" onClick={() => changeZoom(0.1)}><IconSymbol name="plus" />{t('ui.WorkflowCanvas.title.55c0d6cc')}</button>
                  <button type="button" onClick={() => changeZoom(-0.1)}><IconSymbol name="minus" />{t('ui.WorkflowCanvas.title.b7f9e266')}</button>
                  <hr />
                  <button type="button" onClick={fitCanvasView}><IconSymbol name="maximize" />{t('ui.WorkflowCanvas.title.d598a5cd')}</button>
                  <button type="button" onClick={() => changeZoom(1 - (instance?.getZoom() || 1))}><IconSymbol name="undo" />100%</button>
                  <hr />
                  <div className="canvas-precision-range"><Slider min={MIN_CANVAS_ZOOM * 100} max={200} step={1} value={zoomPercent} tooltip={{ open: false }} ariaLabelForHandle={t('canvas.zoom.precise')} onChange={percent => changeZoom(percent / 100 - (instance?.getZoom() || 1))} /><span>{zoomPercent}%</span></div>
                  <div className="canvas-precision-stops">{[25, 50, 100, 200].map(percent => <button type="button" key={percent} onClick={() => changeZoom(percent / 100 - (instance?.getZoom() || 1))}>{percent}%</button>)}</div>
                </div>
              }>
                <button className="canvas-zoom-value" type="button" title={t('canvas.zoom.precise')} aria-label={t('canvas.zoom.precise')} aria-haspopup="dialog" aria-expanded={zoomMenuOpen}>
                  <Search /><span>{zoomPercent}%</span>
                </button>
              </Popover>
              </div>
            <button
              className={`canvas-corner-map${minimapVisible ? " active" : ""}`}
              type="button"
              title={t("ui.WorkflowCanvas.title.088baf55")} aria-label={t("ui.WorkflowCanvas.title.088baf55")} aria-pressed={minimapVisible}
              onClick={() => setMinimapVisible((visible) => !visible)}
            >
              <MapIcon />
            </button>
            </div>
            <button type="button" className="canvas-view-help" aria-label={t('ui.BottomModeBar.title.31e33107')} title={t('ui.BottomModeBar.title.31e33107')} onClick={onOpenShortcuts}><CircleHelp /></button>
          </div>
          {overlay?.({ panMode, setPanMode, createNode: createNodeFromDock, openCanvasSettings })}
        </section>
        <GenerationHistoryDialog
          open={Boolean(historyNodeId)}
          nodeId={historyNodeId || ''}
          onClose={() => setHistoryNodeId(null)}
        />
        </CanvasPortMenuContext.Provider>
        </CanvasSectionNodesContext.Provider>
        </SectionDragFeedbackContext.Provider>
        </CanvasHistoryContext.Provider>
        </CanvasFocusNodesContext.Provider>
        </CanvasOverlayRootContext.Provider>
        </CanvasPreviewZoomContext.Provider>
        </MentionContext.Provider>
      </ActionContext.Provider>
    </RendererContext.Provider>
  );
}
