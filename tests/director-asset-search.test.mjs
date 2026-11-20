import assert from 'node:assert/strict';
import test from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

test('资产模糊搜索支持中英名称、漏字和英文分组，精确命中排前且保留分类交集', async () => {
  const env = await createRendererEnv();
  try {
    const { searchAssets } = await env.loadVendor('shotloom-director-desk/src/core/asset-catalog.ts');
    assert.ok(searchAssets('棕榈').some(asset => asset.id === 'plant-palm'));
    assert.ok(searchAssets('palm tree').some(asset => asset.id === 'plant-palm'));
    assert.ok(searchAssets('bulding').some(asset => asset.id.startsWith('building-')));
    assert.ok(searchAssets('plant-palm')[0].id === 'plant-palm');
    const plants = searchAssets('', 'plants');
    assert.ok(plants.length > 0);
    assert.ok(plants.every(asset => asset.group === '植物'));
    assert.deepEqual(searchAssets('house', '植物'), []);
    assert.deepEqual(searchAssets('不存在的资产xyz'), []);
  } finally { await env.dispose(); }
});
