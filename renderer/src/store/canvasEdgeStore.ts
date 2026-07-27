/**
 * Edge toggle store — lightweight enable/disable for canvas edges without
 * deleting them. Disabled edges are ignored by downstream task execution
 * but remain in the graph, enabling A/B testing and reversible pipeline
 * branching.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Edge = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Project = { edges?: Edge[]; [key: string]: any };

/**
 * Toggle or set the enabled state on a canvas edge.
 * Returns false if the edge is not found.
 */
export function toggleCanvasEdge(
  project: Project,
  edgeId: string,
  enabled?: boolean,
): boolean {
  const edge = (project.edges || []).find((e) => e.id === edgeId);
  if (!edge) return false;
  edge.enabled = enabled ?? (edge.enabled === false);
  return true;
}

/**
 * Check whether an edge is enabled. Absent `enabled` field defaults to true.
 */
export function isEdgeEnabled(project: Project, edgeId: string): boolean {
  const edge = (project.edges || []).find((e) => e.id === edgeId);
  if (!edge) return false;
  return edge.enabled !== false;
}
