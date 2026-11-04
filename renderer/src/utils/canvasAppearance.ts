export const CANVAS_PATTERNS = ['dots', 'grid', 'solid'] as const;
export const CANVAS_COLORS = ['default', 'warm', 'cool', 'paper', 'sage', 'blue', 'lavender', 'pink', 'sand'] as const;
export const CANVAS_EDGE_MODES = ['all', 'hidden', 'manual'] as const;
export interface CanvasAppearance {
  pattern: typeof CANVAS_PATTERNS[number];
  color: typeof CANVAS_COLORS[number];
  edges: typeof CANVAS_EDGE_MODES[number];
}
export function normalizeCanvasAppearance(value: unknown = {}): CanvasAppearance {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    pattern: CANVAS_PATTERNS.find(item => item === source.pattern) ?? 'dots',
    color: CANVAS_COLORS.find(item => item === source.color) ?? 'default',
    edges: CANVAS_EDGE_MODES.find(item => item === source.edges) ?? 'all',
  };
}
export function canvasEdgeVisible(edge: { data?: Record<string, unknown> }, mode: CanvasAppearance['edges']) {
  return mode === 'all' || (mode === 'manual' && edge.data?.creationSource === 'manual');
}
