import {
  type CSSProperties,
  type ComponentType,
  createContext,
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
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { canvasNodeDimensions, defaultCanvasNodeDimensions } from "../../services/agentLayoutService";
import { IconSymbol } from "../components/IconSymbol";
import type { ImageCropRect } from "../components/ImageCropDialog";
import {
  draggedCanvasPositions,
  reconcileCanvasNodes,
} from "../../utils/canvasNodeDrag.mjs";
import {
  CANVAS_NODE_LABEL_HEIGHT,
  canvasNodePortBounds,
} from "../../utils/canvasNodeChrome.mjs";
import { CanvasNodeToolbar } from "./CanvasNodeToolbar";
import { CanvasContextMenu } from "./CanvasContextMenu";
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
export interface WorkflowNodeActions {
  update: (id: string, patch: Record<string, unknown>) => void;
  select: (id: string) => void;
  delete: (id: string) => void;
  upload: (id: string) => void | Promise<void>;
  addReference: (id: string, slot?: string) => void | Promise<void>;
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
  replaceResource: (id: string) => void;
  archiveResource: (id: string) => void;
  selectOutput: (nodeId: string, outputId: string) => void;
  openVideoEditor: (id: string) => void;
  addToVideoEditor: (id: string) => void | Promise<void>;
  exportBoard: (id: string, dataUrl: string) => void;
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
  addBoardImage: (id: string) => void;
  applyColoredPencil: (id: string) => void | Promise<void>;
}
export type WorkflowNodeRenderer = ComponentType<{
  node: WorkflowNodeData;
  selected: boolean;
  resizing?: boolean;
  inputRevision?: string;
  incomingInputs?: WorkflowIncomingInput[];
  actions: WorkflowNodeActions;
}>;
export interface WorkflowCanvasController {
  moveNodes: (
    positions: Array<{ id: string; x: number; y: number }>,
    options?: { recordHistory?: boolean },
  ) => void;
  selectNodes: (ids: string[]) => void;
  selectEdge: (id: string | null) => void;
  connect: (connection: Connection) => boolean | void | Promise<boolean | void>;
  saveViewport: (viewport: Viewport) => void;
  createNodeAt: (type: string, position: { x: number; y: number }) => void | Promise<void>;
  deleteSelection: () => void;
  copySelection?: (withUpstream?: boolean) => void | Promise<void>;
  pasteSelection?: () => void | Promise<void>;
  undo?: () => void;
  redo?: () => void;
  runSelection?: (stop?: boolean) => void;
  registerFitView?: (handler: (() => void) | null) => void;
}

const RendererContext = createContext<Record<string, WorkflowNodeRenderer>>({});
const ActionContext = createContext<WorkflowNodeActions | null>(null);
export const MentionContext = createContext<((nodeId: string) => void) | null>(null);
export const CanvasOverlayRootContext = createContext<HTMLElement | null>(null);
export const CanvasNodeLabelRootContext = createContext<HTMLElement | null>(null);
export const CanvasPreviewZoomContext = createContext(1);
const MIN_CANVAS_ZOOM = 0.1;
const MAX_CANVAS_ZOOM = 3;
const MEDIA_PREVIEW_ZOOM_SETTLE_MS = 220;
const MEDIA_NODE_TYPES = new Set([
  "imageGeneration",
  "videoGeneration",
  "audioGeneration",
  "board",
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
      const data = cached && cached.input === node && cached.inputRevision === inputRevision
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
                  candidate.title || candidate.name || candidate.fileName || source.title || "参考素材",
                ),
                resourceType: candidate.resourceType || source.resourceType || "",
                inputRole: edge.data?.inputRole || "auto",
                inputSlot: edge.data?.inputSlot || "",
                skipTaskInput: edge.data?.skipTaskInput === true,
              }];
            }),
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
        className: [
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
        handles: canvasNodePortBounds(screenWidth, screenHeight).map((handle) => ({
          ...handle,
          type: "source" as const,
          position: handle.id === "port-left" ? Position.Left : Position.Right,
        })),
        style: {
          width: screenWidth,
          height: screenHeight,
        },
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
      <strong>{node.title || "未命名节点"}</strong>
    </article>
  );
}
const FallbackNode = memo(FallbackNodeInner);

