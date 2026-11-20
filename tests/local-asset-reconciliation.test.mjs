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

test('catalog conflicts cannot delete media and delayed reference housekeeping cannot mutate a newly opened project',async()=>{
 const env=await createRendererEnv({storage:new Map(),withWindow:true});
 try{
  const {desktopApi}=await env.load('services/desktopApi');
  const {store}=await env.load('store/projectStore');
  const library=await env.load('store/localAssetLibraryStore');
  const catalog={assets:[{id:'asset',materialId:'m'}],materials:[{id:'m',path:'/retained.png'}],references:[]};
  desktopApi.localAssets.getCatalog=async()=>structuredClone(catalog);
  desktopApi.localAssets.setCatalog=async()=>{throw Object.assign(new Error('conflict'),{status:409});};
  let deleted=0;desktopApi.file.trash=async()=>{deleted++;};
  await assert.rejects(library.deleteLocalLibraryAsset('asset'),error=>error.status===409);assert.equal(deleted,0);
  let release;desktopApi.localAssets.getCatalog=()=>new Promise(resolve=>{release=resolve;});
  store.project={id:'old',materials:[]};const read=library.reconcileCurrentProjectLocalAssetReferences();
  store.project={id:'new',materials:[{id:'new-material',storageScope:'library',localLibraryMaterialId:'m'}]};
  release(structuredClone(catalog));await read;
  assert.deepEqual(library.localAssetLibrary.catalog.references,[]);
 }finally{await env.dispose();}
});
