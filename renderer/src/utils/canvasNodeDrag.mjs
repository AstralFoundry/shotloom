export function reconcileCanvasNodes(currentNodes, canonicalNodes, draggingIds) {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));
  const canonicalIds = new Set(canonicalNodes.map((node) => node.id));
  const reconciled = canonicalNodes.map((canonical) => {
    const current = currentById.get(canonical.id);
    if (!current) return canonical;
    if (!draggingIds.has(canonical.id)) return current === canonical ? current : canonical;
    return {
      ...canonical,
      position: current.position,
      dragging: true,
    };
  });
  for (const current of currentNodes) {
    if (draggingIds.has(current.id) && !canonicalIds.has(current.id)) {
      reconciled.push({ ...current, dragging: true });
    }
  }
  return reconciled;
}

export function draggedCanvasPositions(primaryNode, draggedNodes, semanticZoom) {
  const zoom = Number(semanticZoom);
  if (!Number.isFinite(zoom) || zoom <= 0) return [];
  const candidates = draggedNodes.length ? draggedNodes : primaryNode ? [primaryNode] : [];
  const positions = new Map();
  for (const node of candidates) {
    const x = Number(node?.position?.x);
    const y = Number(node?.position?.y);
    if (!node?.id || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    positions.set(node.id, {
      id: node.id,
      x: Math.round(x / zoom),
      y: Math.round(y / zoom),
    });
  }
  return [...positions.values()];
}
