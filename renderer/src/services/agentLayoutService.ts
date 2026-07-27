import type { AgentNode, AgentProject } from './agentTypes';
import { canvasNodeDimensions } from '../domain/graph/CanvasNodeDimensions.ts';

export { canvasNodeDimensions } from '../domain/graph/CanvasNodeDimensions.ts';

export type AgentLayoutScope = 'selection' | 'workflow' | 'all';

export interface AgentLayoutOptions {
  x?: number;
  y?: number;
  gapX?: number;
  gapY?: number;
  scope?: AgentLayoutScope;
}

export interface AgentLayoutResult {
  movedCount: number;
  nodeIds: string[];
  laneCount: number;
  bounds: { x: number; y: number; width: number; height: number } | null;
}

interface LayoutItem {
  node: AgentNode;
  index: number;
}

const SUPPORTED_NODE_TYPES = new Set([
  'imageGeneration',
  'videoGeneration',
  'audioGeneration',
  'textGeneration',
  'resource',
  'note',
  'board',
  'threeDDirector',
]);

const TERMINAL_ROLE_PATTERN = /(final|video|shot|audio|sound|music|dialogue|voiceover|subtitle|caption|title|delivery|poster|成片|镜头|音频|配音|字幕|片名|交付)/i;

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function nodeSegmentIds(node: AgentNode): string[] {
  const direct = stringList(node.segmentIds);
  return direct.length ? direct : stringList(node.agentPlan?.segmentIds);
}

function nodeRunId(node: AgentNode): string {
  return String(node.agentPlan?.runId || '');
}

function nodeRole(node: AgentNode): string {
  return String(node.artifactRole || node.agentPlan?.artifactRole || '').trim();
}

function segmentSortParts(value: string): Array<string | number> {
  return value.toLowerCase().split(/(\d+)/).filter(Boolean).map((part) => /^\d+$/.test(part) ? Number(part) : part);
}

function compareSegmentIds(a: string, b: string): number {
  const left = segmentSortParts(a);
  const right = segmentSortParts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (left[index] == null) return -1;
    if (right[index] == null) return 1;
    if (left[index] === right[index]) continue;
    const leftPart = left[index];
    const rightPart = right[index];
    if (typeof leftPart === 'number' && typeof rightPart === 'number') return leftPart - rightPart;
    return String(left[index]).localeCompare(String(right[index]), 'zh-CN');
  }
  return 0;
}

function semanticBaseDepth(node: AgentNode): number {
  const role = nodeRole(node);
  if (TERMINAL_ROLE_PATTERN.test(role)) return 2;
  if (node.type === 'videoGeneration' || node.type === 'audioGeneration') return 2;
  if (node.type === 'imageGeneration' || node.type === 'board' || node.type === 'threeDDirector') return 1;
  if (node.type === 'resource' && /video|audio/i.test(String(node.resourceType || ''))) return 2;
  return 0;
}

