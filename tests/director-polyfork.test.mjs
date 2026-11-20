import assert from 'node:assert/strict';
import test from 'node:test';
import { unzipSync, strFromU8 } from '../vendor/shotloom-director-desk/node_modules/fflate/esm/index.mjs';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

test('online model search and download share the BFF, pack validated GLB bytes and retain credit in downloadable bundles', async () => {
  const env = await createRendererEnv();
  const original = globalThis.fetch;
  try {
    const api = await env.loadVendor('shotloom-director-desk/src/core/resources/polyfork.ts');
    api.configurePolyfork('https://shotloom.example/');
    const id = 'armchair-980c7c';
    const asset = { id, title: 'Armchair', free: true, credit: 'Armchair by Polyfork, CC BY 4.0', license: 'Mesh files: CC BY 4.0', source: `https://polyfork.dev/asset/${id}`, licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', download: { glb: `https://polyfork.dev/cdn/${id}.glb` } };
    const doc = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, scenes: [{ nodes: [] }], scene: 0 }).padEnd(100, ' '));
    const glb = Buffer.alloc(doc.length + 20); glb.write('glTF'); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8); glb.writeUInt32LE(doc.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); doc.copy(glb, 20);
    const requests = [];
    globalThis.fetch = async (input, init) => {
      const url = new URL(input); requests.push(url);
      assert.equal(url.origin, 'https://shotloom.example'); assert.equal(init.credentials, 'include');
      if (url.pathname.endsWith('/model')) return new Response(glb);
      return Response.json({ success: true, data: url.pathname.endsWith('/assets') ? { assets: [asset], total: 1, page: 1, per_page: 24 } : asset });
    };
    assert.equal((await api.searchPolyforkModels('oak & chair')).assets[0].id, id);
    assert.equal(requests[0].searchParams.get('q'), 'oak & chair');
    await api.searchPolyforkModels('cat', 2, undefined, 'animal');
    assert.equal(requests.at(-1).searchParams.get('class'), 'animal');
    const { resource } = await api.downloadPolyforkModel(id);
    assert.match(resource.id, /^model-[a-f0-9]{64}$/);
    assert.equal(resource.copyright, asset.credit); assert.match(resource.license, /CC BY 4.0/);
    assert.match(resource.source, /Retrieved:/);
    const zip = unzipSync(new Uint8Array(await api.polyforkModelBundle(resource).arrayBuffer()));
    assert.deepEqual(Buffer.from(zip[`${id}.glb`]), glb);
    assert.match(strFromU8(zip['LICENSE.txt']), /Armchair by Polyfork/);
    assert.match(strFromU8(zip['LICENSE.txt']), /creativecommons.org/);
    assert.throws(() => api.getPolyforkModel('../private'), /ID 无效/);
    globalThis.fetch = async () => Response.json({ success: false, message: '稍后重试' }, { status: 429 });
    await assert.rejects(api.searchPolyforkModels('chair'), /稍后重试/);
    globalThis.fetch = async input => String(input).endsWith('/model') ? new Response('bad model') : Response.json({ success: true, data: asset });
    await assert.rejects(api.downloadPolyforkModel(id), /GLB/);
  } finally { globalThis.fetch = original; await env.dispose(); }
});
