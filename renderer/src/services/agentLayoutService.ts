import { graphlib, layout as dagreLayout } from '@dagrejs/dagre';
import type { AgentNode, AgentProject } from './agentTypes';
import { canvasNodeDimensions } from '../domain/graph/CanvasNodeDimensions.ts';

export { canvasNodeDimensions, defaultCanvasNodeDimensions } from '../domain/graph/CanvasNodeDimensions.ts';

export type AgentLayoutScope = 'selection' | 'workflow' | 'all';
export type AgentLayoutMode = 'workflow' | 'horizontal' | 'vertical' | 'grid';

export interface AgentLayoutOptions {
  x?: number;
  y?: number;
  gapX?: number;
  gapY?: number;
  scope?: AgentLayoutScope;
  mode?: AgentLayoutMode;
  includeConnected?: boolean;
  avoidCollisions?: boolean;
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
  'threeDDirector',
]);

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

function stableItemSort(a: LayoutItem, b: LayoutItem): number {
  return a.index - b.index;
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

function connectedNodeIds(project: AgentProject, seedIds: Set<string>): Set<string> {
  const visibleIds = new Set((project.nodes || [])
    .filter((node) => SUPPORTED_NODE_TYPES.has(node.type) && !node.archived)
    .map((node) => node.id));
  const adjacency = new Map<string, string[]>();
  for (const edge of project.edges || []) {
    if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target)) continue;
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, []);
    adjacency.get(edge.source)?.push(edge.target);
    adjacency.get(edge.target)?.push(edge.source);
  }
  const result = new Set([...seedIds].filter((id) => visibleIds.has(id)));
  const queue = [...result];
  while (queue.length) {
    const id = queue.shift() as string;
    for (const neighbor of adjacency.get(id) || []) {
      if (result.has(neighbor)) continue;
      result.add(neighbor);
      queue.push(neighbor);
    }
  }
  return result;
}

function flatRects(
  items: LayoutItem[],
  columnGap: number,
  rowGap: number,
  mode: Exclude<AgentLayoutMode, 'workflow'>,
): LayoutRects {
  const rects: LayoutRects = new Map();
  const ordered = [...items].sort(stableItemSort);
  const sizeOf = (item: LayoutItem) => canvasNodeDimensions(item.node);
  if (mode === 'horizontal') {
    let x = 0;
    for (const item of ordered) {
      const size = sizeOf(item);
      rects.set(item.node.id, { x, y: 0, ...size });
      x += size.width + columnGap;
    }
    return rects;
  }
  if (mode === 'vertical') {
    let y = 0;
    for (const item of ordered) {
      const size = sizeOf(item);
      rects.set(item.node.id, { x: 0, y, ...size });
      y += size.height + rowGap;
    }
    return rects;
  }
  const columns = Math.max(1, Math.ceil(Math.sqrt(ordered.length)));
  const columnWidths = Array.from({ length: columns }, () => 0);
  const rows = Math.ceil(ordered.length / columns);
  const rowHeights = Array.from({ length: rows }, () => 0);
  ordered.forEach((item, index) => {
    const size = sizeOf(item);
    columnWidths[index % columns] = Math.max(columnWidths[index % columns] ?? 0, size.width);
    rowHeights[Math.floor(index / columns)] = Math.max(
      rowHeights[Math.floor(index / columns)] ?? 0,
      size.height,
    );
  });
  const columnX = [0];
  const rowY = [0];
  for (let index = 1; index < columns; index += 1) {
    columnX[index] = (columnX[index - 1] ?? 0) + (columnWidths[index - 1] ?? 0) + columnGap;
  }
  for (let index = 1; index < rows; index += 1) {
    rowY[index] = (rowY[index - 1] ?? 0) + (rowHeights[index - 1] ?? 0) + rowGap;
  }
  ordered.forEach((item, index) => {
    rects.set(item.node.id, {
      x: columnX[index % columns] ?? 0,
      y: rowY[Math.floor(index / columns)] ?? 0,
      ...sizeOf(item),
    });
  });
  return rects;
}

