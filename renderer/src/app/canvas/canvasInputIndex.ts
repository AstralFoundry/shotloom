import type { WorkflowNodeData, WorkflowEdge, WorkflowIncomingInput } from './WorkflowCanvas';

type InputEntry = { revision: string; inputs: WorkflowIncomingInput[] };
const cache = new WeakMap<WorkflowNodeData[], { edges: WorkflowEdge[]; fallback: string; index: Map<string, InputEntry> }>();

/** View nodes are immutable adapter snapshots. Camera changes reuse their input graph. */
export function canvasInputIndex(nodes: WorkflowNodeData[], edges: WorkflowEdge[], fallback: string) {
  const previous = cache.get(nodes);
  if (previous?.edges === edges && previous.fallback === fallback) return previous.index;
  const byId = new Map(nodes.map(node => [node.id, node]));
  const index = new Map<string, InputEntry>();
  const revisions = new Map<string, string[]>();
  for (const edge of edges) {
    const source = byId.get(edge.source);
    const entry = index.get(edge.target) || { revision: '', inputs: [] };
    index.set(edge.target, entry);
    const parts = revisions.get(edge.target) || [];
    parts.push([edge.id, edge.source, edge.data?.inputRole || '', edge.data?.inputSlot || '',
      edge.data?.skipTaskInput === true ? 'inactive' : 'active', source?.updatedAt || '', source?.selectedOutputNodeId || ''].join(':'));
    revisions.set(edge.target, parts);
    if (!source) continue;
    const outputs = Array.isArray(source.generatedOutputs) ? source.generatedOutputs : [];
    const selected = outputs.find(item => item && typeof item === 'object' && item.selected) || outputs[0];
    const uploaded = source.uploadedFile && typeof source.uploadedFile === 'object' ? source.uploadedFile : null;
    const candidate = selected && typeof selected === 'object' ? selected : uploaded || source;
    entry.inputs.push({ ...candidate, edgeId: edge.id, nodeId: source.id,
      name: String(candidate.title || candidate.name || candidate.fileName || source.title || fallback),
      resourceType: candidate.resourceType || source.resourceType || '', inputRole: edge.data?.inputRole || 'auto',
      inputSlot: edge.data?.inputSlot || '', skipTaskInput: edge.data?.skipTaskInput === true });
  }
  for (const [id, entry] of index) entry.revision = revisions.get(id)!.join('|');
  cache.set(nodes, { edges, fallback, index });
  return index;
}
