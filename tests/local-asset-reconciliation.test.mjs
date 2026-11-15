import assert from 'node:assert/strict';
import test from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

test('opening a project only writes changed library references and preserves existing reference identity', async () => {
  const env = await createRendererEnv({ storage: new Map(), withWindow: true });
  try {
    const { desktopApi } = await env.load('services/desktopApi');
    const { store } = await env.load('store/projectStore');
    const { reconcileCurrentProjectLocalAssetReferences } = await env.load('store/localAssetLibraryStore');
    const catalog = { assets: [{ id: 'asset', materialId: 'library-material' }], materials: [], references: [] };
    let writes = 0;
    desktopApi.localAssets.getCatalog = async () => structuredClone(catalog);
    desktopApi.localAssets.setCatalog = async value => { writes++; Object.assign(catalog, structuredClone(value)); return value; };
    store.project = { id: 'project', name: 'Project', materials: [] };
    await reconcileCurrentProjectLocalAssetReferences();
    assert.equal(writes, 0, 'an empty project must not write the global catalog');

    store.project.materials = [{ id: 'material', storageScope: 'library', localLibraryMaterialId: 'library-material' }];
    await reconcileCurrentProjectLocalAssetReferences();
    assert.equal(writes, 1);
    const reference = structuredClone(catalog.references[0]);
    await reconcileCurrentProjectLocalAssetReferences();
    assert.equal(writes, 1, 'unchanged references must not be rewritten on every open');
    assert.deepEqual(catalog.references[0], reference);

    store.project.name = 'Renamed';
    await reconcileCurrentProjectLocalAssetReferences();
    assert.equal(writes, 2);
    assert.equal(catalog.references[0].projectName, 'Renamed');
    assert.equal(catalog.references[0].id, reference.id);
    catalog.references.push({ id: 'other', projectKey: 'other-project', materialId: 'other' });
    store.project.materials = [];
    await reconcileCurrentProjectLocalAssetReferences();
    assert.equal(writes, 3);
    assert.deepEqual(catalog.references, [{ id: 'other', projectKey: 'other-project', materialId: 'other' }]);
  } finally { await env.dispose(); }
});
