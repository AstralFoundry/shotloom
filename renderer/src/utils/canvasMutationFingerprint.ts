// 位置、尺寸、选择态与时间戳只影响画布呈现；Agent 的读写都按节点/连线 ID 与语义字段定位，
// 用户拖动或缩放节点不应让一次已完成的读取失效。
const NODE_LAYOUT_FIELDS = new Set([
  "x",
  "y",
  "canvasWidth",
  "canvasHeight",
  "width",
  "height",
  "position",
  "positionAbsolute",
  "measured",
  "dragging",
  "resizing",
  "selected",
  "zIndex",
  "updatedAt",
]);

const EDGE_LAYOUT_FIELDS = new Set(["selected", "animated", "updatedAt"]);

function withoutLayoutFields(item: unknown, fields: Set<string>) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  return Object.fromEntries(
    Object.entries(item as Record<string, unknown>).filter(([key]) => !fields.has(key)),
  );
}

/** 写围栏使用的画布指纹：只覆盖节点/连线的身份、内容与连接关系。 */
export function canvasMutationFingerprint(project: any = {}) {
  const source = JSON.stringify({
    nodes: (Array.isArray(project.nodes) ? project.nodes : [])
      .map((node: unknown) => withoutLayoutFields(node, NODE_LAYOUT_FIELDS)),
    edges: (Array.isArray(project.edges) ? project.edges : [])
      .map((edge: unknown) => withoutLayoutFields(edge, EDGE_LAYOUT_FIELDS)),
  });
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${source.length}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Agent 写入围栏：只锁定已读取节点是否被删除，以及已有连线是否发生变化。
 * 节点创建、节点内容更新和布局变化允许继续写入；这些操作不会让后续
 * create/update 依据失效。删除节点或修改连线仍要求重新读取，避免把边接到
 * 已不存在的节点，或基于过期拓扑覆盖用户刚改过的连接关系。
 */
export function canvasWriteFenceFingerprint(project: any = {}) {
  const nodeIds = (Array.isArray(project.nodes) ? project.nodes : [])
    .map((node: any) => String(node?.id || ''))
    .filter(Boolean)
    .sort();
  const edges = (Array.isArray(project.edges) ? project.edges : [])
    .map((edge: unknown) => JSON.stringify(withoutLayoutFields(edge, EDGE_LAYOUT_FIELDS)))
    .sort();
  return JSON.stringify({ nodeIds, edges });
}

export function canvasWriteFenceConflict(expected: string, project: any = {}) {
  if (!expected) return false;
  try {
    const before = JSON.parse(expected) as { nodeIds?: unknown; edges?: unknown };
    const current = JSON.parse(canvasWriteFenceFingerprint(project)) as { nodeIds?: unknown; edges?: unknown };
    const expectedNodes = new Set(Array.isArray(before.nodeIds) ? before.nodeIds.map(String) : []);
    const currentNodes = new Set(Array.isArray(current.nodeIds) ? current.nodeIds.map(String) : []);
    for (const nodeId of expectedNodes) {
      if (!currentNodes.has(nodeId)) return true;
    }
    return JSON.stringify(before.edges || []) !== JSON.stringify(current.edges || []);
  } catch {
    // Older runs stored the strict content fingerprint. Keep those runs safe.
    return expected !== canvasMutationFingerprint(project);
  }
}
