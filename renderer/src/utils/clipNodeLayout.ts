/** Canvas logical pixels. Sent to the embedded editor so it cannot invent a second geometry. */
export const CLIP_NODE_LAYOUT = {
  toolbar: 40,
  ruler: 28,
  row: 80,
  rail: 44,
  border: 2,
  // Keep the native canvas title/drag target between preview and timeline.
  previewGap: 32,
  maxRows: 6,
} as const;

export function clipNodeHeight(project: unknown) {
  const tracks = (project as { tracks?: unknown[] } | null)?.tracks;
  const rows = Math.min(CLIP_NODE_LAYOUT.maxRows, Math.max(1, tracks?.length || 0));
  return CLIP_NODE_LAYOUT.toolbar + CLIP_NODE_LAYOUT.ruler + CLIP_NODE_LAYOUT.border + rows * CLIP_NODE_LAYOUT.row;
}

export function clipNodePreviewHeight(width: number) {
  return width * 9 / 16 + CLIP_NODE_LAYOUT.previewGap;
}
