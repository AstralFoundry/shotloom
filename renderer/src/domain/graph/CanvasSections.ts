import { canvasNodeDimensions } from './CanvasNodeDimensions.ts';

interface SectionNode {
  id: string;
  type: string;
  x?: unknown;
  y?: unknown;
  canvasWidth?: unknown;
  canvasHeight?: unknown;
  archived?: boolean;
}

/** Membership follows geometry, so dragging a node out never leaves a stale parent. */
export function canvasSectionMembers<T extends SectionNode>(section: SectionNode, nodes: T[]): T[] {
  const size = canvasNodeDimensions(section);
  const left = Number(section.x) || 0;
  const top = Number(section.y) || 0;
  return nodes.filter(node => {
    if (node.archived || node.type === 'canvasSection') return false;
    const bounds = canvasNodeDimensions(node);
    const x = Number(node.x) || 0;
    const y = Number(node.y) || 0;
    return x >= left && y >= top && x + bounds.width <= left + size.width && y + bounds.height <= top + size.height;
  });
}

export function canvasSectionBounds(nodes: SectionNode[], fallback: { x: number; y: number }) {
  const members = nodes.filter(node => !node.archived && node.type !== 'canvasSection');
  if (!members.length) return { ...fallback, canvasWidth: 800, canvasHeight: 560 };
  const left = Math.min(...members.map(node => Number(node.x) || 0));
  const top = Math.min(...members.map(node => Number(node.y) || 0));
  const right = Math.max(...members.map(node => (Number(node.x) || 0) + canvasNodeDimensions(node).width));
  const bottom = Math.max(...members.map(node => (Number(node.y) || 0) + canvasNodeDimensions(node).height));
  return { x: left - 32, y: top - 56, canvasWidth: Math.max(240, right - left + 64), canvasHeight: Math.max(160, bottom - top + 88) };
}
