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

export function selectedLocalMediaPath(node: WorkflowNodeData) {
  const outputs = Array.isArray(node.generatedOutputs)
    ? node.generatedOutputs.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>>
    : [];
  const selected = outputs.find((item) => item.selected) || outputs[outputs.length - 1];
  const uploaded = node.uploadedFile && typeof node.uploadedFile === "object"
    ? node.uploadedFile as Record<string, unknown>
    : null;
  return String(selected?.filePath || selected?.path || uploaded?.filePath || uploaded?.path || node.filePath || "");
}

export function canvasMenuPosition(
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
