import {
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
  MarkerType,
  MiniMap,
  type Node,
  type NodeChange,
  NodeResizer,
  type NodeProps,
  type OnMoveEnd,
  type OnMoveStart,
  ReactFlow,
  type ReactFlowInstance,
  useStoreApi,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { canvasNodeDimensions } from "../../services/agentLayoutService";
import { IconSymbol } from "../components/IconSymbol";
import { CanvasContextMenu } from "./CanvasContextMenu";

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
  required?: boolean;
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
  run: (id: string) => void;
  useResource: (id: string) => void;
  replaceResource: (id: string) => void;
  archiveResource: (id: string) => void;
  selectOutput: (nodeId: string, outputId: string) => void;
  openVideoEditor: (id: string) => void;
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
const VIEWPORT_LAYER_NODE_LIMIT = 24;
const NODE_VIRTUALIZATION_THRESHOLD = 50;
const MEDIA_NODE_TYPES = new Set([
  "imageGeneration",
  "videoGeneration",
  "audioGeneration",
  "board",
  "threeDDirector",
]);
type FlowNode = Node<{ node: WorkflowNodeData; inputRevision: string }>;
function nodeDimensions(node: WorkflowNodeData) {
  return canvasNodeDimensions(node);
}
function toFlowNodes(nodes: WorkflowNodeData[], edges: WorkflowEdge[] = []): FlowNode[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incomingByTarget = new Map<string, WorkflowEdge[]>();
  edges.forEach((edge) => {
    const incoming = incomingByTarget.get(edge.target) || [];
    incoming.push(edge);
    incomingByTarget.set(edge.target, incoming);
  });
  return nodes
    .filter((node) => !node.archived)
    .map((node) => {
      const dimensions = nodeDimensions(node);
      const inputRevision = (incomingByTarget.get(node.id) || [])
        .map((edge) => {
          const source = nodeById.get(edge.source);
          return [
            edge.id,
            edge.source,
            source?.updatedAt || "",
            source?.selectedOutputNodeId || "",
          ].join(":");
        })
        .join("|");
      return {
        id: node.id,
        type: "panel",
        className: [
          MEDIA_NODE_TYPES.has(node.type) ? "canvas-media-node" : "",
          node.type === "imageGeneration" ? "canvas-node-image-generation" : "",
        ]
          .filter(Boolean)
          .join(" "),
        position: {
          x: Math.round(Number(node.x) || 0),
          y: Math.round(Number(node.y) || 0),
        },
        data: { node, inputRevision },
        selected: Boolean(node.selected),
        style: dimensions,
      };
    });
}
function FallbackNodeInner({ node, selected }: { node: WorkflowNodeData; selected: boolean }) {
  const mentionInCopilot = useContext(MentionContext);
  return (
    <article className={`react-workflow-node${selected ? " selected" : ""}`}>
      <header>
        {mentionInCopilot && (
          <button
            className="node-mention-btn"
            title={`引用节点：${node.title || node.type}`}
            onClick={(e) => {
              e.stopPropagation();
              mentionInCopilot(node.id);
            }}
          >
            @
          </button>
        )}
        <span>{node.type}</span>
        <i className={`status-${node.status || "idle"}`} />
      </header>
      <strong>{node.title || "未命名节点"}</strong>
    </article>
  );
}
const FallbackNode = memo(FallbackNodeInner);

/**
 * WKWebView repaints a full-size CSS radial gradient while the React Flow
 * viewport is transforming. Keep the grid in its own small, frame-coalesced
 * bitmap so zooming does not invalidate the workbench background or React.
 */
function CanvasGrid() {
  const storeApi = useStoreApi();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.closest<HTMLElement>(".react-flow");
    if (!canvas || !host) return;
    let frame = 0;
    let lastTransform = storeApi.getState().transform;
    let lastWidth = 0;
    let lastHeight = 0;
    let lastDpr = 0;
    const paint = () => {
      frame = 0;
      const context = canvas.getContext("2d");
      if (!context) return;
      const bounds = host.getBoundingClientRect();
      const width = Math.max(1, Math.round(bounds.width));
      const height = Math.max(1, Math.round(bounds.height));
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      if (width !== lastWidth || height !== lastHeight || dpr !== lastDpr) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        lastWidth = width;
        lastHeight = height;
        lastDpr = dpr;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      const [x, y, zoom] = storeApi.getState().transform;
      if (zoom <= 0.42) return;
      const gap = 20 * zoom;
      const startX = ((x % gap) + gap) % gap;
      const startY = ((y % gap) + gap) % gap;
      const radius = Math.max(0.55, Math.min(1, 0.7 * zoom));
      context.fillStyle = "rgba(0, 0, 0, .12)";
      context.beginPath();
      for (let dotX = startX; dotX <= width; dotX += gap) {
        for (let dotY = startY; dotY <= height; dotY += gap) {
          context.moveTo(dotX + radius, dotY);
          context.arc(dotX, dotY, radius, 0, Math.PI * 2);
        }
      }
      context.fill();
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const unsubscribe = storeApi.subscribe(() => {
      const transform = storeApi.getState().transform;
      if (transform === lastTransform) return;
      lastTransform = transform;
      schedule();
    });
    const observer = new ResizeObserver(schedule);
    observer.observe(host);
    schedule();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      unsubscribe();
      observer.disconnect();
    };
  }, [storeApi]);
  return <canvas ref={canvasRef} className="canvas-grid-layer" aria-hidden />;
}

