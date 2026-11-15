import test from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

test('npm marketplace filters unrelated packages and advances by raw search page size', async () => {
  const env = await createRendererEnv();
  try {
    const { npmPluginListings, npmSearchUrl } = await env.load('services/npmPluginMarketplace');
    const result = npmPluginListings({ objects: [
      { package: { name: 'unrelated', version: '1.0.0' } },
      { package: { name: '@author/shotloom-plugin-images', version: '2.0.0', description: 'Images' } },
      { package: { name: 'shotloom-plugin-example', version: '1.0.0' } },
      { package: { name: 'shotloom-plugin-', version: '1.0.0' } },
    ], total: 12, offset: 4 });
    assert.deepEqual(result.packages.map(item => item.name), ['@author/shotloom-plugin-images', 'shotloom-plugin-example']);
    assert.equal(result.nextOffset, 8);
    assert.equal(result.hasMore, true);
    assert.throws(() => npmPluginListings({ error: 'unavailable' }), /Invalid npm/);
    const url = new URL(npmSearchUrl('images & video', 'npmmirror', 40));
    assert.equal(url.origin, 'https://registry.npmmirror.com');
    assert.equal(url.searchParams.get('text'), 'shotloom images & video');
    assert.equal(url.searchParams.get('from'), '40');
    assert.equal(new URL(npmSearchUrl('', 'npm', 0)).origin, 'https://registry.npmjs.org');
  } finally { await env.dispose(); }
});