function CanvasNode({ data, selected, dragging, width }: NodeProps<FlowNode>) {
  const registry = useContext(RendererContext);
  const actions = useContext(ActionContext)!;
  const mentionInCopilot = useContext(MentionContext);
  const item = data.node;
  const [resizing, setResizing] = useState(false);
  const canvasOverlayRoot = useContext(CanvasOverlayRootContext);
  const [labelRoot, setLabelRoot] = useState<HTMLElement | null>(null);
  const Renderer = registry[item.type] || FallbackNode;
  const resizable =
    item.type === "textGeneration" || item.type === "note" || item.type === "threeDDirector";
  const defaultSize = defaultCanvasNodeDimensions(item.type);
  const minimum =
    item.type === "threeDDirector"
      ? defaultSize
      : item.type === "note"
        ? { width: 135, height: 83 }
        : { width: 195, height: 135 };
  const dimensions = nodeDimensions(item);
  const semanticZoom = Math.max(0.01, Number(width || dimensions.width) / dimensions.width);
  return (
    <>
      <CanvasNodeToolbar
        node={item}
        selected={selected}
        dragging={dragging}
        semanticZoom={semanticZoom}
        actions={actions}
        mentionInCopilot={mentionInCopilot}
        canvasOverlayRoot={canvasOverlayRoot}
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
          top: -CANVAS_NODE_LABEL_HEIGHT * semanticZoom,
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
      <div
        className="canvas-node-semantic-content"
        style={{
          width: dimensions.width,
          height: dimensions.height,
          zoom: semanticZoom,
        }}
      >
        <Renderer
          node={item}
          selected={selected}
          resizing={resizing}
          inputRevision={data.inputRevision}
          incomingInputs={data.incomingInputs}
          actions={actions}
        />
      </div>
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

export function WorkflowCanvas({
  nodes,
  edges,
  viewport,
  renderers = {},
  nodeActions,
  controller,
  overlay,
  mentionInCopilot,
}: {
  nodes: WorkflowNodeData[];
  edges: WorkflowEdge[];
  viewport: Viewport;
  renderers?: Record<string, WorkflowNodeRenderer>;
  nodeActions: WorkflowNodeActions;
  controller: WorkflowCanvasController;
  overlay?: ReactNode;
  mentionInCopilot?: (nodeId: string) => void;
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
  const [edgesVisible, setEdgesVisible] = useState(true);
  const [minimapVisible, setMinimapVisible] = useState(false);
  const [liveViewport, setLiveViewport] = useState({ ...viewport, zoom: initialZoom });
  const draggingNodeIds = useRef(new Set<string>());
  const movementEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const renderedSemanticZoom = semanticZoom;
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
            semanticZoom,
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
              color: "#aab1ad",
            },
            style: {
              stroke: "#aab1ad",
              strokeWidth: Math.min(1.35, Math.max(0.5, semanticZoom)),
              opacity: semanticZoom < 0.55 ? 0.48 : 0.72,
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
    [edges, ids, semanticZoom, visibleById],
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
    },
    [],
  );
  const onNodeDragStop: OnNodeDrag<FlowNode> = useCallback(
    (_event, node, draggedNodes) => {
      const stoppedNodes = draggedNodes.length ? draggedNodes : [node];
      stoppedNodes.forEach((item) => draggingNodeIds.current.delete(item.id));
      const moved = draggedCanvasPositions(node, draggedNodes, semanticZoomRef.current);
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
  useEffect(() => {
    controller.registerFitView?.(instance ? fitCanvasView : null);
    return () => controller.registerFitView?.(null);
  }, [controller, fitCanvasView, instance]);
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
  const bindCanvasRoot = useCallback((element: HTMLElement | null) => {
    canvasRoot.current = element;
    setCanvasOverlayRoot(element);
  }, []);

  return (
    <RendererContext.Provider value={renderers}>
      <ActionContext.Provider value={nodeActions}>
        <MentionContext.Provider value={mentionInCopilot || null}>
        <CanvasPreviewZoomContext.Provider value={previewZoom}>
        <CanvasOverlayRootContext.Provider value={canvasOverlayRoot}>
        <section
          ref={bindCanvasRoot}
          className={`react-workflow-canvas${renderedSemanticZoom < 0.8 ? " canvas-zoom-compact" : ""}${renderedSemanticZoom < 0.35 ? " canvas-zoom-distant" : ""}${Math.round(renderedSemanticZoom * 100) <= 20 ? " canvas-zoom-overview" : ""}`}
          tabIndex={0}
          onPointerDownCapture={(event) => {
            const target = event.target as Element;
            if (!target.closest("input,textarea,select,button,iframe,[contenteditable=true]")) {
              event.currentTarget.focus({ preventScroll: true });
            }
          }}
          onWheelCapture={(event) => {
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
              setEdgesVisible((value) => !value);
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
            edges={edgesVisible ? flowEdges : []}
            nodeTypes={nodeTypes}
            proOptions={{ hideAttribution: true }}
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
            onNodeDragStop={onNodeDragStop}
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
            {minimapVisible && (
              <MiniMap
                className="canvas-minimap"
                pannable
                zoomable={false}
                nodeColor="#7f8d85"
                maskColor="rgba(250,250,248,.72)"
              />
            )}
          </ReactFlow>
          {!visible.length && (
            <div className="canvas-empty-copy">
              <span className="canvas-empty-icon" aria-hidden="true">
                <IconSymbol name="cursor" />
              </span>
              <strong><b>双击或右键画布</b>，添加创作节点</strong>
              <small>
                拖动画布移动视角 <i /> 滚轮缩放 <i /> 也可以让右侧 Agent 直接创建
              </small>
            </div>
          )}
          <CanvasMenuLayer ref={menuLayer} controller={controller} />
          <div
            className="canvas-corner-controls"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="canvas-zoom-group">
              <button type="button" title="缩小画布" onClick={() => changeZoom(-0.1)}>
                −
              </button>
              <button
                className="canvas-zoom-value"
                type="button"
                title="自适应视窗"
                onClick={fitCanvasView}
              >
                {Math.round(liveViewport.zoom * 100)}%
              </button>
              <button type="button" title="放大画布" onClick={() => changeZoom(0.1)}>
                ＋
              </button>
              <span aria-hidden="true" />
              <button
                type="button"
                title="自适应视窗"
                onClick={fitCanvasView}
              >
                <IconSymbol name="maximize" />
              </button>
            </div>
            <button
              className={`canvas-corner-map${minimapVisible ? " active" : ""}`}
              type="button"
              title="显示或隐藏小地图"
              onClick={() => setMinimapVisible((visible) => !visible)}
            >
              <IconSymbol name="grid" />
            </button>
          </div>
          {overlay}
        </section>
        </CanvasOverlayRootContext.Provider>
        </CanvasPreviewZoomContext.Provider>
        </MentionContext.Provider>
      </ActionContext.Provider>
    </RendererContext.Provider>
  );
}
