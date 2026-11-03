type CropRect = { x: number; y: number; width: number; height: number };

export function imageGridCellRect(selection: CropRect, rows: number, cols: number, index: number): CropRect {
  const row = Math.floor(index / cols);
  const col = index % cols;
  const left = selection.x + selection.width * col / cols;
  const top = selection.y + selection.height * row / rows;
  const right = selection.x + selection.width * (col + 1) / cols;
  const bottom = selection.y + selection.height * (row + 1) / rows;
  return { x: left, y: top, width: right - left, height: bottom - top };
}