function CanvasNode({ data, selected }: NodeProps<FlowNode>) {
  const registry = useContext(RendererContext);
  const actions = useContext(ActionContext)!;
  const item = data.node;
  const [resizing, setResizing] = useState(false);
  const Renderer = registry[item.type] || FallbackNode;
  const resizable =
    item.type === "textGeneration" || item.type === "note" || item.type === "threeDDirector";
  const minimum =
    item.type === "threeDDirector"
      ? { width: 540, height: 330 }
      : item.type === "note"
        ? { width: 180, height: 110 }
        : { width: 260, height: 180 };
  return (
    <>
      {selected && resizable && (
        <NodeResizer
          color="#171717"
          handleClassName="canvas-node-resize-handle nodrag"
          isVisible
          lineClassName="canvas-node-resize-line"
          keepAspectRatio={item.type === "threeDDirector"}
          minHeight={minimum.height}
          minWidth={minimum.width}
          onResizeStart={() => setResizing(true)}
          onResizeEnd={(_event, size) => {
            setResizing(false);
            actions.update(item.id, {
              x: Math.round(size.x),
              y: Math.round(size.y),
              canvasWidth: Math.round(size.width),
              canvasHeight: Math.round(size.height),
              updatedAt: new Date().toISOString(),
            });
          }}
        />
      )}
      <Renderer
        node={item}
        selected={selected}
        resizing={resizing}
        inputRevision={data.inputRevision}
        actions={actions}
      />
    </>
  );
}
const nodeTypes = { panel: CanvasNode };
const roleLabel = (role?: string) =>
  ({
    textContext: "文本上下文",
    referenceImage: "参考图",
    inputVideo: "输入视频",
  })[role || ""] || "";

type CanvasMenuState = {
  x: number;
  y: number;
  flowX: number;
  flowY: number;
};
const CANVAS_MENU_WIDTH = 168;
const CANVAS_MENU_HEIGHT = 334;
const CANVAS_MENU_MARGIN = 8;
const CANVAS_MENU_POINTER_OFFSET = 4;

