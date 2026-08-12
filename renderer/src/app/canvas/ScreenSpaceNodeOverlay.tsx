import {
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { type ReactFlowState, useStore } from "@xyflow/react";
import { resolveFloatingOverlayPosition } from "../../utils/floatingCanvasOverlay.mjs";
import { CanvasOverlayRootContext } from "./WorkflowCanvas";

interface OverlayRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

const DEFAULT_OVERLAY_WIDTH = 620;
const DEFAULT_OVERLAY_HEIGHT = 205;

function sameCanvasGeometry(
  left: { signature: string },
  right: { signature: string },
) {
  return left.signature === right.signature;
}

function localElementRect(element: Element, rootRect: DOMRect): OverlayRect | null {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    left: rect.left - rootRect.left,
    right: rect.right - rootRect.left,
    top: rect.top - rootRect.top,
    bottom: rect.bottom - rootRect.top,
    width: rect.width,
    height: rect.height,
  };
}

export function ScreenSpaceNodeOverlay({
  nodeId,
  children,
}: {
  nodeId: string;
  children: ReactNode;
}) {
  const root = useContext(CanvasOverlayRootContext);
  const overlayRef = useRef<HTMLDivElement>(null);
  const selectGeometry = useCallback((state: ReactFlowState) => {
    const internal = state.nodeLookup.get(nodeId);
    const [viewportX, viewportY, zoom] = state.transform;
    const position = internal?.internals.positionAbsolute;
    const width = Number(internal?.measured.width || internal?.width || 0);
    const height = Number(internal?.measured.height || internal?.height || 0);
    const anchorRect = {
      left: viewportX + Number(position?.x || 0) * zoom,
      right: viewportX + (Number(position?.x || 0) + width) * zoom,
      top: viewportY + Number(position?.y || 0) * zoom,
      bottom: viewportY + (Number(position?.y || 0) + height) * zoom,
      width: width * zoom,
      height: height * zoom,
    };
    const obstacleRects = [...state.nodeLookup.values()]
      .filter((item) => item.id !== nodeId && !item.hidden)
      .map((item) => {
        const itemPosition = item.internals.positionAbsolute;
        const itemWidth = Number(item.measured.width || item.width || 0);
        const itemHeight = Number(item.measured.height || item.height || 0);
        return {
          left: viewportX + Number(itemPosition?.x || 0) * zoom,
          right: viewportX + (Number(itemPosition?.x || 0) + itemWidth) * zoom,
          top: viewportY + Number(itemPosition?.y || 0) * zoom,
          bottom: viewportY + (Number(itemPosition?.y || 0) + itemHeight) * zoom,
          width: itemWidth * zoom,
          height: itemHeight * zoom,
        };
      })
      .filter((rect) => (
        rect.width > 0 && rect.height > 0
        && rect.right >= 0 && rect.bottom >= 0
        && rect.left <= state.width && rect.top <= state.height
      ));
    return {
      anchorRect,
      obstacleRects,
      signature: [
        anchorRect.left, anchorRect.top, anchorRect.width, anchorRect.height,
        ...obstacleRects.flatMap((rect) => [rect.left, rect.top, rect.width, rect.height]),
      ].map((value) => Math.round(value)).join(":"),
    };
  }, [nodeId]);
  const geometry = useStore(selectGeometry, sameCanvasGeometry);
  const [surface, setSurface] = useState(() => ({
    width: 0,
    height: 0,
    overlayHeight: DEFAULT_OVERLAY_HEIGHT,
    boundaryRect: null as OverlayRect | null,
    obstacleRects: [] as OverlayRect[],
  }));

  useLayoutEffect(() => {
    if (!root) return undefined;
    const sidebar = document.querySelector(".sidebar-overlay-shell .sidebar-shell");
    const measure = () => {
      const rootRect = root.getBoundingClientRect();
      const sidebarRect = sidebar?.getBoundingClientRect();
      const sidebarRight = sidebarRect && sidebarRect.bottom > rootRect.top && sidebarRect.top < rootRect.bottom
        ? Math.max(0, sidebarRect.right - rootRect.left)
        : 0;
      const boundaryRect: OverlayRect = {
        left: Math.min(rootRect.width, sidebarRight),
        right: rootRect.width,
        top: 0,
        bottom: rootRect.height,
        width: Math.max(0, rootRect.width - sidebarRight),
        height: rootRect.height,
      };
      const obstacleRects = [...root.querySelectorAll(
        ".bottom-mode-switch, .canvas-corner-controls, .canvas-minimap",
      )].map((element) => localElementRect(element, rootRect)).filter(Boolean) as OverlayRect[];
      const overlayHeight = overlayRef.current?.getBoundingClientRect().height || DEFAULT_OVERLAY_HEIGHT;
      setSurface((current) => {
        const next = {
          width: rootRect.width,
          height: rootRect.height,
          overlayHeight,
          boundaryRect,
          obstacleRects,
        };
        return JSON.stringify(current) === JSON.stringify(next) ? current : next;
      });
    };
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(root);
    if (overlayRef.current) resizeObserver.observe(overlayRef.current);
    if (sidebar) resizeObserver.observe(sidebar);
    const mutationObserver = sidebar ? new MutationObserver(measure) : null;
    mutationObserver?.observe(sidebar!, { attributes: true, attributeFilter: ["class", "style"] });
    window.addEventListener("resize", measure);
    return () => {
      resizeObserver.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [root]);

  if (!root) return null;
  const boundary = surface.boundaryRect || {
    left: 0, right: surface.width, top: 0, bottom: surface.height,
    width: surface.width, height: surface.height,
  };
  const overlayWidth = Math.min(
    DEFAULT_OVERLAY_WIDTH,
    Math.max(280, boundary.right - boundary.left - 24),
  );
  const placement = resolveFloatingOverlayPosition({
    anchorRect: geometry.anchorRect,
    overlayRect: { width: overlayWidth, height: surface.overlayHeight },
    viewportWidth: surface.width,
    viewportHeight: surface.height,
    boundaryRect: boundary,
    obstacleRects: [...geometry.obstacleRects, ...surface.obstacleRects],
  });
  return createPortal(
    <div
      ref={overlayRef}
      className="work-composer-anchor"
      style={{
        left: placement.left,
        top: placement.top,
        width: overlayWidth,
        visibility: placement.visible ? "visible" : "hidden",
        pointerEvents: placement.visible ? "auto" : "none",
      }}
    >
      {children}
    </div>,
    root,
  );
}
