/** Deterministic short alias: stable across inserts, deletes and layout changes. */
export function agentNodeStableAlias(node) {
  const slug = String(node?.id || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  return `N-${slug.slice(0, 10) || 'UNKNOWN'}`;
}

export function agentNodeAliasMaps(nodes = []) {
  const aliasMap = {};
  const aliasById = {};
  const used = new Set();
  nodes.forEach((node, index) => {
    let alias = agentNodeStableAlias(node);
    if (used.has(alias)) alias = `${alias}-${String(index + 1).padStart(2, '0')}`;
    used.add(alias);
    aliasMap[alias] = node.id;
    aliasById[node.id] = alias;
  });
  return { aliasMap, aliasById };
}
