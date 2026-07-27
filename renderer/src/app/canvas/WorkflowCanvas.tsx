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
  Background,
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
  ReactFlow,
  type ReactFlowInstance,
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
  ) => Promise<Array<{ nodeId: string; name: string; url: string }>>;
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
export type WorkflowNodeRenderer = ComponentType<
  { node: WorkflowNodeData; selected: boolean; actions: WorkflowNodeActions }
>;
export interface WorkflowCanvasController {
  moveNodes: (
    positions: Array<{ id: string; x: number; y: number }>,
    options?: { recordHistory?: boolean },
  ) => void;
  selectNodes: (ids: string[]) => void;
  selectEdge: (id: string | null) => void;
  connect: (connection: Connection) => boolean | void | Promise<boolean | void>;
  saveViewport: (viewport: Viewport) => void;
  createNodeAt: (
    type: string,
    position: { x: number; y: number },
  ) => void | Promise<void>;
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
type FlowNode = Node<{ node: WorkflowNodeData }>;
function nodeDimensions(node: WorkflowNodeData) {
  return canvasNodeDimensions(node);
}
function toFlowNodes(nodes: WorkflowNodeData[]): FlowNode[] {
  return nodes.filter((node) => !node.archived).map((node) => {
    const dimensions = nodeDimensions(node);
    return {
      id: node.id,
      type: "panel",
      position: {
        x: Math.round(Number(node.x) || 0),
        y: Math.round(Number(node.y) || 0),
      },
      data: { node },
      selected: Boolean(node.selected),
      style: dimensions,
    };
  });
}
const FallbackNode = memo((
  { node, selected }: { node: WorkflowNodeData; selected: boolean },
) => (
  <article className={`react-workflow-node${selected ? " selected" : ""}`}>
    <header>
      <span>{node.type}</span>
      <i className={`status-${node.status || "idle"}`} />
    </header>
    <strong>{node.title || "未命名节点"}</strong>
  </article>
));
function CanvasNode(
  { data, selected }: NodeProps<Node<{ node: WorkflowNodeData }>>,
) {
  const registry = useContext(RendererContext);
  const actions = useContext(ActionContext)!;
  const item = data.node;
  const Renderer = registry[item.type] || FallbackNode;
  const resizable = item.type === "textGeneration" || item.type === "note" ||
    item.type === "threeDDirector";
  const minimum = item.type === "threeDDirector"
    ? { width: 540, height: 330 }
    : item.type === "note"
    ? { width: 180, height: 110 }
    : { width: 260, height: 180 };
  return (
    <>
      <NodeResizer
        color="#171717"
        handleClassName="canvas-node-resize-handle nodrag"
        isVisible={selected && resizable}
        lineClassName="canvas-node-resize-line"
        minHeight={minimum.height}
        minWidth={minimum.width}
        onResizeEnd={(_event, size) => actions.update(item.id, {
          x: Math.round(size.x),
          y: Math.round(size.y),
          canvasWidth: Math.round(size.width),
          canvasHeight: Math.round(size.height),
          updatedAt: new Date().toISOString(),
        })}
      />
      <Renderer node={item} selected={selected} actions={actions} />
    </>
  );
}
const nodeTypes = { panel: CanvasNode };
const roleLabel = (
  role?: string,
) => ({
  textContext: "文本上下文",
  referenceImage: "参考图",
  inputVideo: "输入视频",
}[role || ""] || "");

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
  const maxX = Math.max(
    CANVAS_MENU_MARGIN,
    bounds.width - CANVAS_MENU_WIDTH - CANVAS_MENU_MARGIN,
  );
  const maxY = Math.max(
    CANVAS_MENU_MARGIN,
    bounds.height - CANVAS_MENU_HEIGHT - CANVAS_MENU_MARGIN,
  );
  return {
    x: Math.min(
      maxX,
      Math.max(
        CANVAS_MENU_MARGIN,
        clientX - bounds.left + CANVAS_MENU_POINTER_OFFSET,
      ),
    ),
    y: Math.min(
      maxY,
      Math.max(
        CANVAS_MENU_MARGIN,
        clientY - bounds.top + CANVAS_MENU_POINTER_OFFSET,
      ),
    ),
  };
}
type CanvasMenuLayerHandle = {
  open: (menu: CanvasMenuState) => void;
  close: () => void;
};
const CanvasMenuLayer = memo(forwardRef<
  CanvasMenuLayerHandle,
  { controller: WorkflowCanvasController }
>(function CanvasMenuLayer({ controller }, ref) {
  const [menu, setMenu] = useState<CanvasMenuState | null>(null);
  useImperativeHandle(ref, () => ({
    open(next) {
      flushSync(() => setMenu(next));
    },
    close() {
      setMenu(null);
    },
  }), []);
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
}));

