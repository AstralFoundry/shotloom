export type CatalogPage<T> = { items: T[]; total: number; offset: number; limit: number; revision?: number; projection: boolean; systemSkillIds?: string[] };
export function legacyCatalogPage<T extends Record<string, any>>(catalog: Record<string, any>, kind: string, query: URLSearchParams): CatalogPage<T> {
  const search = (query.get('search') || '').toLocaleLowerCase(), offset = Number(query.get('offset') || 0), limit = Number(query.get('limit') || 20);
  const categories = query.getAll('category');
  const materials = new Map((catalog.materials || []).map((item:Record<string,any>) => [item.id,item]));
  const usages = new Map<string,number>();
  if (kind === 'assets') for (const reference of catalog.references || []) usages.set(reference.assetId,(usages.get(reference.assetId)||0)+1);
  const records = (catalog[kind] as T[] || []).map(item => kind === 'assets' ? { ...(materials.get(item.materialId) as object || {}), ...item, usageCount:usages.get(item.id)||0 } as T : item);
  const items = records.filter(item => !item.builtIn && !catalog.systemSkillIds?.includes(item.id) && (!categories.length || !item.category || categories.includes(item.category)) && [item.id,item.name,item.description,item.category,item.note,...(Array.isArray(item.tags) ? item.tags : [])].join(' ').toLocaleLowerCase().includes(search))
    .sort((a,b) => String(a.name || '').localeCompare(String(b.name || '')) || String(a.id).localeCompare(String(b.id)));
  return { items:items.slice(offset,offset+limit),total:items.length,offset,limit,projection:false,...(catalog.systemSkillIds ? {systemSkillIds:catalog.systemSkillIds} : {}) };
}
