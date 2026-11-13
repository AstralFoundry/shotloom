/** Hide the serialized reference payload in the user transcript; the stored message still keeps it for the Agent. */
export function presentUserReferences(source: string) {
  const canvasReferences: Array<{ id: string; label: string }> = [];
  const text = source.replace(
    /<shotloom-(canvas|director)-reference>\s*([\s\S]*?)\s*<\/shotloom-\1-reference>/g,
    (original, kind: string, payload: string) => {
      try {
        const value = JSON.parse(payload);
        const id = value.node?.id;
        const label = value.node?.label;
        if (typeof id !== 'string' || typeof label !== 'string' || !value.snapshot) return original;
        const display = label.replaceAll('"', '’');
        if (kind === 'director') {
          return id.startsWith('director:') ? `@导演台「${display}」` : original;
        }
        canvasReferences.push({ id, label });
        return `@"${display}"`;
      } catch { return original; }
    },
  );
  return { text, canvasReferences };
}
