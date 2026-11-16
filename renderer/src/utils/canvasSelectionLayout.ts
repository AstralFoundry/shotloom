export type CanvasAlignment = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom' | 'distributeX' | 'distributeY';
export interface LayoutBox { id: string; x: number; y: number; width: number; height: number }

/** Align selection bounds; distribution preserves the outer edges and equalizes gaps. */
export function alignCanvasSelection(boxes: readonly LayoutBox[], mode: CanvasAlignment) {
  if (boxes.length < 2 || (mode.startsWith('distribute') && boxes.length < 3)) return [];
  const horizontal = ['left', 'centerX', 'right', 'distributeX'].includes(mode);
  const axis = horizontal ? 'x' : 'y';
  const extent = horizontal ? 'width' : 'height';
  const start = Math.min(...boxes.map(box => box[axis]));
  const end = Math.max(...boxes.map(box => box[axis] + box[extent]));
  const ordered = mode.startsWith('distribute') ? [...boxes].sort((a, b) => a[axis] - b[axis]) : boxes;
  const gap = (end - start - boxes.reduce((sum, box) => sum + box[extent], 0)) / (boxes.length - 1);
  let cursor = start;
  return ordered.flatMap(box => {
    let position = start;
    if (mode === 'centerX' || mode === 'centerY') position = (start + end - box[extent]) / 2;
    if (mode === 'right' || mode === 'bottom') position = end - box[extent];
    if (mode.startsWith('distribute')) { position = cursor; cursor += box[extent] + gap; }
    const next = { id: box.id, x: box.x, y: box.y, [axis]: Math.round(position) };
    return next.x === box.x && next.y === box.y ? [] : [next];
  });
}
