import test from 'node:test';
import assert from 'node:assert/strict';
import { isPathInsideAssetRoot, joinAssetPath, projectAssetRoot } from '../renderer/src/utils/assetPaths.mjs';

test('shared project asset root overrides the canvas-local assets directory', () => {
  assert.equal(projectAssetRoot({ library: { assetRootDir: '/work/assets' } }, '/work/shot-1'), '/work/assets');
  assert.equal(projectAssetRoot({}, '/work/shot-1'), '/work/shot-1/assets');
});

test('asset path helpers handle Windows roots and path boundaries', () => {
  assert.equal(joinAssetPath('C:\\Work\\Assets', 'ab', 'file.png'), 'C:\\Work\\Assets\\ab\\file.png');
  assert.equal(isPathInsideAssetRoot('C:\\Work\\Assets\\a.png', 'c:\\work\\assets'), true);
  assert.equal(isPathInsideAssetRoot('/work/assets-old/a.png', '/work/assets'), false);
});