function applyRects(items: LayoutItem[], rects: LayoutRects, originX: number, originY: number): void {
  for (const item of items) {
    const rect = rects.get(item.node.id);
    if (!rect) continue;
    item.node.x = Math.round(rect.x + originX);
    item.node.y = Math.round(rect.y + originY);
  }
}

function rectsBounds(rects: LayoutRects): { width: number; height: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  rects.forEach((rect) => {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  });
  if (!Number.isFinite(minX)) return { width: 0, height: 0 };
  return { width: maxX - minX, height: maxY - minY };
}

function translateRects(rects: LayoutRects, dx: number, dy: number): void {
  rects.forEach((rect) => {
    rect.x += dx;
    rect.y += dy;
  });
}

type LayoutRect = { x: number; y: number; width: number; height: number };
type LayoutRects = Map<string, LayoutRect>;

function nodeRect(node: AgentNode): LayoutRect {
  const size = canvasNodeDimensions(node);
  return { x: Number(node.x) || 0, y: Number(node.y) || 0, ...size };
}
function rectsOverlap(left: LayoutRect, right: LayoutRect, margin = 24): boolean {
  return left.x < right.x + right.width + margin &&
    right.x < left.x + left.width + margin &&
    left.y < right.y + right.height + margin &&
    right.y < left.y + left.height + margin;
}
function layoutBounds(nodes: AgentNode[]): LayoutRect {
  const rects = nodes.map(nodeRect);
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
function shiftAwayFromObstacles(nodes: AgentNode[], obstacles: AgentNode[], margin = 24) {
  if (!nodes.length || !obstacles.length) return { dx: 0, dy: 0 };
  const baseBounds = layoutBounds(nodes);
  const obstacleRects = obstacles.map(nodeRect);
  const collides = (dx: number, dy: number) => nodes.some((node) => {
    const rect = nodeRect(node);
    const shifted = { ...rect, x: rect.x + dx, y: rect.y + dy };
    return obstacleRects.some((obstacle) => rectsOverlap(shifted, obstacle, margin));
  });
  if (!collides(0, 0)) return { dx: 0, dy: 0 };
  const candidates = obstacleRects.flatMap((obstacle) => [
    { dx: obstacle.x + obstacle.width + margin - baseBounds.x, dy: 0 },
    { dx: obstacle.x - margin - baseBounds.width - baseBounds.x, dy: 0 },
    { dx: 0, dy: obstacle.y + obstacle.height + margin - baseBounds.y },
    { dx: 0, dy: obstacle.y - margin - baseBounds.height - baseBounds.y },
  ]).sort((left, right) =>
    Math.abs(left.dx) + Math.abs(left.dy) - Math.abs(right.dx) - Math.abs(right.dy)
  );
  const free = candidates.find((candidate) => !collides(candidate.dx, candidate.dy));
  if (!free) return { dx: 0, dy: 0 };
  for (const node of nodes) {
    node.x = Math.round((Number(node.x) || 0) + free.dx);
    node.y = Math.round((Number(node.y) || 0) + free.dy);
  }
  return free;
}

interface LayoutAdjacency {
  parents: Map<string, string[]>;
  children: Map<string, string[]>;
}

const MAX_ITEMS_PER_RANK = 5;
const RANK_ALIGN_TOLERANCE = 2;

function buildAdjacency(ids: Set<string>, edges: AgentProject['edges']): LayoutAdjacency {
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  ids.forEach((id) => {
    parents.set(id, []);
    children.set(id, []);
  });
  const seen = new Set<string>();
  for (const edge of edges || []) {
    if (edge.source === edge.target) continue;
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    const key = `${edge.source}\u0000${edge.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    children.get(edge.source)?.push(edge.target);
    parents.get(edge.target)?.push(edge.source);
  }
  return { parents, children };
}

function splitComponents(items: LayoutItem[], adjacency: LayoutAdjacency): LayoutItem[][] {
  const byId = new Map(items.map((item) => [item.node.id, item]));
  const visited = new Set<string>();
  const groups: LayoutItem[][] = [];
  for (const item of [...items].sort(stableItemSort)) {
    if (visited.has(item.node.id)) continue;
    visited.add(item.node.id);
    const queue = [item.node.id];
    const group: LayoutItem[] = [];
    while (queue.length) {
      const id = queue.shift() as string;
      const member = byId.get(id);
      if (member) group.push(member);
      for (const neighbor of [...(adjacency.children.get(id) || []), ...(adjacency.parents.get(id) || [])]) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    groups.push(group.sort(stableItemSort));
  }
  return groups;
}

// 拓扑深度只用于给互不相连的工作流排序（深的先铺），不参与任何语义判断。
function componentDepth(component: LayoutItem[], adjacency: LayoutAdjacency): number {
  const ids = new Set(component.map((item) => item.node.id));
  const depths = new Map<string, number>();
  const depthFor = (id: string, visiting: Set<string>): number => {
    const known = depths.get(id);
    if (known != null) return known;
    if (visiting.has(id)) return 0;
    const nextVisiting = new Set(visiting).add(id);
    const parentDepths = (adjacency.parents.get(id) || [])
      .filter((parentId) => ids.has(parentId))
      .map((parentId) => depthFor(parentId, nextVisiting));
    const depth = parentDepths.length ? Math.max(...parentDepths) + 1 : 0;
    depths.set(id, depth);
    return depth;
  };
  return Math.max(0, ...component.map((item) => depthFor(item.node.id, new Set())));
}

function dagreRects(
  component: LayoutItem[],
  adjacency: LayoutAdjacency,
  columnGap: number,
  rowGap: number,
): LayoutRects {
  const graph = new graphlib.Graph({ directed: true, multigraph: false });
  graph.setGraph({
    rankdir: 'LR',
    nodesep: rowGap,
    ranksep: columnGap,
    ranker: 'network-simplex',
    marginx: 0,
    marginy: 0,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const item of [...component].sort(stableItemSort)) {
    const size = canvasNodeDimensions(item.node);
    graph.setNode(item.node.id, { width: size.width, height: size.height });
  }
  for (const item of component) {
    for (const child of adjacency.children.get(item.node.id) || []) {
      graph.setEdge(item.node.id, child);
    }
  }
  dagreLayout(graph);
  const rects: LayoutRects = new Map();
  for (const item of component) {
    const placed = graph.node(item.node.id) as { x?: number; y?: number } | undefined;
    const size = canvasNodeDimensions(item.node);
    rects.set(item.node.id, {
      x: (placed?.x ?? 0) - size.width / 2,
      y: (placed?.y ?? 0) - size.height / 2,
      ...size,
    });
  }
  return rects;
}

interface RankEntry {
  id: string;
  rect: LayoutRect;
  lead: number;
  center: number;
}

// 同一依赖层的判据是层轴（LR 下即 x）对齐，而不是 dagre 的内部 rank 编号。
function rankClusters(rects: LayoutRects): RankEntry[][] {
  const entries: RankEntry[] = [...rects.entries()].map(([id, rect]) => ({
    id,
    rect,
    lead: rect.x,
    center: rect.x + rect.width / 2,
  }));
  const parent = entries.map((_entry, index) => index);
  const find = (index: number): number => {
    let cursor = index;
    while (parent[cursor] !== cursor) cursor = parent[cursor] as number;
    return cursor;
  };
  const union = (left: number, right: number) => {
    const rootLeft = find(left);
    const rootRight = find(right);
    if (rootLeft === rootRight) return;
    parent[Math.max(rootLeft, rootRight)] = Math.min(rootLeft, rootRight);
  };
  entries.forEach((left, index) => {
    for (let other = index + 1; other < entries.length; other += 1) {
      const right = entries[other];
      if (!right) continue;
      if (
        Math.abs(left.lead - right.lead) <= RANK_ALIGN_TOLERANCE ||
        Math.abs(left.center - right.center) <= RANK_ALIGN_TOLERANCE
      ) union(index, other);
    }
  });
  const groups = new Map<number, RankEntry[]>();
  entries.forEach((entry, index) => {
    const root = find(index);
    const bucket = groups.get(root);
    if (bucket) bucket.push(entry);
    else groups.set(root, [entry]);
  });
  return [...groups.values()].sort((left, right) =>
    Math.min(...left.map((entry) => entry.lead)) - Math.min(...right.map((entry) => entry.lead)));
}

// dagre 的 priority 定位在混合高度下会给出忽大忽小的层内间距，这里按固定 rowGap 重排并保留层中心。
// keyOf 缺省时沿用当前纵向顺序；提供时按重心排序，无参照的节点由 fallback 决定落点。
function stackRankClusters(
  clusters: RankEntry[][],
  rects: LayoutRects,
  rowGap: number,
  keyOf: ((entry: RankEntry) => number | null) | null,
  fallbackByIndex: boolean,
  indexById: Map<string, number>,
): void {
  for (const cluster of clusters) {
    if (cluster.length < 2) continue;
    const centerOf = (entry: RankEntry) => entry.rect.y + entry.rect.height / 2;
    const ordered = [...cluster].sort((left, right) => {
      const leftKey = keyOf ? keyOf(left) : null;
      const rightKey = keyOf ? keyOf(right) : null;
      if (leftKey != null && rightKey != null) {
        return leftKey - rightKey || (fallbackByIndex
          ? (indexById.get(left.id) ?? 0) - (indexById.get(right.id) ?? 0)
          : centerOf(left) - centerOf(right));
      }
      if (leftKey == null && rightKey == null) {
        return fallbackByIndex
          ? (indexById.get(left.id) ?? 0) - (indexById.get(right.id) ?? 0)
          : centerOf(left) - centerOf(right);
      }
      return leftKey == null ? -1 : 1;
    });
    const center = ordered.reduce((sum, entry) => sum + centerOf(entry), 0) / ordered.length;
    const span = ordered.reduce((sum, entry) => sum + entry.rect.height, 0) + rowGap * (ordered.length - 1);
    let cursor = center - span / 2;
    for (const entry of ordered) {
      const rect = rects.get(entry.id);
      if (rect) rect.y = cursor;
      cursor += entry.rect.height + rowGap;
    }
  }
}

// dagre 只保证拓扑分层，层内顺序会随边插入顺序整体翻转；这里用重心扫一遍，
// 首列没有上游时退回创建顺序，保证同样的图每次整理结果一致。
function orderRanksByBarycenter(
  rects: LayoutRects,
  adjacency: LayoutAdjacency,
  rowGap: number,
  indexById: Map<string, number>,
): void {
  for (let pass = 0; pass < 4; pass += 1) {
    const downward = pass % 2 === 0;
    const clusters = rankClusters(rects);
    if (!downward) clusters.reverse();
    const neighborKey = (entry: RankEntry): number | null => {
      const neighbors = (downward ? adjacency.parents : adjacency.children).get(entry.id) || [];
      const centers = neighbors
        .map((id) => rects.get(id))
        .filter((rect): rect is LayoutRect => Boolean(rect))
        .map((rect) => rect.y + rect.height / 2);
      if (!centers.length) return null;
      return centers.reduce((sum, center) => sum + center, 0) / centers.length;
    };
    stackRankClusters(clusters, rects, rowGap, neighborKey, downward, indexById);
  }
}

// 一层里节点过多会拖出巨高列：折成每列 MAX_ITEMS_PER_RANK 的小网格，并把后续层整体右移避让。
function wrapOverfilledRanks(
  rects: LayoutRects,
  columnGap: number,
  rowGap: number,
): void {
  let cumulativeShift = 0;
  for (const cluster of rankClusters(rects)) {
    if (cumulativeShift !== 0) {
      for (const entry of cluster) {
        const rect = rects.get(entry.id);
        if (rect) rect.x += cumulativeShift;
      }
    }
    if (cluster.length <= MAX_ITEMS_PER_RANK) continue;
    const ordered = [...cluster].sort((left, right) =>
      left.rect.y - right.rect.y || left.rect.x - right.rect.x);
    const colLeft = Math.min(...ordered.map((entry) => entry.rect.x));
    const oldRight = Math.max(...ordered.map((entry) => entry.rect.x + entry.rect.width));
    const cellWidth = Math.max(...ordered.map((entry) => entry.rect.width));
    const cellHeight = Math.max(...ordered.map((entry) => entry.rect.height));
    const rows = Math.min(ordered.length, MAX_ITEMS_PER_RANK);
    const columns = Math.ceil(ordered.length / MAX_ITEMS_PER_RANK);
    const blockHeight = rows * cellHeight + (rows - 1) * rowGap;
    const center = ordered.reduce((sum, entry) => sum + entry.rect.y + entry.rect.height / 2, 0) / ordered.length;
    const top = center - blockHeight / 2;
    ordered.forEach((entry, slot) => {
      const rect = rects.get(entry.id);
      if (!rect) return;
      rect.x = colLeft + Math.floor(slot / MAX_ITEMS_PER_RANK) * (cellWidth + columnGap);
      rect.y = top + (slot % MAX_ITEMS_PER_RANK) * (cellHeight + rowGap) + (cellHeight - rect.height) / 2;
    });
    const newRight = colLeft + columns * cellWidth + (columns - 1) * columnGap;
    cumulativeShift += Math.max(0, newRight - oldRight);
  }
}

function rectExtents(rects: LayoutRects): { minX: number; minY: number } {
  let minX = 0;
  let minY = 0;
  let first = true;
  rects.forEach((rect) => {
    if (first) {
      minX = rect.x;
      minY = rect.y;
      first = false;
      return;
    }
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
  });
  return { minX, minY };
}

function layoutWorkflowRects(
  items: LayoutItem[],
  edges: AgentProject['edges'],
  columnGap: number,
  rowGap: number,
): LayoutRects {
  const ids = new Set(items.map((item) => item.node.id));
  const adjacency = buildAdjacency(ids, edges);
  const rects: LayoutRects = new Map();
  const workflows: { rects: LayoutRects; depth: number; count: number; index: number }[] = [];
  const discrete: LayoutItem[] = [];

  for (const component of splitComponents(items, adjacency)) {
    const connected = component.some((item) =>
      (adjacency.children.get(item.node.id)?.length || 0) + (adjacency.parents.get(item.node.id)?.length || 0) > 0);
    if (!connected) {
      discrete.push(...component);
      continue;
    }
    const componentRects = dagreRects(component, adjacency, columnGap, rowGap);
    orderRanksByBarycenter(
      componentRects,
      adjacency,
      rowGap,
      new Map(component.map((item) => [item.node.id, item.index])),
    );
    wrapOverfilledRanks(componentRects, columnGap, rowGap);
    const origin = rectExtents(componentRects);
    translateRects(componentRects, -origin.minX, -origin.minY);
    workflows.push({
      rects: componentRects,
      depth: componentDepth(component, adjacency),
      count: component.length,
      index: Math.min(...component.map((item) => item.index)),
    });
  }

  // 深链路先铺、同深度按规模，剩下无连线的散素材统一铺在末尾。
  workflows.sort((left, right) => right.depth - left.depth || right.count - left.count || left.index - right.index);
  let cursorY = 0;
  for (const workflow of workflows) {
    translateRects(workflow.rects, 0, cursorY);
    workflow.rects.forEach((rect, id) => rects.set(id, rect));
    cursorY += rectsBounds(workflow.rects).height + rowGap;
  }
  if (discrete.length) {
    const discreteRects = flatRects(discrete, columnGap, rowGap, 'grid');
    translateRects(discreteRects, 0, cursorY);
    discreteRects.forEach((rect, id) => rects.set(id, rect));
  }
  // 中心取整后同层对齐的节点才不会因为各自取整左上角而错开半行。
  rects.forEach((rect) => {
    rect.x = Math.round(rect.x + rect.width / 2) - rect.width / 2;
    rect.y = Math.round(rect.y + rect.height / 2) - rect.height / 2;
  });
  return rects;
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
  const resolvedIds = scope === 'selection' && options.includeConnected
    ? connectedNodeIds(project, requestedIds)
    : requestedIds;
  const nodes = selectLayoutNodes(project, resolvedIds, scope);
  if (!nodes.length) return { movedCount: 0, nodeIds: [], laneCount: 0, bounds: null };

  const oldPositions = new Map(nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
  const previousBounds = layoutBounds(nodes);
  const columnGap = Number.isFinite(Number(options.gapX)) ? Math.max(32, Number(options.gapX)) : 160;
  const rowGap = Number.isFinite(Number(options.gapY)) ? Math.max(20, Number(options.gapY)) : 120;
  const items = nodes.map((node, index) => ({ node, index }));
  const mode = options.mode || 'workflow';
  const rects = mode === 'workflow'
    ? layoutWorkflowRects(items, project.edges, columnGap, rowGap)
    : flatRects(items, columnGap, rowGap, mode);
  const plan = rectsBounds(rects);
  // 显式坐标按左上角锚定；整画布从默认原点铺开；选区和工作流回到原质心，
  // 免得某个飘在角落的节点把整块结果拖到画布边上。
  const anchorX = Math.round(Number.isFinite(Number(options.x))
    ? Number(options.x)
    : scope === 'all' ? 120 : previousBounds.x + previousBounds.width / 2 - plan.width / 2);
  const anchorY = Math.round(Number.isFinite(Number(options.y))
    ? Number(options.y)
    : scope === 'all' ? 90 : previousBounds.y + previousBounds.height / 2 - plan.height / 2);
  applyRects(items, rects, anchorX, anchorY);
  const nodeIdSet = new Set(nodes.map((node) => node.id));
  if (options.avoidCollisions !== false && scope !== 'all') {
    shiftAwayFromObstacles(
      nodes,
      (project.nodes || []).filter((node) =>
        SUPPORTED_NODE_TYPES.has(node.type) && !node.archived && !nodeIdSet.has(node.id)
      ),
    );
  }
  const segmentIds = new Set(nodes.flatMap((node) => nodeSegmentIds(node)));

  const movedCount = nodes.filter((node) => {
    const previous = oldPositions.get(node.id);
    return previous?.x !== node.x || previous?.y !== node.y;
  }).length;
  return {
    movedCount,
    nodeIds: nodes.map((node) => node.id),
    laneCount: Math.max(1, segmentIds.size),
    bounds: { ...layoutBounds(nodes), width: Math.round(plan.width), height: Math.round(plan.height) },
  };
}

export function placeAgentNodesIncrementally(
  project: AgentProject,
  nodeIds: string[],
  options: Pick<AgentLayoutOptions, 'gapX' | 'gapY'> = {},
): AgentLayoutResult {
  const wanted = new Set(nodeIds);
  const nodes = (project.nodes || []).filter((node) =>
    wanted.has(node.id) && SUPPORTED_NODE_TYPES.has(node.type) && !node.archived
  );
  if (!nodes.length) return { movedCount: 0, nodeIds: [], laneCount: 0, bounds: null };
  const oldPositions = new Map(nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
  const byId = new Map((project.nodes || []).map((node) => [node.id, node]));
  const gapX = Math.max(32, Number(options.gapX) || 120);
  const gapY = Math.max(20, Number(options.gapY) || 24);
  const placedIds = new Set((project.nodes || []).filter((node) => !wanted.has(node.id)).map((node) => node.id));
  const occupied = (project.nodes || []).filter((node) =>
    placedIds.has(node.id) && SUPPORTED_NODE_TYPES.has(node.type) && !node.archived
  );
  for (const node of nodes) {
    const parents = (project.edges || [])
      .filter((edge) => edge.target === node.id)
      .map((edge) => byId.get(edge.source))
      .filter((parent): parent is AgentNode => Boolean(parent));
    if (parents.length) {
      const rightmost = parents.reduce((best, parent) =>
        (Number(parent.x) || 0) + canvasNodeDimensions(parent).width >
          (Number(best.x) || 0) + canvasNodeDimensions(best).width ? parent : best
      );
      node.x = Math.round((Number(rightmost.x) || 0) + canvasNodeDimensions(rightmost).width + gapX);
      const center = parents.reduce((sum, parent) =>
        sum + (Number(parent.y) || 0) + canvasNodeDimensions(parent).height / 2, 0) / parents.length;
      node.y = Math.round(center - canvasNodeDimensions(node).height / 2);
    }
    shiftAwayFromObstacles([node], occupied, gapY);
    occupied.push(node);
  }
  const movedCount = nodes.filter((node) => {
    const previous = oldPositions.get(node.id);
    return previous?.x !== node.x || previous?.y !== node.y;
  }).length;
  return {
    movedCount,
    nodeIds: nodes.map((node) => node.id),
    laneCount: 1,
    bounds: layoutBounds(nodes),
  };
}
