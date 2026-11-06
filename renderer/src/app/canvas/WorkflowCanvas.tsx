import { CanvasDisplaySettings } from "./CanvasDisplaySettings";
import { canvasEdgeVisible, type CanvasAppearance } from "../../utils/canvasAppearance";
import { settingsStore, saveAppSettings } from "../../store/settingsStore";
import { subscribeDomain } from "../../store/domainReactivity";
import type { AgentLayoutMode } from "../../services/agentLayoutService";
import { t } from '@/i18n';
import {
  type CSSProperties,
  type ComponentType,
  createContext,
  type DragEvent as ReactDragEvent,
  forwardRef,
  memo,
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
  MarkerType,
  MiniMap,
  type Node,
  type NodeChange,
  type OnNodeDrag,
  NodeResizer,
  type NodeProps,
  type OnMoveEnd,
  type OnMoveStart,
  ReactFlow,
  type ReactFlowInstance,
  Position,
  useNodesState,
  useNodesInitialized,
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
import { CanvasContextMenu } from "./CanvasContextMenu";
import { CanvasSectionNode } from "./CanvasSectionNode";
import { canvasSectionMembers } from "../../domain/graph/CanvasSections.ts";
import { ARTIFACT_DRAG_TYPE } from "../agent-chat/artifactHelpers";
import {
  canvasMenuPosition,
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
  exportDirectorAsset: (
    id: string,
    dataUrl: string,
    name: string,
    kind: "image" | "video",
  ) => Promise<{ nodeId: string } | null>;
  notify: (message: string) => void;
  applyColoredPencil: (id: string) => void | Promise<void>;
  applyImageRecipe: (id: string, kind: "angle" | "lighting", params: unknown) => boolean;
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
}>;
export interface WorkflowCanvasController {
  createSection?: (position?: { x: number; y: number }) => void;
  moveNodes: (
    positions: Array<{ id: string; x: number; y: number }>,
    options?: { recordHistory?: boolean },
  ) => void;
  selectNodes: (ids: string[]) => void;
  selectEdge: (id: string | null) => void;
  connect: (connection: Connection) => boolean | void | Promise<boolean | void>;
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
export const MentionContext = createContext<((nodeId: string) => void) | null>(null);
export const CanvasOverlayRootContext = createContext<HTMLElement | null>(null);
export const CanvasNodeLabelRootContext = createContext<HTMLElement | null>(null);
export const CanvasPreviewZoomContext = createContext(1);
const CanvasFocusNodesContext = createContext<((nodeIds: string[]) => void) | null>(null);

// Tauri on macOS is backed by WKWebView. Its CSS zoom implementation has
// differed from Chromium in nested layout and form controls, so use the
// standards-based scale property there while keeping CSS zoom for Chromium.
const USE_WEBKIT_NODE_SCALE_FALLBACK =
  typeof navigator !== "undefined" &&
  /AppleWebKit/i.test(navigator.userAgent) &&
  !/(Chrome|Chromium|CriOS|Edg)/i.test(navigator.userAgent);

export function CanvasNodeSemanticContent({
  width,
  height,
  semanticZoom,
  children,
}: {
  width: number;
  height: number;
  semanticZoom: number;
  children: ReactNode;
}) {
  // CSS zoom 已让节点内容按最终屏幕尺寸重新布局，所以节点内样式只写逻辑像素。
  // 再乘一次语义倍率（或给某块内容单独反向缩放）都会让它脱离节点外框所在的坐标系：
  // 高倍率下溢出节点，低倍率下按第二套尺寸折行。
  return (
    <div
      className="canvas-node-semantic-frame"
      style={{
        width: width * semanticZoom,
        height: height * semanticZoom,
      }}
    >
      <div
        className="canvas-node-semantic-content"
        style={{
          width,
          height,
          zoom: USE_WEBKIT_NODE_SCALE_FALLBACK ? 1 : semanticZoom,
          scale: USE_WEBKIT_NODE_SCALE_FALLBACK ? semanticZoom : 1,
          transformOrigin: "top left",
          // 节点内 1px 描边写的是逻辑像素，会被 zoom 一起放大；扣回倍率后任何倍率下都是屏幕 1px。
          "--canvas-node-zoom": String(semanticZoom),
        } as CSSProperties}
      >
        {children}
      </div>
    </div>
  );
}
const MIN_CANVAS_ZOOM = 0.1;
const MAX_CANVAS_ZOOM = 4;
/** 小地图的 svg 尺寸：面板盒由它决定，画布样式不得再用另一套数字裁它。 */
const MINIMAP_SIZE = { width: 168, height: 106 };
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
  semanticZoom: number;
}>;
type FlowNodeCacheEntry = {
  input: WorkflowNodeData;
  selected: boolean;
  semanticZoom: number;
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
  semanticZoom = 1,
  cache?: Map<string, FlowNodeCacheEntry>,
): FlowNode[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incomingByTarget = new Map<string, WorkflowEdge[]>();
  edges.forEach((edge) => {
    const incoming = incomingByTarget.get(edge.target) || [];
    incoming.push(edge);
    incomingByTarget.set(edge.target, incoming);
  });
  const result = nodes
    .filter((node) => !node.archived)
    .map((node) => {
      const dimensions = nodeDimensions(node);
      const screenWidth = dimensions.width * semanticZoom;
      const screenHeight = dimensions.height * semanticZoom;
      const inputRevision = (incomingByTarget.get(node.id) || [])
        .map((edge) => {
          const source = nodeById.get(edge.source);
          return [
            edge.id,
            edge.source,
            edge.data?.inputRole || "",
            edge.data?.inputSlot || "",
            edge.data?.skipTaskInput === true ? "inactive" : "active",
            source?.updatedAt || "",
            source?.selectedOutputNodeId || "",
          ].join(":");
        })
        .join("|");
      const selected = Boolean(node.selected);
      const cached = cache?.get(node.id);
      const data = cached &&
          cached.input === node &&
          cached.semanticZoom === semanticZoom &&
          cached.inputRevision === inputRevision
        ? cached.output.data
        : {
            node,
            inputRevision,
            incomingInputs: (incomingByTarget.get(node.id) || []).flatMap((edge) => {
              const source = nodeById.get(edge.source);
              if (!source) return [];
              const outputs = Array.isArray(source.generatedOutputs) ? source.generatedOutputs : [];
              const selectedOutput = outputs.find(
                (item) => item && typeof item === "object" && item.selected,
              ) || outputs[0];
              const uploaded = source.uploadedFile && typeof source.uploadedFile === "object"
                ? source.uploadedFile
                : null;
              const candidate = selectedOutput && typeof selectedOutput === "object"
                ? selectedOutput
                : uploaded || source;
              return [{
                ...candidate,
                edgeId: edge.id,
                nodeId: source.id,
                name: String(
                  candidate.title || candidate.name || candidate.fileName || source.title || t("ui.WorkflowCanvas.text.a4c9a837"),
                ),
                resourceType: candidate.resourceType || source.resourceType || "",
                inputRole: edge.data?.inputRole || "auto",
                inputSlot: edge.data?.inputSlot || "",
                skipTaskInput: edge.data?.skipTaskInput === true,
              }];
            }),
            semanticZoom,
          };
      if (
        cached &&
        cached.input === node &&
        cached.selected === selected &&
        cached.semanticZoom === semanticZoom &&
        cached.inputRevision === inputRevision
      ) {
        return cached.output;
      }
      const output: FlowNode = {
        id: node.id,
        type: "panel",
        zIndex: node.type === 'canvasSection' ? -1 : 0,
        ...(node.type === 'canvasSection' ? { dragHandle: '.canvas-section-heading' } : {}),
        connectable: node.type !== 'canvasSection',
        className: [
          node.type === 'canvasSection' ? 'canvas-section-node' : '',
          MEDIA_NODE_TYPES.has(node.type) ? "canvas-media-node" : "",
          node.type === "imageGeneration" ? "canvas-node-image-generation" : "",
        ]
          .filter(Boolean)
          .join(" "),
        position: {
          x: screenPixel((Number(node.x) || 0) * semanticZoom),
          y: screenPixel((Number(node.y) || 0) * semanticZoom),
        },
        data,
        selected,
        // React Flow otherwise keeps the previous DOM measurement for handle
        // bounds while semantic zoom is changing. Supplying the screen-space
        // bounds makes the edge and node geometry enter the store together.
        handles: canvasNodePortBounds(screenWidth, screenHeight).filter(() => node.type !== 'canvasSection').map((handle) => ({
          ...handle,
          type: "source" as const,
          position: handle.id === "port-left" ? Position.Left : Position.Right,
        })),
        style: {
          width: screenWidth,
          height: screenHeight,
        },
        // 每次外部同步都会用新的规范快照替换界面节点，React Flow 的 measured 随之丢失；
        // 小地图只认节点对象上的尺寸，所以显式带上与 style 同一套屏幕空间值。
        width: screenWidth,
        height: screenHeight,
        // The resizer reads measured directly, including after an external sync.
        ...(node.type === 'canvasSection' ? { measured: { width: screenWidth, height: screenHeight } } : {}),
      };
      cache?.set(node.id, { input: node, selected, semanticZoom, inputRevision, output });
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

function CanvasNode({ data, selected, dragging }: NodeProps<FlowNode>) {
  const registry = useContext(RendererContext);
  const actions = useContext(ActionContext)!;
  const addNodeMention = useContext(MentionContext);
  const item = data.node;
  const [resizing, setResizing] = useState(false);
  const [imageCropMode, setImageCropMode] = useState<"crop" | "grid" | null>(null);
  const [imageAnnotationOpen, setImageAnnotationOpen] = useState(false);
  const [imageWatermarkOpen, setImageWatermarkOpen] = useState(false);
  const [imageAngleOpen, setImageAngleOpen] = useState(false);
  const [imageLightingOpen, setImageLightingOpen] = useState(false);
  useEffect(() => {
    if (selected) return;
    setImageCropMode(null);
    setImageAnnotationOpen(false);
    setImageWatermarkOpen(false);
    setImageAngleOpen(false);
    setImageLightingOpen(false);
  }, [selected]);
  const canvasOverlayRoot = useContext(CanvasOverlayRootContext);
  const focusCanvasNodes = useContext(CanvasFocusNodesContext);
  const [labelRoot, setLabelRoot] = useState<HTMLElement | null>(null);
  const Renderer = registry[item.type] || FallbackNode;
  const resizable =
    item.type === "textGeneration" ||
    item.type === "threeDDirector" || item.type === "clipStudio";
  const defaultSize = defaultCanvasNodeDimensions(item.type);
  const minimum =
    item.type === "threeDDirector" || item.type === "clipStudio"
      ? { ...defaultSize, width: item.type === "clipStudio" ? 720 : defaultSize.width }
      : { width: 195, height: 135 };
  const dimensions = nodeDimensions(item);
  const semanticZoom = data.semanticZoom;
  if (item.type === 'canvasSection') return <CanvasSectionNode node={item} selected={Boolean(selected)} zoom={semanticZoom} actions={actions} />;
  return (
    <>
      <CanvasNodeToolbar
        node={item}
        selected={selected}
        dragging={dragging}
        semanticZoom={semanticZoom}
        actions={actions}
        addNodeMention={addNodeMention}
        canvasOverlayRoot={canvasOverlayRoot}
        imageCropMode={imageCropMode}
        onImageCropOpen={(mode) => {
          focusCanvasNodes?.([item.id]);
          // 裁剪和标注都要占满整张媒体卡片，二者不能同时打开。
          setImageAnnotationOpen(false);
          setImageWatermarkOpen(false);
          setImageCropMode(mode);
        }}
        imageAnnotationOpen={imageAnnotationOpen}
        onImageAnnotationOpen={() => {
          focusCanvasNodes?.([item.id]);
          setImageCropMode(null);
          setImageWatermarkOpen(false);
          setImageAnnotationOpen(true);
        }}
        imageWatermarkOpen={imageWatermarkOpen}
        onImageWatermarkOpen={() => {
          focusCanvasNodes?.([item.id]);
          setImageCropMode(null);
          setImageAnnotationOpen(false);
          setImageAngleOpen(false);
          setImageLightingOpen(false);
          setImageWatermarkOpen(true);
        }}
        imageAngleOpen={imageAngleOpen}
        onImageAngleOpen={() => {
          focusCanvasNodes?.([item.id]);
          setImageCropMode(null);
          setImageAnnotationOpen(false);
          setImageWatermarkOpen(false);
          setImageLightingOpen(false);
          setImageAngleOpen((current) => !current);
        }}
        imageLightingOpen={imageLightingOpen}
        onImageLightingOpen={() => {
          focusCanvasNodes?.([item.id]);
          setImageCropMode(null);
          setImageAnnotationOpen(false);
          setImageWatermarkOpen(false);
          setImageAngleOpen(false);
          setImageLightingOpen((current) => !current);
        }}
      />
      {selected && resizable && (
        <NodeResizer
          color="#171717"
          handleClassName="canvas-node-resize-handle nodrag"
          isVisible
          lineClassName="canvas-node-resize-line"
          keepAspectRatio={item.type === "threeDDirector"}
          minHeight={minimum.height * semanticZoom}
          minWidth={minimum.width * semanticZoom}
          maxHeight={item.type === "clipStudio" ? dimensions.height * semanticZoom : Number.MAX_VALUE}
          onResizeStart={() => setResizing(true)}
          onResizeEnd={(_event, size) => {
            setResizing(false);
            actions.update(item.id, {
              x: Math.round(size.x / semanticZoom),
              y: Math.round(size.y / semanticZoom),
              canvasWidth: Math.round(size.width / semanticZoom),
              canvasHeight: Math.round(size.height / semanticZoom),
              updatedAt: new Date().toISOString(),
            });
          }}
        />
      )}
      <div
        ref={setLabelRoot}
        className="canvas-node-label-anchor"
        style={{
          top: -CANVAS_NODE_LABEL_OFFSET * semanticZoom,
          width: dimensions.width * semanticZoom,
          height: CANVAS_NODE_LABEL_HEIGHT * semanticZoom,
          "--node-label-zoom": semanticZoom,
        } as CSSProperties}
      />
      <Handle
        id="port-left"
        className="canvas-flow-port canvas-flow-port-in"
        type="source"
        position={Position.Left}
      />
      <Handle
        id="port-right"
        className="canvas-flow-port canvas-flow-port-out"
        type="source"
        position={Position.Right}
      />
      <CanvasNodeLabelRootContext.Provider value={labelRoot}>
      <CanvasNodeSemanticContent width={dimensions.width} height={dimensions.height} semanticZoom={semanticZoom}>
        <Renderer
          node={item}
          selected={selected}
          resizing={resizing}
          inputRevision={data.inputRevision}
          incomingInputs={data.incomingInputs}
          actions={actions}
          semanticZoom={semanticZoom}
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
        />
      </CanvasNodeSemanticContent>
      </CanvasNodeLabelRootContext.Provider>
    </>
  );
}
const nodeTypes = { panel: CanvasNode };
type CanvasMenuState = {
  x: number;
  y: number;
  flowX: number;
  flowY: number;
};
type CanvasMenuLayerHandle = {
  open: (menu: CanvasMenuState) => void;
  close: () => void;
};
const CanvasMenuLayer = memo(
  forwardRef<CanvasMenuLayerHandle, { controller: WorkflowCanvasController }>(
    function CanvasMenuLayer({ controller }, ref) {
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
          onCreate={async (type) => {
            await controller.createNodeAt(type, {
              x: menu.flowX,
              y: menu.flowY,
            });
            setMenu(null);
          }}
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

export function WorkflowCanvas({
  nodes,
  edges,
  viewport,
  renderers = {},
  nodeActions,
  controller,
  overlay,
  addNodeMention,
  onReady,
  onAutoLayout,
}: {
  nodes: WorkflowNodeData[];
  edges: WorkflowEdge[];
  viewport: Viewport;
  renderers?: Record<string, WorkflowNodeRenderer>;
  nodeActions: WorkflowNodeActions;
  controller: WorkflowCanvasController;
  overlay?: ReactNode;
  addNodeMention?: (nodeId: string) => void;
  onReady?: () => void;
  onAutoLayout?: (options?: { mode?: AgentLayoutMode; includeConnected?: boolean }) => boolean;
}) {
  const initialZoom = Math.min(
    MAX_CANVAS_ZOOM,
    Math.max(MIN_CANVAS_ZOOM, Number(viewport.zoom) || 1),
  );
  const [semanticZoom, setSemanticZoom] = useState(initialZoom);
  const [previewZoom, setPreviewZoom] = useState(initialZoom);
  const semanticZoomRef = useRef(initialZoom);
  const flowNodeCache = useRef(new Map<string, FlowNodeCacheEntry>());
  const flowEdgeCache = useRef(new Map<string, FlowEdgeCacheEntry>());
  const [flowNodes, setFlowNodes, applyFlowNodeChanges] = useNodesState<FlowNode>(
    toFlowNodes(nodes, edges, initialZoom, flowNodeCache.current),
  );
  const [instance, setInstance] = useState<ReactFlowInstance<
    FlowNode,
    Edge<WorkflowEdgeData>
  > | null>(null);
  const appearance = useSyncExternalStore(subscribeDomain, () => settingsStore.canvasAppearance);
  const updateAppearance = async (patch: Partial<CanvasAppearance>) => {
    try { await saveAppSettings({ canvasAppearance: { ...settingsStore.canvasAppearance, ...patch } }); }
    catch (cause) { nodeActions.notify(cause instanceof Error ? cause.message : String(cause)); }
  };
  const [minimapVisible, setMinimapVisible] = useState(false);
  const [liveViewport, setLiveViewport] = useState({ ...viewport, zoom: initialZoom });
  const draggingNodeIds = useRef(new Set<string>());
  const sectionDrag = useRef<{ origin: { x: number; y: number }; members: Map<string, { x: number; y: number }> } | null>(null);
  const movementEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewportAnimationFrame = useRef<number | null>(null);
  const canvasRoot = useRef<HTMLElement>(null);
  const [canvasOverlayRoot, setCanvasOverlayRoot] = useState<HTMLElement | null>(null);
  const menuLayer = useRef<CanvasMenuLayerHandle>(null);
  const visible = useMemo(() => nodes.filter((node) => !node.archived), [nodes]);
  const canonicalNodes = useMemo(
    () => toFlowNodes(visible, edges, semanticZoom, flowNodeCache.current),
    [edges, semanticZoom, visible],
  );
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPreviewZoom(semanticZoom);
    }, MEDIA_PREVIEW_ZOOM_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [semanticZoom]);
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
          const sourceHandle = targetIsRight ? "port-right" : "port-left";
          const targetHandle = targetIsRight ? "port-left" : "port-right";
          const signature = JSON.stringify([
            edge,
            sourceHandle,
            targetHandle,
          ]);
          const cached = flowEdgeCache.current.get(edge.id);
          if (cached?.signature === signature) return cached.output;
          const output: Edge<WorkflowEdgeData> = {
            ...edge,
            sourceHandle,
            targetHandle,
            type: "default",
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 10,
              height: 10,
            },
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
    [edges, ids, visibleById],
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
      traceCanvasEvent("nodes-change", {
        changes: changes.map((change) => ({
          id: "id" in change ? change.id : change.item.id,
          type: change.type,
          dragging: change.type === "position" ? change.dragging : undefined,
          position: change.type === "position" ? change.position : undefined,
        })),
        nodeIds: renderedNodes.map((node) => node.id),
        edgeIds: flowEdges.map((edge) => edge.id),
      });
      if (interactiveChanges.length) applyFlowNodeChanges(interactiveChanges);
      const selection = interactiveChanges.filter((change) => change.type === "select");
      if (selection.length) {
        const selected = new Set(
          applyNodeChanges(interactiveChanges, renderedNodes)
            .filter((node) => node.selected)
            .map((node) => node.id),
        );
        controller.selectNodes([...selected]);
      }
    },
    [applyFlowNodeChanges, controller, flowEdges, renderedNodes],
  );
  const onNodeDragStart: OnNodeDrag<FlowNode> = useCallback(
    (_event, node, draggedNodes) => {
      const activeNodes = draggedNodes.length ? draggedNodes : [node];
      activeNodes.forEach((item) => draggingNodeIds.current.add(item.id));
      const activeIds = new Set(activeNodes.map(item => item.id));
      const members = new Map<string, { x: number; y: number }>();
      for (const section of activeNodes.filter(item => item.data.node.type === 'canvasSection')) {
        for (const member of canvasSectionMembers(section.data.node, visible)) {
          if (activeIds.has(member.id)) continue;
          const flow = renderedNodes.find(item => item.id === member.id);
          if (flow) members.set(member.id, { ...flow.position });
        }
      }
      members.forEach((_position, id) => draggingNodeIds.current.add(id));
      sectionDrag.current = { origin: { ...node.position }, members };
    },
    [renderedNodes, visible],
  );
  const onNodeDrag: OnNodeDrag<FlowNode> = useCallback((_event, node) => {
    const drag = sectionDrag.current;
    if (!drag?.members.size) return;
    const dx = node.position.x - drag.origin.x;
    const dy = node.position.y - drag.origin.y;
    setFlowNodes(current => current.map(item => {
      const origin = drag.members.get(item.id);
      return origin ? { ...item, position: { x: origin.x + dx, y: origin.y + dy } } : item;
    }));
  }, [setFlowNodes]);
  const onNodeDragStop: OnNodeDrag<FlowNode> = useCallback(
    (_event, node, draggedNodes) => {
      const stoppedNodes = draggedNodes.length ? draggedNodes : [node];
      stoppedNodes.forEach((item) => draggingNodeIds.current.delete(item.id));
      const moved = draggedCanvasPositions(node, draggedNodes, semanticZoomRef.current);
      const drag = sectionDrag.current;
      if (drag) {
        const dx = node.position.x - drag.origin.x;
        const dy = node.position.y - drag.origin.y;
        for (const [id, origin] of drag.members) {
          moved.push({ id, x: Math.round((origin.x + dx) / semanticZoomRef.current), y: Math.round((origin.y + dy) / semanticZoomRef.current) });
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
          position: {
            x: screenPixel(position.x * semanticZoomRef.current),
            y: screenPixel(position.y * semanticZoomRef.current),
          },
        };
      }));
      traceCanvasEvent("drag-stop", { moved });
      if (moved.length) controller.moveNodes(moved);
    },
    [controller, setFlowNodes],
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
  const onMoveEnd: OnMoveEnd = useCallback(
    (_event, next) => {
      if (movementEndTimer.current) clearTimeout(movementEndTimer.current);
      movementEndTimer.current = setTimeout(() => {
        movementEndTimer.current = null;
      }, 120);
      const publicViewport = { x: next.x, y: next.y, zoom: semanticZoomRef.current };
      setLiveViewport(publicViewport);
      controller.saveViewport({
        x: Math.round(next.x),
        y: Math.round(next.y),
        zoom: semanticZoomRef.current,
      });
    },
    [controller],
  );
  const onMoveStart: OnMoveStart = useCallback(() => {
    if (movementEndTimer.current) {
      clearTimeout(movementEndTimer.current);
      movementEndTimer.current = null;
    }
  }, []);
  useEffect(
    () => () => {
      if (movementEndTimer.current) clearTimeout(movementEndTimer.current);
      if (viewportAnimationFrame.current !== null) cancelAnimationFrame(viewportAnimationFrame.current);
    },
    [],
  );
  const setCanvasZoomAt = useCallback(
    (requestedZoom: number, clientPoint?: { x: number; y: number }) => {
      if (!instance) return;
      const zoom = Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, requestedZoom));
      const currentZoom = semanticZoomRef.current;
      if (Math.abs(zoom - currentZoom) < 0.0005) return;
      const bounds = canvasRoot.current?.getBoundingClientRect();
      if (!bounds) return;
      const current = instance.getViewport();
      const center = clientPoint
        ? { x: clientPoint.x - bounds.left, y: clientPoint.y - bounds.top }
        : { x: bounds.width / 2, y: bounds.height / 2 };
      const ratio = zoom / currentZoom;
      const next = {
        x: screenPixel(center.x - (center.x - current.x) * ratio),
        y: screenPixel(center.y - (center.y - current.y) * ratio),
        zoom: 1,
      };
      semanticZoomRef.current = zoom;
      setSemanticZoom(zoom);
      setLiveViewport({ x: next.x, y: next.y, zoom });
      void instance.setViewport(next);
      controller.saveViewport({ x: Math.round(next.x), y: Math.round(next.y), zoom });
    },
    [controller, instance],
  );
  const changeZoom = useCallback(
    (delta: number) => {
      const zoom = Math.round((semanticZoomRef.current + delta) * 10) / 10;
      setCanvasZoomAt(zoom);
    },
    [setCanvasZoomAt],
  );
  const fitCanvasView = useCallback(() => {
    if (!instance || !canvasRoot.current) return;
    const bounds = canvasRoot.current.getBoundingClientRect();
    if (!visible.length) {
      semanticZoomRef.current = 1;
      setSemanticZoom(1);
      setLiveViewport({ x: 0, y: 0, zoom: 1 });
      void instance.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 240 });
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
        Math.min((bounds.width * 0.68) / contentWidth, (bounds.height * 0.68) / contentHeight),
      ),
    );
    const x = screenPixel(bounds.width / 2 - ((nodeBounds.minX + nodeBounds.maxX) / 2) * zoom);
    const y = screenPixel(bounds.height / 2 - ((nodeBounds.minY + nodeBounds.maxY) / 2) * zoom);
    semanticZoomRef.current = zoom;
    setSemanticZoom(zoom);
    setLiveViewport({ x, y, zoom });
    void instance.setViewport({ x, y, zoom: 1 }, { duration: 240 });
    controller.saveViewport({ x: Math.round(x), y: Math.round(y), zoom });
  }, [controller, instance, visible]);
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
      ? semanticZoomRef.current
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
    if (viewportAnimationFrame.current !== null) cancelAnimationFrame(viewportAnimationFrame.current);
    const fromZoom = semanticZoomRef.current;
    const fromViewport = instance.getViewport();
    const startedAt = performance.now();
    const duration = 360;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const currentZoom = fromZoom + (zoom - fromZoom) * eased;
      const currentX = fromViewport.x + (x - fromViewport.x) * eased;
      const currentY = fromViewport.y + (y - fromViewport.y) * eased;
      semanticZoomRef.current = currentZoom;
      setSemanticZoom(currentZoom);
      setLiveViewport({ x: currentX, y: currentY, zoom: currentZoom });
      void instance.setViewport({ x: currentX, y: currentY, zoom: 1 });
      if (progress < 1) {
        viewportAnimationFrame.current = requestAnimationFrame(animate);
      } else {
        viewportAnimationFrame.current = null;
        controller.saveViewport({ x: Math.round(x), y: Math.round(y), zoom });
      }
    };
    viewportAnimationFrame.current = requestAnimationFrame(animate);
  }, [controller, instance, visible]);
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
  const minimapNodeClick = useRef<(nodeId: string) => void>(() => {});
  minimapNodeClick.current = (nodeId: string) => {
    controller.selectNodes([nodeId]);
    focusCanvasNodes([nodeId], { keepZoom: true });
  };
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
      flowX: point.x / semanticZoomRef.current,
      flowY: point.y / semanticZoomRef.current,
    });
  }
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
      x: point.x / semanticZoomRef.current,
      y: point.y / semanticZoomRef.current,
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
        <CanvasFocusNodesContext.Provider value={focusCanvasNodes}>
        <section
          ref={bindCanvasRoot}
          onDragOver={onArtifactDragOver}
          onDrop={onArtifactDrop}
          data-pattern={appearance.pattern}
          data-color={appearance.color}
          className="react-workflow-canvas"
          // 连线粗细与箭头按同一倍率缩放，样式侧只读这一个变量。
          style={{ "--canvas-semantic-zoom": semanticZoom } as CSSProperties}
          tabIndex={0}
          onPointerDownCapture={(event) => {
            const target = event.target as Element;
            if (!target.closest("input,textarea,select,button,iframe,[contenteditable=true]")) {
              event.currentTarget.focus({ preventScroll: true });
            }
          }}
          onWheelCapture={(event) => {
            // Trackpad pinch gestures arrive as ctrlKey wheel events. They
            // must not change the semantic canvas zoom.
            if (event.ctrlKey) {
              event.preventDefault();
              return;
            }
            const target = event.target as Element;
            if (
              target.closest(
                ".nowheel,input,textarea,select,button,video,audio,[contenteditable=true]",
              )
            ) {
              return;
            }
            event.preventDefault();
            const nextZoom = semanticZoomRef.current * Math.exp(-event.deltaY * 0.002);
            setCanvasZoomAt(nextZoom, { x: event.clientX, y: event.clientY });
          }}
          onKeyDown={(event) => {
            const editable = (event.target as Element).matches(
              "input,textarea,select,[contenteditable=true]",
            );
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
                  x: node.position.x / semanticZoomRef.current + dx,
                  y: node.position.y / semanticZoomRef.current + dy,
                }));
              if (moved.length) {
                setFlowNodes((current) =>
                  current.map((node) => {
                    const next = moved.find((item) => item.id === node.id);
                    return next
                      ? {
                          ...node,
                          position: {
                            x: next.x * semanticZoomRef.current,
                            y: next.y * semanticZoomRef.current,
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
          <ReactFlow
            nodes={renderedNodes}
            edges={displayedEdges}
            nodeTypes={nodeTypes}
            proOptions={{ hideAttribution: true }}
            // 空字符串让箭头不写行内 stroke/fill，颜色由 canvas.css 的 --canvas-edge 统一决定。
            defaultMarkerColor=""
            onlyRenderVisibleElements={false}
            defaultViewport={{ x: viewport.x, y: viewport.y, zoom: 1 }}
            minZoom={1}
            maxZoom={1}
            nodesDraggable
            autoPanOnNodeDrag={false}
            nodesConnectable
            connectOnClick
            connectionMode={ConnectionMode.Loose}
            connectionRadius={64}
            selectionOnDrag
            panOnDrag
            zoomOnScroll={false}
            zoomOnPinch={false}
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
            onMoveStart={onMoveStart}
            onMoveEnd={onMoveEnd}
            onPaneContextMenu={openMenu}
          >
            {instance && onReady && <CanvasReadySignal count={renderedNodes.length} onReady={onReady} />}
            {minimapVisible && (
              <MiniMap
                className="canvas-minimap"
                style={{ width: MINIMAP_SIZE.width, height: MINIMAP_SIZE.height }}
                pannable
                zoomable={false}
                onNodeClick={(_event, node) => minimapNodeClick.current(node.id)}
              />
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
          <CanvasMenuLayer ref={menuLayer} controller={controller} />
          <div
            className="canvas-corner-controls"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="canvas-zoom-group">
              <button type="button" title={t("ui.WorkflowCanvas.title.b7f9e266")} onClick={() => changeZoom(-0.1)}>
                −
              </button>
              <button
                className="canvas-zoom-value"
                type="button"
                title={t("ui.WorkflowCanvas.title.d598a5cd")}
                onClick={fitCanvasView}
              >
                {Math.round(liveViewport.zoom * 100)}%
              </button>
              <button type="button" title={t("ui.WorkflowCanvas.title.55c0d6cc")} onClick={() => changeZoom(0.1)}>
                ＋
              </button>
              <span aria-hidden="true" />
              <button
                type="button"
                title={t("ui.WorkflowCanvas.title.d598a5cd")}
                onClick={fitCanvasView}
              >
                <IconSymbol name="maximize" />
              </button>
            </div>
            <span className="canvas-corner-divider" aria-hidden="true" />
            <CanvasDisplaySettings appearance={appearance} onChange={updateAppearance} onAutoLayout={onAutoLayout} />
            <span className="canvas-corner-divider" aria-hidden="true" />
            <button
              className={`canvas-corner-map${minimapVisible ? " active" : ""}`}
              type="button"
              title={t("ui.WorkflowCanvas.title.088baf55")}
              onClick={() => setMinimapVisible((visible) => !visible)}
            >
              <IconSymbol name="map" />
            </button>
          </div>
          {overlay}
        </section>
        </CanvasFocusNodesContext.Provider>
        </CanvasOverlayRootContext.Provider>
        </CanvasPreviewZoomContext.Provider>
        </MentionContext.Provider>
      </ActionContext.Provider>
    </RendererContext.Provider>
  );
}
