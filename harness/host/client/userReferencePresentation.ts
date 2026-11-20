/** Hide the serialized reference payload in the user transcript; the stored message still keeps it for the Agent. */
export function presentUserReferences(source: string) {
  const canvasReferences: Array<{ id: string; label: string }> = [];
  const text = source.replace(
    /<shotloom-canvas-reference>\s*([\s\S]*?)\s*<\/shotloom-canvas-reference>/g,
    (original, payload: string) => {
      try {
        const value = JSON.parse(payload);
        const id = value.node?.id;
        const label = value.node?.label;
        if (typeof id !== 'string' || typeof label !== 'string' || !value.snapshot) return original;
        const display = label.replaceAll('"', '’');
        canvasReferences.push({ id, label });
        return `@"${display}"`;
      } catch { return original; }
    },
  );
  return { text, canvasReferences };
}
