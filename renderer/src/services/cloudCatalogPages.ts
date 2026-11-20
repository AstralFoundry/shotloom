import { cloudRequest } from './cloudRequest';
import { legacyCatalogPage, type CatalogPage } from '../../../shared/catalogPages';

type RecordValue = Record<string, any>;
const unsupported = (error: unknown) => [404, 405].includes((error as { status: number }).status);

export async function readCatalogPage<T extends RecordValue>(kind: string, query: string, force = false): Promise<CatalogPage<T>> {
  try { return await cloudRequest<CatalogPage<T>>(`/catalog/${kind}/page?${query}`, 'GET', undefined, {cacheMs: 5000, force}); }
  catch (error) {
    if (!unsupported(error)) throw error;
    const params = new URLSearchParams(query);
    return legacyCatalogPage<T>(await cloudRequest<RecordValue>(`/catalog/${kind}`), kind, params);
  }
}

export async function readCatalogItem<T>(kind: string, id: string): Promise<T> {
  try { return await cloudRequest<T>(`/catalog/${kind}/item/${encodeURIComponent(id)}`); }
  catch (error) {
    if (!unsupported(error) || (error as {code?:string}).code === 'NOT_FOUND') throw error;
    // An item 404 may mean missing data; a legacy read distinguishes it from an old server.
    const catalog = await cloudRequest<RecordValue>(`/catalog/${kind}`);
    const item = catalog[kind]?.find((value: RecordValue) => value.id === id);
    if (!item) throw error;
    return item;
  }
}

export async function patchCatalogItems(kind: string, revision: number | undefined, upsert: RecordValue[], remove: string[]) {
  if (revision !== undefined) try {
    return await cloudRequest<{revision:number}>(`/catalog/${kind}`, 'PATCH', {
      expectedRevision: revision, changes: { [kind]: { upsert, remove } }, metadata: {},
    });
  } catch (error) {
    if (!unsupported(error)) throw error;
  }
  const catalog = await cloudRequest<RecordValue>(`/catalog/${kind}`);
  const replaced = new Set([...remove, ...upsert.map(item => item.id)]);
  await cloudRequest(`/catalog/${kind}`, 'PUT', { ...catalog, [kind]: [...(catalog[kind] || []).filter((item: RecordValue) => !replaced.has(item.id)), ...upsert] });
  return {revision};
}
