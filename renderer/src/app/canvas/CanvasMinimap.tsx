import { useEffect, useRef, type PointerEvent } from 'react';
import { useReactFlow, useStoreApi, type Node, type Viewport } from '@xyflow/react';
import { t } from '@/i18n';
import type { WorkflowNodeData } from './WorkflowCanvas';

type MapNode = Node<{ node: WorkflowNodeData }>;
const MAP_WIDTH = 240;
const MAP_HEIGHT = 160;
const WORLD_PADDING = 500;
const VIEWPORT_SETTLE_MS = 120;

/** Reference canvas-mini-map: node bounds plus 500 world units, with a live viewport. */
export function CanvasMinimap({ onNodeClick, onViewportChange }: {
  onNodeClick: (id: string) => void;
  onViewportChange: (viewport: Viewport) => void;
}) {
  const flow = useReactFlow<MapNode>();
  const store = useStoreApi<MapNode>();
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const projection = useRef({ x: -500, y: -500, scale: .16, offsetX: 40, offsetY: 0 });
  const repaint = useRef<() => void>(() => {});
  const drag = useRef<{ x: number; y: number; nodeId?: string; viewport?: Viewport } | null>(null);

  useEffect(() => {
    if (!root.current || !canvas.current || !frame.current) return;
    const element = root.current;
    const image = canvas.current;
    const viewportFrame = frame.current;
    let colors: Record<string, string> = {};
    let viewportRadius = 0;
    const readColors = () => {
      const style = getComputedStyle(element);
      viewportRadius = parseFloat(getComputedStyle(viewportFrame).borderTopLeftRadius) || 0;
      colors = Object.fromEntries(['image', 'video', 'audio', 'node', 'frame'].map(key => [key, style.getPropertyValue(`--minimap-${key}`).trim()]));
    };
    let settled: [number, number, number] = [...store.getState().transform];
    let lastTransform = [...settled];
    let wasPaneDragging = store.getState().paneDragging;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const draw = (settleImmediately = false) => {
      const state = store.getState();
      const moved = state.transform.some((value, index) => value !== lastTransform[index]);
      const paneEnded = wasPaneDragging && !state.paneDragging;
      lastTransform = [...state.transform];
      wasPaneDragging = state.paneDragging;
      if (settleImmediately || (paneEnded && !drag.current)) {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = null;
        settled = [...state.transform];
      } else if (moved) {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          settleTimer = null;
          if (!drag.current) draw(true);
        }, VIEWPORT_SETTLE_MS);
      }
      const nodes = state.nodes.filter(node => !node.hidden);
      const size = (node: MapNode) => ({ width: node.measured?.width ?? node.width ?? 1, height: node.measured?.height ?? node.height ?? 1 });
      if (nodes.length) {
        const minX = Math.min(...nodes.map(node => node.position.x)) - WORLD_PADDING;
        const minY = Math.min(...nodes.map(node => node.position.y)) - WORLD_PADDING;
        const maxX = Math.max(...nodes.map(node => node.position.x + size(node).width)) + WORLD_PADDING;
        const maxY = Math.max(...nodes.map(node => node.position.y + size(node).height)) + WORLD_PADDING;
        const scale = Math.min(MAP_WIDTH / (maxX - minX), MAP_HEIGHT / (maxY - minY));
        projection.current = { x: minX, y: minY, scale, offsetX: (MAP_WIDTH - (maxX - minX) * scale) / 2, offsetY: (MAP_HEIGHT - (maxY - minY) * scale) / 2 };
      } else projection.current = { x: -500, y: -500, scale: .16, offsetX: 40, offsetY: 0 };
      const map = projection.current;
      const point = (x: number, y: number) => ({ x: (x - map.x) * map.scale + map.offsetX, y: (y - map.y) * map.scale + map.offsetY });
      const dpr = window.devicePixelRatio || 1;
      if (image.width !== MAP_WIDTH * dpr || image.height !== MAP_HEIGHT * dpr) { image.width = MAP_WIDTH * dpr; image.height = MAP_HEIGHT * dpr; }
      const context = image.getContext('2d');
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
      for (const node of nodes) {
        const pos = point(node.position.x, node.position.y);
        const dimensions = size(node);
        const width = Math.max(dimensions.width * map.scale, 2);
        const height = Math.max(dimensions.height * map.scale, 2);
        const type = node.data.node.type;
        const section = type === 'canvasSection';
        const color = colors[type === 'imageGeneration' ? 'image' : type === 'videoGeneration' ? 'video' : type === 'audioGeneration' ? 'audio' : section ? 'frame' : 'node'] || colors.node || '';
        context.globalAlpha = section ? .95 : .8;
        context.fillStyle = color;
        context.strokeStyle = color;
        if (!section) context.fillRect(pos.x, pos.y, width, height);
        if (section) { context.lineWidth = 1; context.strokeRect(pos.x, pos.y, width, height); }
      }
      const [x, y, zoom] = state.transform;
      const pos = point(-x / zoom, -y / zoom);
      const width = Math.max(state.width / zoom * map.scale, 4);
      const height = Math.max(state.height / zoom * map.scale, 4);
      // Every live transform moves the outline. The rounded layer holds
      // the origin until the gesture ends or the reference's 120ms motion idle.
      // This is visual state: do not wait for debounced project persistence.
      const [settledX, settledY, settledZoom] = settled;
      const committed = point(-settledX / settledZoom, -settledY / settledZoom);
      Object.assign(viewportFrame.style, {
        left: `${committed.x}px`, top: `${committed.y}px`,
        width: `${Math.max(state.width / settledZoom * map.scale, 4)}px`,
        height: `${Math.max(state.height / settledZoom * map.scale, 4)}px`,
      });
      context.globalAlpha = 1;
      context.strokeStyle = colors.frame || '';
      context.lineWidth = 1;
      context.beginPath();
      context.roundRect(pos.x, pos.y, width, height, viewportRadius);
      context.stroke();
    };
    repaint.current = () => draw(true);
    readColors(); draw();
    const unsubscribe = store.subscribe(() => draw());
    const theme = new MutationObserver(() => { readColors(); draw(); });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => { if (settleTimer) clearTimeout(settleTimer); repaint.current = () => {}; unsubscribe(); theme.disconnect(); };
  }, [store]);

  function worldPoint(event: PointerEvent) {
    const rect = event.currentTarget.getBoundingClientRect();
    const map = projection.current;
    return { x: (event.clientX - rect.left - map.offsetX) / map.scale + map.x, y: (event.clientY - rect.top - map.offsetY) / map.scale + map.y };
  }
  function moveViewport(event: PointerEvent) {
    const point = worldPoint(event);
    const state = store.getState();
    const zoom = state.transform[2];
    const viewport = { x: state.width / 2 - point.x * zoom, y: state.height / 2 - point.y * zoom, zoom };
    if (drag.current) drag.current.viewport = viewport;
    void flow.setViewport(viewport);
  }
  function finish(event: PointerEvent) {
    const gesture = drag.current;
    drag.current = null;
    if (!gesture) return;
    if (event.type !== 'pointercancel' && gesture.nodeId && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 3) onNodeClick(gesture.nodeId);
    else if (gesture.viewport) onViewportChange(gesture.viewport);
    repaint.current();
  }
  return <div ref={root} className="canvas-minimap" style={{ width: MAP_WIDTH, height: MAP_HEIGHT }}
    onPointerDown={event => {
      event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
      const point = worldPoint(event);
      const hit = [...store.getState().nodes].reverse().find(node => !node.hidden && point.x >= node.position.x && point.y >= node.position.y && point.x <= node.position.x + (node.measured?.width ?? node.width ?? 1) && point.y <= node.position.y + (node.measured?.height ?? node.height ?? 1));
      drag.current = { x: event.clientX, y: event.clientY, ...(hit ? { nodeId: hit.id } : {}) };
      moveViewport(event);
    }}
    onPointerMove={event => { if (drag.current) moveViewport(event); }} onPointerUp={finish} onPointerCancel={finish} onWheel={event => event.stopPropagation()}>
    <canvas ref={canvas} width={MAP_WIDTH} height={MAP_HEIGHT} aria-label={t('canvas.minimap.label')} />
    <div ref={frame} className="canvas-minimap-viewport" />
  </div>;
}
