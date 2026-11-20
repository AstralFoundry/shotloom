import assert from 'node:assert/strict';
import test from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

const id = '12345678-1234-4234-8234-123456789abc';
const data = { settings: { locale: 'en-US', agentCanRunNodes: false }, project: { id, nodes: [], storageRevision: 7 }, assets: { assets: [], materials: [], references: [] } };
const json = value => Response.json({ success: true, data: value });

test('direct canvas consumes one startup response, then refreshes each dependency without stale reuse', async () => {
  const env = await createRendererEnv({ storageMode: 'cloud', withWindow: true });
  const original = globalThis.fetch, calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  globalThis.fetch = async (url, options) => {
    calls.push(url);
    assert.equal(options.credentials, 'include');
    if (url.endsWith('/startup')) { await gate; return json(data); }
    if (url === '/api/settings') return json({ locale: 'zh-CN' });
    if (url === '/api/catalog/assets') return json({ assets: [{ id: 'new' }] });
    if (url === `/api/project/${id}`) return json({ ...data.project, storageRevision: 8 });
    assert.fail(`Unexpected request: ${url}`);
  };
  let pending;
  try {
    window.location = { search: `?native=embedded&project=${id}&route=creation` };
    const { createCloudApi, loadCloudPreferences } = await env.load('services/cloudApi');
    const api = createCloudApi({ project: {}, file: {}, settings: {} });
    pending = Promise.all([loadCloudPreferences(), api.project.readFile(`cloud/projects/${id}/project.sqlite`), api.localAssets.getCatalog()]);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [`/api/project/${id}/startup`]);
    release();
    const [settings, project, assets] = await pending;
    assert.equal(settings.agentCanRunNodes, false);
    assert.equal(settings.apiKeyValid, false);
    assert.deepEqual(project, data.project);
    assert.deepEqual(assets, data.assets);
    assert.equal((await loadCloudPreferences()).locale, 'zh-CN');
    assert.equal((await api.project.readFile(`cloud/projects/${id}/project.sqlite`)).storageRevision, 8);
    assert.deepEqual((await api.localAssets.getCatalog()).assets, [{ id: 'new' }]);
    assert.equal(calls.length, 4);
  } finally { release(); await pending?.catch(() => {}); globalThis.fetch = original; await env.dispose(); }
});

test('startup supports old servers, while server failures stay visible and permit a fresh retry', async () => {
  for (const status of [404, 405, 503]) {
    const env = await createRendererEnv({ storageMode: 'cloud', withWindow: true });
    const original = globalThis.fetch, calls = [];
    globalThis.fetch = async url => {
      calls.push(url);
      if (url.endsWith('/startup')) return Response.json({ success: false, message: 'Startup unavailable' }, { status });
      if (url === '/api/settings') return json(data.settings);
      if (url === '/api/catalog/assets') return json(data.assets);
      if (url === `/api/project/${id}`) return json(data.project);
      assert.fail(`Unexpected request: ${url}`);
    };
    try {
      window.location = { search: `?route=creation&project=${id}` };
      const { createCloudApi, loadCloudPreferences } = await env.load('services/cloudApi');
      const api = createCloudApi({ project: {}, file: {}, settings: {} });
      const results = await Promise.allSettled([loadCloudPreferences(), api.project.readFile(id), api.localAssets.getCatalog()]);
      assert.equal(calls.filter(url => url.endsWith('/startup')).length, 1);
      if (status === 503) {
        assert.ok(results.every(result => result.status === 'rejected' && /Startup unavailable/.test(result.reason.message)));
        assert.equal(calls.length, 1, 'do not hide backend failures by issuing a second request wave');
      } else {
        assert.ok(results.every(result => result.status === 'fulfilled'));
        assert.equal(calls.length, 4);
      }
      assert.equal((await loadCloudPreferences()).locale, 'en-US', 'retries must issue a fresh settings read');
    } finally { globalThis.fetch = original; await env.dispose(); }
  }
});

test('canvas startup keeps other projects, ordinary pages and account bindings isolated', async () => {
  const other = '87654321-4321-4321-8321-cba987654321';
  const env = await createRendererEnv({ storageMode: 'cloud', withWindow: true });
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push([url, options.headers['x-shotloom-user']]);
    return json(url.endsWith('/startup') ? data : {});
  };
  try {
    window.location = { search: `?route=skills&project=${id}` };
    const { createCloudApi, loadCloudPreferences } = await env.load('services/cloudApi');
    const { bindCloudUser } = await env.load('services/cloudRequest');
    const api = createCloudApi({ project: {}, file: {}, settings: {} });
    await loadCloudPreferences();
    await api.project.readFile(other);
    assert.deepEqual(calls.map(([url]) => url), ['/api/settings', `/api/project/${other}`]);
    window.location.search = `?route=creation&project=${id}`;
    await api.project.readFile(other);
    assert.equal(calls.at(-1)[0], `/api/project/${other}`);
    assert.equal(bindCloudUser('original-user'), true);
    await loadCloudPreferences();
    assert.deepEqual(calls.at(-1), [`/api/project/${id}/startup`, 'original-user']);
    assert.equal(bindCloudUser('different-user'), false, 'an open workspace cannot switch account');
    await api.localAssets.getCatalog();
    assert.equal(calls.filter(([url]) => url.endsWith('/startup')).length, 1);
  } finally { globalThis.fetch = original; await env.dispose(); }
});

test('canvas data preloads before the full cloud adapter loads and is consumed without another request', async () => {
  const env = await createRendererEnv({ storageMode: 'cloud', withWindow: true });
  const original = globalThis.fetch, calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  globalThis.fetch = async (url, options) => {
    calls.push(url);
    assert.equal(options.headers['x-shotloom-user'], 'original-user');
    await gate;
    return json(data);
  };
  try {
    window.location = { search: `?route=creation&project=${id}` };
    const { bindCloudUser } = await env.load('services/cloudRequest');
    bindCloudUser('original-user');
    const { preloadCloudCanvasStartup } = await env.load('services/cloudCanvasStartup');
    preloadCloudCanvasStartup();
    preloadCloudCanvasStartup();
    assert.deepEqual(calls, [`/api/project/${id}/startup`]);
    const { createCloudApi, loadCloudPreferences } = await env.load('services/cloudApi');
    const api = createCloudApi({ project: {}, file: {}, settings: {} });
    const pending = Promise.all([loadCloudPreferences(), api.project.readFile(id), api.localAssets.getCatalog()]);
    release();
    const [settings, project, assets] = await pending;
    assert.equal(settings.agentCanRunNodes, false);
    assert.deepEqual(project, data.project);
    assert.deepEqual(assets, data.assets);
    assert.equal(calls.length, 1);
    preloadCloudCanvasStartup();
    assert.equal(calls.length, 1, 'focus checks cannot restart a consumed startup preload');
  } finally { release(); globalThis.fetch = original; await env.dispose(); }
});
