function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function entityChange(items, id) {
  const value = (items || []).find((item) => String(item.id) === String(id));
  return { id: String(id), value: value ? clonePlain(value) : null };
}

export function captureCanvasTransaction(project, nodeIds, edgeIds, selection = {}) {
  return {
    kind: 'canvas-transaction',
    nodes: [...new Set(nodeIds || [])].map((id) => entityChange(project.nodes, id)),
    edges: [...new Set(edgeIds || [])].map((id) => entityChange(project.edges, id)),
    selectedNodeId: selection.selectedNodeId || null,
    selectedNodeIds: [...(selection.selectedNodeIds || [])],
  };
}

function applyChanges(items, changes) {
  const byId = new Map((items || []).map((item) => [String(item.id), item]));
  for (const change of changes || []) {
    if (change.value == null) byId.delete(String(change.id));
    else byId.set(String(change.id), clonePlain(change.value));
  }
  return [...byId.values()];
}

export function applyCanvasTransaction(project, transaction) {
  project.nodes = applyChanges(project.nodes, transaction.nodes);
  project.edges = applyChanges(project.edges, transaction.edges);
}

export function canvasTransactionChanged(project, transaction) {
  const changed = (items, changes) => (changes || []).some((change) => {
    const current = entityChange(items, change.id).value;
    return JSON.stringify(current) !== JSON.stringify(change.value);
  });
  return changed(project.nodes, transaction.nodes) || changed(project.edges, transaction.edges);
}

export function filterChangedCanvasTransaction(project, transaction) {
  const changed = (items, changes) => (changes || []).filter((change) => {
    const current = entityChange(items, change.id).value;
    return JSON.stringify(current) !== JSON.stringify(change.value);
  });
  return {
    ...transaction,
    nodes: changed(project.nodes, transaction.nodes),
    edges: changed(project.edges, transaction.edges),
  };
}
