import { cloudRequest, cloudUserHeaders } from './cloudRequest';
import { readCanvasStartup } from './cloudCanvasStartup';
import { catalogChanges } from '../../../shared/catalogChanges';
type Catalog = Record<string, unknown>;
export function createCloudCatalogs() {
  const snapshots = new Map<string, { catalog: Catalog; revision: number | undefined }>();
  const key = (kind: string) => JSON.stringify([cloudUserHeaders(), kind]);
  const remember = (kind: string, catalog: Catalog, revision?: number) => {
    snapshots.set(key(kind), { catalog: structuredClone(catalog), revision });
    return { ...catalog, ...(revision !== undefined ? { __catalogRevision: revision } : {}) };
  };
  const read = async (kind: string): Promise<Catalog> => {
    if (kind === 'assets') {
      try {
        const catalog = await readCanvasStartup<Catalog>('assets', '/catalog/assets/versioned');
        if ('catalog' in catalog) return remember(kind, catalog.catalog as Catalog, catalog.revision as number);
        return remember(kind, catalog, catalog.__catalogRevision as number | undefined);
      } catch (error) {
        if (![404,405].includes((error as {status:number}).status)) throw error;
        return remember(kind, await cloudRequest<Catalog>('/catalog/assets'));
      }
    }
    try {
      const value = await cloudRequest<{ catalog: Catalog; revision: number }>(`/catalog/${kind}/versioned`);
      if (!value.catalog || !Number.isSafeInteger(value.revision)) throw new Error('Invalid versioned catalog response');
      return remember(kind, value.catalog, value.revision);
    } catch (error) {
      if (![404,405].includes((error as {status:number}).status)) throw error;
      return remember(kind, await cloudRequest<Catalog>(`/catalog/${kind}`));
    }
  };
  const save = async (kind: string, catalog: Catalog): Promise<Catalog> => {
    if (catalog.projection) throw new Error('List projections cannot replace a catalog');
    if (!snapshots.has(key(kind))) await read(kind);
    const previous = snapshots.get(key(kind))!;
    if (previous.revision !== undefined) {
      if (catalog.__catalogRevision !== previous.revision) {
        throw Object.assign(new Error('Catalog changed; reload before saving'), { status: 409 });
      }
      try {
        const value = await cloudRequest<{revision:number}>(`/catalog/${kind}`, 'PATCH', { expectedRevision: previous.revision, ...catalogChanges(kind, previous.catalog, catalog) });
        return remember(kind, catalog, value.revision);
      } catch (error) { if (![404,405].includes((error as {status:number}).status)) throw error; }
    }
    const { __catalogRevision, ...legacyCatalog } = catalog;
    await cloudRequest(`/catalog/${kind}`, 'PUT', legacyCatalog);
    return remember(kind, catalog);
  };
  return { read, save };
}
