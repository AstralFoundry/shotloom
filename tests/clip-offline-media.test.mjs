import test from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';
const env = await createRendererEnv();
test.after(() => env.dispose());
const { offlineEditorMedia, restoredEditorAsset, withRestoredEditorAsset } = await env.load('app/editor/openReel/offlineMedia');

test('离线恢复复用资产身份与完整片段源范围，拒绝类型或时长不足的文件', () => {
  const native = {
    mediaLibrary: { items: [
      { id: 'media', shotloomAssetId: 'asset', type: 'video', name: 'missing.mp4', isPlaceholder: true },
      { id: 'online', type: 'image', isPlaceholder: false },
    ] },
    timeline: { tracks: [{ clips: [
      { id: 'first', mediaId: 'media', inPoint: 2, outPoint: 8, duration: 3, speed: 2 },
      { id: 'second', mediaId: 'media', inPoint: 8, outPoint: 15, duration: 7, effects: ['blur'] },
    ] }] },
  };
  const before = structuredClone(native);
  const [missing] = offlineEditorMedia(native);
  assert.equal(missing.requiredDuration, 15);
  const replacement = { id: 'new-file', type: 'video', name: 'restored.mp4', duration: 15, sourceUrl: '/project/restored.mp4' };
  assert.equal(restoredEditorAsset(missing, replacement).id, 'asset');
  for (const duration of [14, undefined, NaN, Infinity]) {
    assert.throws(() => restoredEditorAsset(missing, { ...replacement, duration }));
  }
  assert.throws(() => restoredEditorAsset(missing, { ...replacement, type: 'audio' }));
  assert.deepEqual(native, before);
});

test('更新恢复文件引用保留时间线、效果及其他资产，不新增重复资产', () => {
  const tracks = [{ id: 'track', clips: [{ id: 'clip', assetId: 'asset', effects: ['blur'] }] }];
  const original = { assets: [{ id: 'asset', sourceUrl: '/missing' }, { id: 'other', sourceUrl: '/other' }], tracks };
  const replacement = { id: 'asset', type: 'image', name: 'restored.png', sourceUrl: '/project/restored.png' };
  const result = withRestoredEditorAsset(original, replacement);
  assert.equal(result.tracks, tracks);
  assert.equal(result.assets.length, 2);
  assert.equal(result.assets.find(asset => asset.id === 'asset').sourceUrl, '/project/restored.png');
  assert.equal(original.assets[0].sourceUrl, '/missing');
  assert.equal(restoredEditorAsset({ id: 'media', assetId: 'asset', type: 'image', name: 'still', requiredDuration: 60 }, replacement).id, 'asset');
});
