type AnyRecord = { [key: string]: any };

export type CanvasEntityChange = { id: string; value: any };

export type CanvasTransaction = {
  kind: 'canvas-transaction';
  nodes: CanvasEntityChange[];
  edges: CanvasEntityChange[];
  selectedNodeId: any;
  selectedNodeIds: any[];
};

type TransactionProject = { nodes?: AnyRecord[] | null; edges?: AnyRecord[] | null; [key: string]: any };

function clonePlain(value: any) {
  return JSON.parse(JSON.stringify(value));
}

function entityChange(items: AnyRecord[] | null | undefined, id: unknown): CanvasEntityChange {
  const value = (items || []).find((item) => String(item.id) === String(id));
  return { id: String(id), value: value ? clonePlain(value) : null };
}

export function captureCanvasTransaction(
  project: TransactionProject,
  nodeIds?: unknown[] | null,
  edgeIds?: unknown[] | null,
  selection: { selectedNodeId?: any; selectedNodeIds?: unknown[] | null } = {},
): CanvasTransaction {
  return {
    kind: 'canvas-transaction',
    nodes: [...new Set(nodeIds || [])].map((id) => entityChange(project.nodes, id)),
    edges: [...new Set(edgeIds || [])].map((id) => entityChange(project.edges, id)),
    selectedNodeId: selection.selectedNodeId || null,
    selectedNodeIds: [...(selection.selectedNodeIds || [])],
  };
}

function applyChanges(items: AnyRecord[] | null | undefined, changes: CanvasEntityChange[] | null | undefined) {
  const byId = new Map((items || []).map((item) => [String(item.id), item]));
  for (const change of changes || []) {
    if (change.value == null) byId.delete(String(change.id));
    else byId.set(String(change.id), clonePlain(change.value));
  }
  return [...byId.values()];
}

export function applyCanvasTransaction(project: TransactionProject, transaction: CanvasTransaction) {
  project.nodes = applyChanges(project.nodes, transaction.nodes);
  project.edges = applyChanges(project.edges, transaction.edges);
}

export function canvasTransactionChanged(project: TransactionProject, transaction: CanvasTransaction) {
  const changed = (items: AnyRecord[] | null | undefined, changes: CanvasEntityChange[] | null | undefined) => (changes || []).some((change) => {
    const current = entityChange(items, change.id).value;
    return JSON.stringify(current) !== JSON.stringify(change.value);
  });
  return changed(project.nodes, transaction.nodes) || changed(project.edges, transaction.edges);
}

export function filterChangedCanvasTransaction(
  project: TransactionProject,
  transaction: CanvasTransaction,
): CanvasTransaction {
  const changed = (items: AnyRecord[] | null | undefined, changes: CanvasEntityChange[] | null | undefined) => (changes || []).filter((change) => {
    const current = entityChange(items, change.id).value;
    return JSON.stringify(current) !== JSON.stringify(change.value);
  });
  return {
    ...transaction,
    nodes: changed(project.nodes, transaction.nodes),
    edges: changed(project.edges, transaction.edges),
  };
}
