export function formatEditorTime(seconds: number) {
  const value = Math.max(0, Number(seconds) || 0);
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${
    (value % 60).toFixed(1).padStart(4, "0")
  }`;
}

export function formatEditorTimecode(seconds: number) {
  const value = Math.max(0, Number(seconds) || 0);
  return [
    Math.floor(value / 3600),
    Math.floor((value % 3600) / 60),
    Math.floor(value % 60),
    Math.floor((value % 1) * 30),
  ].map((part) => String(part).padStart(2, "0")).join(":");
}
