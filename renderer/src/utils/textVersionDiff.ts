export type TextDiffLine = { type: 'same' | 'added' | 'removed'; text: string };

export function diffTextLines(previous: unknown, current: unknown): TextDiffLine[] {
  const oldLines = String(previous ?? '').split('\n');
  const newLines = String(current ?? '').split('\n');
  if (oldLines.length * newLines.length > 120000) {
    return [
      ...oldLines.map((text) => ({ type: 'removed' as const, text })),
      ...newLines.map((text) => ({ type: 'added' as const, text })),
    ];
  }
  const table = Array.from({ length: oldLines.length + 1 }, () => new Uint32Array(newLines.length + 1));
  // 表按 oldLines+1 x newLines+1 预留，读取位置恒在界内；cell 只为满足
  // noUncheckedIndexedAccess 的越界读推断。
  const cell = (i: number, j: number) => table[i]?.[j] ?? 0;
  for (let i = oldLines.length - 1; i >= 0; i--) {
    const row = table[i];
    if (!row) continue;
    for (let j = newLines.length - 1; j >= 0; j--) {
      row[j] = oldLines[i] === newLines[j]
        ? cell(i + 1, j + 1) + 1
        : Math.max(cell(i + 1, j), cell(i, j + 1));
    }
  }
  const diff: TextDiffLine[] = [];
  let i = 0;
  let j = 0;
  // 循环条件保证 i/j 在各自数组界内，越界分支只会取到另一侧的行。
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      diff.push({ type: 'same', text: oldLines[i] as string });
      i++;
      j++;
    } else if (j < newLines.length && (i === oldLines.length || cell(i, j + 1) >= cell(i + 1, j))) {
      diff.push({ type: 'added', text: newLines[j++] as string });
    } else {
      diff.push({ type: 'removed', text: oldLines[i++] as string });
    }
  }
  return diff;
}
