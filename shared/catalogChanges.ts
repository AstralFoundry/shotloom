type Catalog = Record<string, unknown>;
type Entry = Record<string, unknown> & { id: string };
export function catalogChanges(kind: string, previous: Catalog, next: Catalog) {
  if (previous.projection || next.projection) throw new Error('List projections cannot replace a catalog');
  const collections = kind === 'assets' ? ['assets', 'materials'] : [kind];
  const changes: Record<string, { upsert: Entry[]; remove: string[] }> = {};
  const metadata = { ...next };
  delete metadata.__catalogRevision; delete metadata.systemSkillIds;
  for (const collection of collections) {
    if (!Array.isArray(next[collection])) throw new Error(`Missing full catalog collection: ${collection}`);
    const before = new Map((previous[collection] as Entry[] || []).map(item => [item.id, item]));
    const after = new Map((next[collection] as Entry[]).map(item => [item.id, item]));
    if (after.size !== (next[collection] as Entry[]).length || [...after.keys()].some(id => typeof id !== 'string' || !id)) throw new Error('Catalog requires unique stable IDs');
    changes[collection] = { upsert: [...after.values()].filter(item => JSON.stringify(item) !== JSON.stringify(before.get(item.id))), remove: [...before.keys()].filter(id => !after.has(id)) };
    delete metadata[collection];
  }
  return { changes, metadata };
}
