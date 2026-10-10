export function diffTextLines(previous, current) {
  const oldLines = String(previous ?? '').split('\n');
  const newLines = String(current ?? '').split('\n');
  if (oldLines.length * newLines.length > 120000) {
    return [
      ...oldLines.map((text) => ({ type: 'removed', text })),
      ...newLines.map((text) => ({ type: 'added', text })),
    ];
  }
  const table = Array.from({ length: oldLines.length + 1 }, () => new Uint32Array(newLines.length + 1));
  for (let i = oldLines.length - 1; i >= 0; i--) {
    for (let j = newLines.length - 1; j >= 0; j--) {
      table[i][j] = oldLines[i] === newLines[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const diff = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      diff.push({ type: 'same', text: oldLines[i] });
      i++;
      j++;
    } else if (j < newLines.length && (i === oldLines.length || table[i][j + 1] >= table[i + 1][j])) {
      diff.push({ type: 'added', text: newLines[j++] });
    } else {
      diff.push({ type: 'removed', text: oldLines[i++] });
    }
  }
  return diff;
}