function sequenceNumber(item: LayoutItem): number {
  const text = `${nodeRole(item.node)} ${item.node.title || item.node.name || ''}`;
  const match = text.match(/(?:^|\D)(\d{1,3})(?:\D|$)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function semanticItemSort(a: LayoutItem, b: LayoutItem): number {
  const typeOrder = (node: AgentNode) => {
    if (node.type === 'textGeneration' || node.type === 'note') return 0;
    if (node.type === 'imageGeneration' || node.type === 'board' || node.type === 'threeDDirector') return 1;
    if (node.type === 'videoGeneration') return 2;
    if (node.type === 'audioGeneration') return 3;
    return 4;
  };
  const leftSegments = nodeSegmentIds(a.node);
  const rightSegments = nodeSegmentIds(b.node);
  const leftSegment = leftSegments.length === 1 ? leftSegments[0] : '';
  const rightSegment = rightSegments.length === 1 ? rightSegments[0] : '';
  const segmentOrder = leftSegment && rightSegment
    ? compareSegmentIds(leftSegment, rightSegment)
    : leftSegment ? 1 : rightSegment ? -1 : 0;
  return segmentOrder
    || typeOrder(a.node) - typeOrder(b.node)
    || sequenceNumber(a) - sequenceNumber(b)
    || String(a.node.title || a.node.name || '').localeCompare(String(b.node.title || b.node.name || ''), 'zh-CN')
    || a.index - b.index;
}

function selectLayoutNodes(project: AgentProject, requestedIds: Set<string>, scope: AgentLayoutScope): AgentNode[] {
  const supported = (project.nodes || []).filter((node) => SUPPORTED_NODE_TYPES.has(node.type) && !node.archived);
  if (scope === 'all') return supported;
  if (scope === 'selection') return supported.filter((node) => requestedIds.has(node.id));

  const requested = supported.filter((node) => requestedIds.has(node.id));
  const runIds = new Set(requested.map(nodeRunId).filter(Boolean));
  const selectedIds = new Set(requested.map((node) => node.id));
  supported.forEach((node) => {
    if (runIds.has(nodeRunId(node))) selectedIds.add(node.id);
  });

  // Some older canvas actions did not persist runId/segmentIds on shared assets.
  // Graph connectivity is the canonical relationship: include planned upstream
  // assets that directly or transitively feed the selected workflow.
  const supportedById = new Map(supported.map((node) => [node.id, node]));
  const incoming = new Map<string, string[]>();
  for (const edge of project.edges || []) {
    if (!supportedById.has(edge.source) || !supportedById.has(edge.target)) continue;
    if (!incoming.has(edge.target)) incoming.set(edge.target, []);
    incoming.get(edge.target)?.push(edge.source);
  }
  const queue = [...selectedIds];
  while (queue.length) {
    const targetId = queue.shift() as string;
    for (const sourceId of incoming.get(targetId) || []) {
      if (selectedIds.has(sourceId)) continue;
      const source = supportedById.get(sourceId);
      if (!source || source.agentPlan?.source !== 'assistant') continue;
      selectedIds.add(sourceId);
      queue.push(sourceId);
    }
  }
  return supported.filter((node) => selectedIds.has(node.id));
}

function layoutGroup(
  items: LayoutItem[],
  edges: AgentProject['edges'],
  startX: number,
  startY: number,
  columnGap: number,
  rowGap: number,
) {
  const ids = new Set(items.map((item) => item.node.id));
  const parents = new Map(items.map((item) => [item.node.id, [] as string[]]));
  const children = new Map(items.map((item) => [item.node.id, [] as string[]]));
  for (const edge of edges || []) {
    if (ids.has(edge.source) && ids.has(edge.target)) {
      parents.get(edge.target)?.push(edge.source);
      children.get(edge.source)?.push(edge.target);
    }
  }

  const depths = new Map<string, number>();
  const depthFor = (id: string, visiting = new Set<string>()): number => {
    if (depths.has(id)) return depths.get(id) || 0;
    const item = itemByIdForGroup.get(id);
    if (!item) return 0;
    const base = semanticBaseDepth(item.node);
    // Malformed cycles stay compact instead of expanding one column per relaxation pass.
    if (visiting.has(id)) return base;
    const nextVisiting = new Set(visiting).add(id);
    const parentDepths = (parents.get(id) || []).map((parentId) => depthFor(parentId, nextVisiting));
    const depth = parentDepths.length ? Math.max(base, Math.max(...parentDepths) + 1) : base;
    depths.set(id, depth);
    return depth;
  };
  const itemByIdForGroup = new Map(items.map((item) => [item.node.id, item]));
  items.forEach((item) => depthFor(item.node.id));

  // Only multiple shots inside the same segment form a left-to-right timeline.
  // Sequencing every video in the workflow would create dozens of mostly empty columns.
  const videosBySegment = new Map<string, LayoutItem[]>();
  items.filter((item) => item.node.type === 'videoGeneration').forEach((item) => {
    const key = nodeSegmentIds(item.node)[0] || `__${item.node.id}`;
    if (!videosBySegment.has(key)) videosBySegment.set(key, []);
    videosBySegment.get(key)?.push(item);
  });
  for (const videos of videosBySegment.values()) {
    videos.sort(semanticItemSort);
    if (videos.length < 2) continue;
    const firstVideoDepth = Math.max(2, ...videos.map((item) => depths.get(item.node.id) || 0));
    videos.forEach((item, index) => depths.set(item.node.id, Math.max(depths.get(item.node.id) || 0, firstVideoDepth + index)));
  }

  const columns = new Map<number, LayoutItem[]>();
  for (const item of items) {
    const depth = depths.get(item.node.id) || 0;
    if (!columns.has(depth)) columns.set(depth, []);
    columns.get(depth)?.push(item);
  }

  const orderedColumns = [...columns.entries()].sort(([a], [b]) => a - b);
  orderedColumns.forEach(([, columnItems]) => columnItems.sort(semanticItemSort));
  const itemOrder = new Map<string, number>();
  const refreshOrder = () => orderedColumns.forEach(([, columnItems]) => {
    columnItems.forEach((item, index) => itemOrder.set(item.node.id, index));
  });
  const neighborRank = (item: LayoutItem, direction: 'parents' | 'children') => {
    const idsForRank = direction === 'parents' ? parents.get(item.node.id) : children.get(item.node.id);
    const ranks = (idsForRank || []).map((id) => itemOrder.get(id)).filter((rank): rank is number => rank != null);
    if (!ranks.length) return Number.POSITIVE_INFINITY;
    return ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length;
  };
  const stableSegmentOrder = (a: LayoutItem, b: LayoutItem) => {
    const left = nodeSegmentIds(a.node);
    const right = nodeSegmentIds(b.node);
    return left.length === 1 && right.length === 1 && left[0] !== right[0]
      ? compareSegmentIds(left[0], right[0])
      : 0;
  };
  refreshOrder();
  // Alternating downward/upward barycentric sweeps are the small-graph version
  // of Sugiyama crossing reduction. They keep corresponding segment nodes aligned.
  for (let pass = 0; pass < 4; pass += 1) {
    for (let index = 1; index < orderedColumns.length; index += 1) {
      orderedColumns[index][1].sort((a, b) => stableSegmentOrder(a, b)
        || neighborRank(a, 'parents') - neighborRank(b, 'parents')
        || semanticItemSort(a, b));
      refreshOrder();
    }
    for (let index = orderedColumns.length - 2; index >= 0; index -= 1) {
      orderedColumns[index][1].sort((a, b) => stableSegmentOrder(a, b)
        || neighborRank(a, 'children') - neighborRank(b, 'children')
        || semanticItemSort(a, b));
      refreshOrder();
    }
  }

  const maxDepth = Math.max(...orderedColumns.map(([depth]) => depth));
  const widths = Array.from({ length: maxDepth + 1 }, () => 370);
  for (const [depth, columnItems] of orderedColumns) {
    widths[depth] = Math.max(...columnItems.map((item) => canvasNodeDimensions(item.node).width));
  }
  const columnX = [startX];
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    columnX[depth] = columnX[depth - 1] + widths[depth - 1] + columnGap;
  }

  const relativeY = new Map<string, number>();
  const columnHeights = new Map<number, number>();
  for (const [depth, columnItems] of orderedColumns) {
    let cursorY = 0;
    for (const item of columnItems) {
      relativeY.set(item.node.id, cursorY);
      cursorY += canvasNodeDimensions(item.node).height + rowGap;
    }
    columnHeights.set(depth, Math.max(1, cursorY - rowGap));
  }
  const anchorDepth = orderedColumns.reduce((best, [depth]) =>
    (columnHeights.get(depth) || 0) > (columnHeights.get(best) || 0) ? depth : best,
  orderedColumns[0][0]);
  const offsets = new Map<number, number>([[anchorDepth, 0]]);
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] || 0;
  };
  const alignedOffset = (depth: number, direction: 'parents' | 'children') => {
    const columnItems = columns.get(depth) || [];
    const candidates: number[] = [];
    for (const item of columnItems) {
      const dimensions = canvasNodeDimensions(item.node);
      const neighbors = direction === 'parents' ? parents.get(item.node.id) : children.get(item.node.id);
      for (const neighborId of neighbors || []) {
        const neighborItem = itemByIdForGroup.get(neighborId);
        const neighborDepth = depths.get(neighborId) || 0;
        if (!neighborItem || !offsets.has(neighborDepth)) continue;
        const neighborCenter = (offsets.get(neighborDepth) || 0)
          + (relativeY.get(neighborId) || 0)
          + canvasNodeDimensions(neighborItem.node).height / 2;
        candidates.push(neighborCenter - (relativeY.get(item.node.id) || 0) - dimensions.height / 2);
      }
    }
    return Math.max(0, median(candidates));
  };
  for (let depth = anchorDepth - 1; depth >= 0; depth -= 1) offsets.set(depth, alignedOffset(depth, 'children'));
  for (let depth = anchorDepth + 1; depth <= maxDepth; depth += 1) offsets.set(depth, alignedOffset(depth, 'parents'));

  let width = 0;
  let height = 0;
  for (const [depth, columnItems] of orderedColumns) {
    const offsetY = offsets.get(depth) || 0;
    for (const item of columnItems) {
      item.node.x = Math.round(columnX[depth]);
      item.node.y = Math.round(startY + offsetY + (relativeY.get(item.node.id) || 0));
    }
    width = Math.max(width, columnX[depth] - startX + widths[depth]);
    height = Math.max(height, offsetY + (columnHeights.get(depth) || 0));
  }
  return { width, height: Math.max(height, 1) };
}

