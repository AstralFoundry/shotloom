import assert from 'node:assert/strict';
import test from 'node:test';
import { readLocalizedSource as readSource } from './helpers/sourceContract.mjs';
import { assetLibraryKey, assetMediaKind, assetMatchesSearch } from '../renderer/src/domain/asset/AssetLibraryCatalog.ts';

test('collections keep distinct identities when assets share one material', () => {
  assert.notEqual(assetLibraryKey({ id: 'material', assetId: 'character' }), assetLibraryKey({ id: 'material', assetId: 'scene' }));
  assert.equal(assetLibraryKey({ path: '/assets/shot.png' }), '/assets/shot.png');
});
test('media filters use metadata and extensions', () => {
  assert.equal(assetMediaKind({ mimeType: 'video/mp4' }), 'video');
  assert.equal(assetMediaKind({ name: 'SHOT.WEBP' }), 'image');
  assert.equal(assetMediaKind({ resourceType: 'audio' }), 'audio');
  assert.equal(assetMediaKind({ name: 'script.md' }), 'text');
  assert.equal(assetMediaKind({ name: 'scene.glb' }), 'file');
});
test('search matches names, notes and tags without modifying the catalog', () => {
  const item = { name: 'Forest Shot', tags: ['Dawn', '树林'], note: 'Morning light' };
  for (const query of [' dawn ', '树林', 'FOREST', 'light']) assert.ok(assetMatchesSearch(item, query));
  assert.equal(assetMatchesSearch(item, 'night'), false);
  assert.deepEqual(item.tags, ['Dawn', '树林']);
});
test('canvas and management page share a standard modal asset browser', () => {
  const creation = readSource('renderer/src/app/views/CreationView.tsx');
  const assets = readSource('renderer/src/app/views/AssetsView.tsx');
  const browser = readSource('renderer/src/app/components/AssetLibraryBrowser.tsx');
  assert.match(creation, /<AssetLibraryModal/);
  assert.match(assets, /<AssetLibraryBrowser/);
  assert.match(browser, /<Modal[\s\S]*?destroyOnHidden/);
  assert.match(browser, /subscribeDomain/);
  assert.match(browser, /<SearchInput/);
  assert.match(browser, /<Pagination/);
  assert.match(browser, /await onInsert\(item, source\)/);
  assert.doesNotMatch(creation, /assetDrawerHeight|startAssetDrawerResize|closeOnOutsidePointer/);
});
