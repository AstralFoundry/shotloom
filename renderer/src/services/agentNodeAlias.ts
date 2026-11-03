// 节点别名来自持久化的画布快照，节点形状按 AnyRecord 处理。
type AnyRecord = Record<string, any>;

/** Deterministic short alias: stable across inserts, deletes and layout changes. */
export function agentNodeStableAlias(node: AnyRecord | null | undefined): string {
  const slug = String(node?.id || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  return `N-${slug.slice(0, 10) || 'UNKNOWN'}`;
}

export function agentNodeAliasMaps(nodes: AnyRecord[] = []): { aliasMap: Record<string, string>; aliasById: Record<string, string> } {
  const aliasMap: Record<string, string> = {};
  const aliasById: Record<string, string> = {};
  const used = new Set<string>();
  nodes.forEach((node, index) => {
    let alias = agentNodeStableAlias(node);
    if (used.has(alias)) alias = `${alias}-${String(index + 1).padStart(2, '0')}`;
    used.add(alias);
    aliasMap[alias] = node.id;
    aliasById[node.id] = alias;
  });
  return { aliasMap, aliasById };
}