export function layoutAgentNodes(
  project: AgentProject,
  nodeIds: string[] = [],
  options: AgentLayoutOptions = {},
): AgentLayoutResult {
  const requestedIds = new Set(nodeIds.filter(Boolean));
  if (!requestedIds.size && options.scope !== 'all') {
    return { movedCount: 0, nodeIds: [], laneCount: 0, bounds: null };
  }
  const scope = options.scope || 'selection';
  const nodes = selectLayoutNodes(project, requestedIds, scope);
  if (!nodes.length) return { movedCount: 0, nodeIds: [], laneCount: 0, bounds: null };

  const oldPositions = new Map(nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
  const startX = Number.isFinite(Number(options.x)) ? Number(options.x) : 120;
  const startY = Number.isFinite(Number(options.y)) ? Number(options.y) : 90;
  const columnGap = Number.isFinite(Number(options.gapX)) ? Math.max(32, Number(options.gapX)) : 260;
  const rowGap = Number.isFinite(Number(options.gapY)) ? Math.max(20, Number(options.gapY)) : 24;
  const plan = layoutGroup(
    nodes.map((node, index) => ({ node, index })),
    project.edges,
    startX,
    startY,
    columnGap,
    rowGap,
  );
  const segmentIds = new Set(nodes.flatMap((node) => nodeSegmentIds(node)));

  const movedCount = nodes.filter((node) => {
    const previous = oldPositions.get(node.id);
    return previous?.x !== node.x || previous?.y !== node.y;
  }).length;
  return {
    movedCount,
    nodeIds: nodes.map((node) => node.id),
    laneCount: Math.max(1, segmentIds.size),
    bounds: {
      x: startX,
      y: startY,
      width: Math.round(plan.width),
      height: Math.max(0, Math.round(plan.height)),
    },
  };
}