export function WorkflowCanvas({
  nodes,
  edges,
  viewport,
  renderers = {},
  nodeActions,
  controller,
  overlay,
}: {
  nodes: WorkflowNodeData[];
  edges: WorkflowEdge[];
  viewport: Viewport;
  renderers?: Record<string, WorkflowNodeRenderer>;
  nodeActions: WorkflowNodeActions;
  controller: WorkflowCanvasController;
  overlay?: ReactNode;
}) {
  const [flowNodes, setFlowNodes] = useState<FlowNode[]>(() =>
    toFlowNodes(nodes)
  );
  const [instance, setInstance] = useState<
    ReactFlowInstance<FlowNode, Edge<WorkflowEdgeData>> | null
  >(null);
  const [edgesVisible, setEdgesVisible] = useState(true);
  const [minimapVisible, setMinimapVisible] = useState(false);
  const [liveViewport, setLiveViewport] = useState(viewport);
  const draggingIds = useRef(new Set<string>());
  const canvasRoot = useRef<HTMLElement>(null);
  const menuLayer = useRef<CanvasMenuLayerHandle>(null);
  const visible = useMemo(() => nodes.filter((node) => !node.archived), [
    nodes,
  ]);
  const canonicalNodes = useMemo(() => toFlowNodes(visible), [visible]);
  useEffect(() => {
    setFlowNodes((current) => {
      const previous = new Map(current.map((node) => [node.id, node]));
      return canonicalNodes.map((node) => {
        const existing = previous.get(node.id);
        if (!existing) return node;
        return {
          ...node,
          position: draggingIds.current.has(node.id)
            ? existing.position
            : node.position,
          selected: typeof node.data.node.selected === "boolean"
            ? node.selected
            : existing.selected,
        };
      });
    });
  }, [canonicalNodes]);
  const renderedNodes = flowNodes;
  const ids = useMemo(() => new Set(visible.map((node) => node.id)), [visible]);
  const visibleById = useMemo(
    () => new Map(visible.map((node) => [node.id, node])),
    [visible],
  );
  const flowEdges = useMemo<Array<Edge<WorkflowEdgeData>>>(
    () =>
      edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)).map((
        edge,
      ) => {
        const source = visibleById.get(edge.source);
        const target = visibleById.get(edge.target);
        const sourceCenter = Number(source?.x || 0) +
          nodeDimensions(source!).width / 2;
        const targetCenter = Number(target?.x || 0) +
          nodeDimensions(target!).width / 2;
        const targetIsRight = targetCenter >= sourceCenter;
        return {
          ...edge,
          sourceHandle: targetIsRight ? "source-right" : "source-left",
          targetHandle: targetIsRight ? "target-left" : "target-right",
          type: "default",
          label: roleLabel(edge.data?.inputRole),
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { stroke: "#9aa39d", strokeWidth: 1.6 },
          labelStyle: { fill: "#526158", fontSize: 9, fontWeight: 700 },
          labelBgStyle: { fill: "#f7f8f6", fillOpacity: .94 },
        };
      }),
    [edges, ids, visibleById],
  );

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    setFlowNodes((current) =>
      applyNodeChanges(changes, current.length ? current : canonicalNodes)
    );
    const moved = changes.flatMap((change) =>
      change.type === "position" && change.position &&
          typeof change.dragging === "boolean"
        ? [{
          id: change.id,
          x: Math.round(change.position.x),
          y: Math.round(change.position.y),
        }]
        : []
    );
    if (moved.length) {
      const recordHistory = moved.some((item) =>
        !draggingIds.current.has(item.id)
      );
      changes.forEach((change) => {
        if (change.type === "position" && change.dragging) {
          draggingIds.current.add(change.id);
        }
      });
      // Keep the project and React Flow on the same coordinates throughout the
      // drag. One gesture still creates only one undo history entry.
      controller.moveNodes(moved, { recordHistory });
      changes.forEach((change) => {
        if (change.type === "position" && change.dragging === false) {
          draggingIds.current.delete(change.id);
        }
      });
    }
    const selection = changes.filter((change) => change.type === "select");
    if (selection.length) {
      const selected = new Set(
        applyNodeChanges(changes, renderedNodes).filter((node) => node.selected)
          .map((node) => node.id),
      );
      controller.selectNodes([...selected]);
    }
  }, [canonicalNodes, controller, renderedNodes]);
  const onMoveEnd: OnMoveEnd = useCallback(
    (_event, next) => {
      setLiveViewport(next);
      controller.saveViewport({
        x: Math.round(next.x),
        y: Math.round(next.y),
        zoom: Math.abs(next.zoom - 1) < .015 ? 1 : next.zoom,
      });
    },
    [controller],
  );
  const changeZoom = useCallback((delta: number) => {
    const current = instance?.getViewport() || liveViewport;
    const zoom = Math.min(3, Math.max(.1, Math.round((current.zoom + delta) * 10) / 10));
    void instance?.zoomTo(zoom, { duration: 140 });
  }, [instance, liveViewport]);
  useEffect(() => {
    controller.registerFitView?.(
      instance
        ? () => void instance.fitView({ padding: .16, duration: 240 })
        : null,
    );
    return () => controller.registerFitView?.(null);
  }, [controller, instance]);
  function openMenu(event: globalThis.MouseEvent | ReactMouseEvent<Element>) {
    event.preventDefault();
    const bounds = canvasRoot.current?.getBoundingClientRect();
    if (!bounds) return;
    const menuPosition = canvasMenuPosition(event.clientX, event.clientY, bounds);
    const point =
      instance?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) ||
      { x: 120, y: 90 };
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
        <section
          ref={canvasRoot}
          className="react-workflow-canvas"
          tabIndex={0}
          onPointerDownCapture={(event) => {
            const target = event.target as Element;
            if (
              !target.closest(
                "input,textarea,select,button,iframe,[contenteditable=true]",
              )
            ) {
              event.currentTarget.focus({ preventScroll: true });
            }
          }}
          onKeyDown={(event) => {
            const editable = (event.target as Element).matches(
              "input,textarea,select,[contenteditable=true]",
            );
            const command = event.metaKey || event.ctrlKey;
            const key = event.key.toLowerCase();
            if (
              (event.key === "Backspace" || event.key === "Delete") && !editable
            ) {
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
                renderedNodes.filter((node) =>
                  !selectedType || node.data.node.type === selectedType
                ).map((node) => node.id),
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
              ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
                event.key,
              )
            ) {
              event.preventDefault();
              const step = event.shiftKey ? 10 : 1;
              const dx = event.key === "ArrowLeft"
                ? -step
                : event.key === "ArrowRight"
                ? step
                : 0;
              const dy = event.key === "ArrowUp"
                ? -step
                : event.key === "ArrowDown"
                ? step
                : 0;
              const moved = renderedNodes.filter((node) => node.selected).map((
                node,
              ) => ({
                id: node.id,
                x: node.position.x + dx,
                y: node.position.y + dy,
              }));
              if (moved.length) {
                setFlowNodes((current) =>
                  current.map((node) => {
                    const next = moved.find((item) => item.id === node.id);
                    return next
                      ? { ...node, position: { x: next.x, y: next.y } }
                      : node;
                  })
                );
                controller.moveNodes(moved);
              }
            }
          }}
          onDoubleClick={(event) => {
            if (
              (event.target as Element).classList.contains("react-flow__pane")
            ) openMenu(event);
          }}
        >
          <ReactFlow
            nodes={renderedNodes}
            edges={edgesVisible ? flowEdges : []}
            nodeTypes={nodeTypes}
            defaultViewport={viewport}
            minZoom={.1}
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
            onMoveEnd={onMoveEnd}
            onMove={(_event, next) => setLiveViewport(next)}
            onPaneContextMenu={openMenu}
            fitViewOptions={{ padding: .16, duration: 240 }}
          >
            <Background color="#d9ddd9" gap={18} />
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
          <div className="canvas-corner-controls" onPointerDown={(event) => event.stopPropagation()}>
            <div className="canvas-zoom-group">
              <button type="button" title="缩小画布" onClick={() => changeZoom(-.1)}>−</button>
              <button
                className="canvas-zoom-value"
                type="button"
                title="自适应视窗"
                onClick={() => void instance?.fitView({ padding: .16, duration: 240 })}
              >{Math.round(liveViewport.zoom * 100)}%</button>
              <button type="button" title="放大画布" onClick={() => changeZoom(.1)}>＋</button>
              <span aria-hidden="true" />
              <button
                type="button"
                title="自适应视窗"
                onClick={() => void instance?.fitView({ padding: .16, duration: 240 })}
              ><IconSymbol name="maximize" /></button>
            </div>
            <button
              className={`canvas-corner-map${minimapVisible ? " active" : ""}`}
              type="button"
              title="显示或隐藏小地图"
              onClick={() => setMinimapVisible((visible) => !visible)}
            ><IconSymbol name="grid" /></button>
          </div>
          {overlay}
        </section>
      </ActionContext.Provider>
    </RendererContext.Provider>
  );
}