function canvasMenuPosition(
  clientX: number,
  clientY: number,
  bounds: Pick<DOMRect, "left" | "top" | "width" | "height">,
) {
  const maxX = Math.max(CANVAS_MENU_MARGIN, bounds.width - CANVAS_MENU_WIDTH - CANVAS_MENU_MARGIN);
  const maxY = Math.max(
    CANVAS_MENU_MARGIN,
    bounds.height - CANVAS_MENU_HEIGHT - CANVAS_MENU_MARGIN,
  );
  return {
    x: Math.min(
      maxX,
      Math.max(CANVAS_MENU_MARGIN, clientX - bounds.left + CANVAS_MENU_POINTER_OFFSET),
    ),
    y: Math.min(
      maxY,
      Math.max(CANVAS_MENU_MARGIN, clientY - bounds.top + CANVAS_MENU_POINTER_OFFSET),
    ),
  };
}
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
  const [flowNodes, setFlowNodes] = useState<FlowNode[]>(() => toFlowNodes(nodes, edges));
  const [instance, setInstance] = useState<ReactFlowInstance<
    FlowNode,
    Edge<WorkflowEdgeData>
  > | null>(null);
  const [edgesVisible, setEdgesVisible] = useState(true);
  const [minimapVisible, setMinimapVisible] = useState(false);
  const [liveViewport, setLiveViewport] = useState(viewport);
  const draggingIds = useRef(new Set<string>());
  const pendingNodeChanges = useRef<NodeChange<FlowNode>[]>([]);
  const nodeChangeFrame = useRef(0);
  const movementEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRoot = useRef<HTMLElement>(null);
  const menuLayer = useRef<CanvasMenuLayerHandle>(null);
  const visible = useMemo(() => nodes.filter((node) => !node.archived), [nodes]);
  const canonicalNodes = useMemo(() => toFlowNodes(visible, edges), [edges, visible]);
  useEffect(() => {
    setFlowNodes((current) => {
      const previous = new Map(current.map((node) => [node.id, node]));
      return canonicalNodes.map((node) => {
        const existing = previous.get(node.id);
        if (!existing) return node;
        return {
          ...node,
          position: draggingIds.current.has(node.id) ? existing.position : node.position,
          selected:
            typeof node.data.node.selected === "boolean" ? node.selected : existing.selected,
        };
      });
    });
  }, [canonicalNodes]);
  const renderedNodes = flowNodes;
  const ids = useMemo(() => new Set(visible.map((node) => node.id)), [visible]);
  const visibleById = useMemo(() => new Map(visible.map((node) => [node.id, node])), [visible]);
  const flowEdges = useMemo<Array<Edge<WorkflowEdgeData>>>(
    () =>
      edges
        .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
        .map((edge) => {
          const source = visibleById.get(edge.source);
          const target = visibleById.get(edge.target);
          const sourceCenter = Number(source?.x || 0) + nodeDimensions(source!).width / 2;
          const targetCenter = Number(target?.x || 0) + nodeDimensions(target!).width / 2;
          const targetIsRight = targetCenter >= sourceCenter;
          return {
            ...edge,
            sourceHandle: targetIsRight ? "port-right" : "port-left",
            targetHandle: targetIsRight ? "port-left" : "port-right",
            type: "default",
            label: roleLabel(edge.data?.inputRole),
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { stroke: "#9aa39d", strokeWidth: 1.6 },
            labelStyle: { fill: "#526158", fontSize: 9, fontWeight: 700 },
            labelBgStyle: { fill: "#f7f8f6", fillOpacity: 0.94 },
          };
        }),
    [edges, ids, visibleById],
  );

  const applyNodeChangesOnFrame = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      pendingNodeChanges.current.push(...changes);
      if (nodeChangeFrame.current) return;
      nodeChangeFrame.current = requestAnimationFrame(() => {
        nodeChangeFrame.current = 0;
        const pending = pendingNodeChanges.current;
        pendingNodeChanges.current = [];
        setFlowNodes((current) =>
          applyNodeChanges(pending, current.length ? current : canonicalNodes),
        );
      });
    },
    [canonicalNodes],
  );
  useEffect(
    () => () => {
      if (nodeChangeFrame.current) cancelAnimationFrame(nodeChangeFrame.current);
    },
    [],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      applyNodeChangesOnFrame(changes);
      changes.forEach((change) => {
        if (change.type === "position" && change.dragging) {
          draggingIds.current.add(change.id);
        }
      });
      const moved = changes.flatMap((change) =>
        change.type === "position" && change.position && change.dragging === false
          ? [
              {
                id: change.id,
                x: Math.round(change.position.x),
                y: Math.round(change.position.y),
              },
            ]
          : [],
      );
      if (moved.length) {
        // React Flow owns the live gesture. Persisting only its final positions
        // avoids rebuilding the whole workbench on every pointer-move frame.
        controller.moveNodes(moved);
        changes.forEach((change) => {
          if (change.type === "position" && change.dragging === false) {
            draggingIds.current.delete(change.id);
          }
        });
      }
      const selection = changes.filter((change) => change.type === "select");
      if (selection.length) {
        const selected = new Set(
          applyNodeChanges(changes, renderedNodes)
            .filter((node) => node.selected)
            .map((node) => node.id),
        );
        controller.selectNodes([...selected]);
      }
    },
    [applyNodeChangesOnFrame, controller, renderedNodes],
  );
  const onMoveEnd: OnMoveEnd = useCallback(
    (_event, next) => {
      if (movementEndTimer.current) clearTimeout(movementEndTimer.current);
      movementEndTimer.current = setTimeout(() => {
        canvasRoot.current?.classList.remove("viewport-moving");
        movementEndTimer.current = null;
      }, 120);
      setLiveViewport(next);
      controller.saveViewport({
        x: Math.round(next.x),
        y: Math.round(next.y),
        zoom: Math.abs(next.zoom - 1) < 0.015 ? 1 : next.zoom,
      });
    },
    [controller],
  );
  const onMoveStart: OnMoveStart = useCallback(() => {
    if (movementEndTimer.current) {
      clearTimeout(movementEndTimer.current);
      movementEndTimer.current = null;
    }
    canvasRoot.current?.classList.add("viewport-moving");
  }, []);
  useEffect(
    () => () => {
      if (movementEndTimer.current) clearTimeout(movementEndTimer.current);
    },
    [],
  );
  const changeZoom = useCallback(
    (delta: number) => {
      const current = instance?.getViewport() || liveViewport;
      const zoom = Math.min(3, Math.max(0.1, Math.round((current.zoom + delta) * 10) / 10));
      void instance?.zoomTo(zoom, { duration: 140 });
    },
    [instance, liveViewport],
  );
  useEffect(() => {
    controller.registerFitView?.(
      instance ? () => void instance.fitView({ padding: 0.16, duration: 240 }) : null,
    );
    return () => controller.registerFitView?.(null);
  }, [controller, instance]);
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

  return (
    <RendererContext.Provider value={renderers}>
      <ActionContext.Provider value={nodeActions}>
        <MentionContext.Provider value={mentionInCopilot || null}>
        <section
          ref={canvasRoot}
          className="react-workflow-canvas"
          data-viewport-layer={visible.length <= VIEWPORT_LAYER_NODE_LIMIT ? "promote" : "standard"}
          tabIndex={0}
          onPointerDownCapture={(event) => {
            const target = event.target as Element;
            if (!target.closest("input,textarea,select,button,iframe,[contenteditable=true]")) {
              event.currentTarget.focus({ preventScroll: true });
            }
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
                  x: node.position.x + dx,
                  y: node.position.y + dy,
                }));
              if (moved.length) {
                setFlowNodes((current) =>
                  current.map((node) => {
                    const next = moved.find((item) => item.id === node.id);
                    return next ? { ...node, position: { x: next.x, y: next.y } } : node;
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
            onlyRenderVisibleElements={renderedNodes.length > NODE_VIRTUALIZATION_THRESHOLD}
            defaultViewport={viewport}
            minZoom={0.1}
            maxZoom={3}
            nodesDraggable
            autoPanOnNodeDrag={false}
            nodesConnectable
            connectOnClick
            connectionMode={ConnectionMode.Loose}
            connectionRadius={64}
            selectionOnDrag
            panOnDrag
            zoomOnScroll
            zoomOnPinch
            multiSelectionKeyCode={["Meta", "Control", "Shift"]}
            deleteKeyCode={null}
            onInit={setInstance}
            onNodesChange={onNodesChange}
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
            fitViewOptions={{ padding: 0.16, duration: 240 }}
          >
            <CanvasGrid />
            {minimapVisible && (
              <MiniMap
                className="canvas-minimap"
                pannable
                zoomable
                nodeColor="#7f8d85"
                maskColor="rgba(250,250,248,.72)"
              />
            )}
          </ReactFlow>
          {!visible.length && (
            <div className="canvas-empty-copy">
              <strong>画布为空</strong>
              <small>双击或右键添加节点，也可以从左侧节点栏开始</small>
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
                onClick={() => void instance?.fitView({ padding: 0.16, duration: 240 })}
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
                onClick={() => void instance?.fitView({ padding: 0.16, duration: 240 })}
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
        </MentionContext.Provider>
      </ActionContext.Provider>
    </RendererContext.Provider>
  );
}
