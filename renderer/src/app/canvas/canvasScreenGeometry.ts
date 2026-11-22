import { canvasNodeDimensions } from "../../services/agentLayoutService";
import type { WorkflowNodeData } from "./WorkflowCanvas";

const CANVAS_MENU_WIDTH = 220;
const CANVAS_MENU_HEIGHT = 468;
const CANVAS_MENU_MARGIN = 8;
const CANVAS_MENU_POINTER_OFFSET = 4;

export function screenPixel(value: number) {
  const dpr = typeof window === "undefined" ? 1 : Math.max(1, window.devicePixelRatio || 1);
  return Math.round(value * dpr) / dpr;
}

export function workflowNodeDimensions(node: WorkflowNodeData) {
  return canvasNodeDimensions(node);
}

export function canvasMenuPosition(
  clientX: number,
  clientY: number,
  bounds: Pick<DOMRect, "left" | "top" | "width" | "height">,
  menuHeight = CANVAS_MENU_HEIGHT,
  side: 'left' | 'right' = 'right',
  menuWidth = CANVAS_MENU_WIDTH,
) {
  const maxX = Math.max(CANVAS_MENU_MARGIN, bounds.width - menuWidth - CANVAS_MENU_MARGIN);
  const maxY = Math.max(
    CANVAS_MENU_MARGIN,
    bounds.height - menuHeight - CANVAS_MENU_MARGIN,
  );
  return {
    x: Math.min(
      maxX,
      Math.max(CANVAS_MENU_MARGIN, clientX - bounds.left + (side === 'left'
        ? -menuWidth - CANVAS_MENU_POINTER_OFFSET : CANVAS_MENU_POINTER_OFFSET)),
    ),
    y: Math.min(
      maxY,
      Math.max(CANVAS_MENU_MARGIN, clientY - bounds.top + CANVAS_MENU_POINTER_OFFSET),
    ),
  };
}

/** Same bottom-row collision rule as open-ai-canvas's canvas-overlay-layout. */
export function canvasBottomRowLayout(controls: { left: number; right: number }, row: { left: number; right: number }, toolbarWidth: number, gap: number) {
  const maxShift = Math.max(0, Math.floor((row.right - row.left - toolbarWidth) / 2));
  const shiftFrom = (start: number) => Math.min(maxShift, Math.max(0, Math.round((start - row.left) / 2)));
  const besideControls = controls.right + gap;
  if (besideControls + toolbarWidth > row.right) return { shift: shiftFrom(controls.left), stacked: true };
  const clearControls = Math.ceil(besideControls - (row.left + row.right - toolbarWidth) / 2);
  return { shift: Math.min(maxShift, Math.max(shiftFrom(controls.left), clearControls, 0)), stacked: false };
}
