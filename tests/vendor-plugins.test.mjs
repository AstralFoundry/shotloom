import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { build } from 'esbuild';
import { zipSync } from 'fflate';
import { createRendererEnv } from './helpers/rendererSsr.mjs';
import { readDefaultPluginPackages, readPluginPackage, defaultPluginConnections } from '../scripts/provider-distribution.mjs';

const legacy = JSON.parse(readFileSync('tests/fixtures/legacy-protocol-plugins.json', 'utf8'));
const oldSnapshot = () => ({ plugins: legacy.map(manifest => ({ manifest, enabled: true, digest: 'old-digest', source: `distribution:${manifest.id}@1.0.0`, trustedCode: true, installedAt: '', history: [] })), connections: defaultPluginConnections(legacy.map(manifest => ({ manifest }))), registryUrl: '' });
const packages = [...readDefaultPluginPackages(), readPluginPackage('plugin-packages/vendor.starrouter')].map(item => ({ ...item, digest: createHash('sha256').update(zipSync(item.files)).digest('hex') }));

test('upgrade consolidates models and tools, keeps credentials and old contracts, and is idempotent', async () => {
  const env = await createRendererEnv({ includeStarrouter: true, storage: new Map() });
  try {
    const state = oldSnapshot();
    const starrouter = state.connections.find(c => c.id === 'starrouter');
    starrouter.name = 'My gateway'; starrouter.baseUrl = 'https://proxy.example/v1';
    state.plugins.find(p => p.manifest.id === 'protocol.starrouter.audio').enabled = false;
    localStorage.setItem('shotloom-provider-plugins', JSON.stringify(state));
    localStorage.setItem('shotloom-settings', JSON.stringify({ canvasToolbarCustomization: { pinned: { video: ['clip', 'plugin:protocol.starrouter.processing:video-upscale'] } }, providerConfigs: { starrouter: { apiKey: 'fixture-key', baseUrl: starrouter.baseUrl }, 'starrouter.processing': { apiKey: 'fixture-key', baseUrl: starrouter.baseUrl } } }));
    const { createBrowserProviderPlugins } = await env.load('services/browserProviderPlugins');
    const bridge = () => createBrowserProviderPlugins({ loadDistribution: async () => packages });
    const next = await bridge().manage('list');
    const registry = await env.load('domain/provider/plugins/ProviderPlugins'); registry.setProviderPluginSnapshot(next);
    const caps = await env.load('domain/provider/plugins/PluginCapabilities');
    assert.equal(next.plugins.filter(p => !p.retired).length, 18);
    assert.equal(next.connections.length, 18);
    for (const connection of next.connections) assert.equal(connection.pluginId, `vendor.${connection.id}`, connection.id);
    const current = next.connections.find(c => c.id === 'starrouter');
    assert.equal(current.pluginId, 'vendor.starrouter'); assert.equal(current.name, 'My gateway'); assert.equal(current.baseUrl, starrouter.baseUrl);
    assert.equal(current.models.length, starrouter.models.length);
    assert.ok(current.models.every(m => !m.protocolPlugin));
    assert.ok(current.models.filter(m => m.type === 'audioGeneration').every(m => m.enabled === false));
    assert.equal(registry.registeredModels().length, 86);
    assert.ok(registry.resolvePluginProvider({ id: 'protocol.starrouter.video', version: '1.0.0', providerId: 'protocol' }));
    assert.equal(caps.registeredCapabilities().length, 1);
    assert.equal(caps.registeredCapabilities()[0].reference.id, 'vendor.starrouter');
    assert.deepEqual(caps.capabilityConnections('vendor.starrouter').map(c => c.id), ['starrouter']);
    assert.ok(next.legacyConnections.some(c => c.id === 'starrouter.processing'));
    assert.equal(JSON.parse(localStorage.getItem('shotloom-settings')).providerConfigs.starrouter.apiKey, 'fixture-key');
    assert.deepEqual(JSON.parse(localStorage.getItem('shotloom-settings')).canvasToolbarCustomization.pinned.video, ['clip', 'plugin:vendor.starrouter:video-upscale']);
    assert.deepEqual(await bridge().manage('list'), next);
  } finally { await env.dispose(); }
});

test('upgrade preserves removals, deleted defaults, custom model overrides and distinct credentials', async () => {
  const env = await createRendererEnv({ includeStarrouter: true, storage: new Map() });
  try {
    const migration = await env.load('../../shared/vendorPluginMigration');
    const state = oldSnapshot();
    state.connections = state.connections.filter(c => c.id !== 'openai');
    for (const p of state.plugins.filter(p => p.manifest.id.includes('minimax'))) { p.enabled = false; p.removed = true; }
    const custom = structuredClone(state.connections.find(c => c.id === 'starrouter'));
    custom.id = 'connection.my-gateway'; custom.name = 'Custom'; custom.enabled = false;
    custom.pluginId = 'protocol.starrouter.video'; custom.models = [custom.models.find(model => model.protocolPlugin === custom.pluginId)]; custom.models[0].name = 'My model'; custom.models[0].upstreamModel = 'custom-model';
    state.connections.push(custom);
    const settings = { providerConfigs: { starrouter: { apiKey: 'main' }, 'starrouter.processing': { apiKey: 'different' } } };
    for (const { manifest } of packages) {
      const prior = migration.vendorInstallState(state, manifest);
      state.plugins.push({ manifest, ...prior, source: `distribution:${manifest.id}` });
      for (const c of prior.connections) if (!state.connections.some(x => x.id === c.id)) state.connections.push(structuredClone(c));
    }
    assert.equal(migration.migrateVendorPlugins(state, settings), true);
    assert.equal(state.connections.some(c => c.id === 'openai'), false);
    assert.equal(state.plugins.find(p => p.manifest.id === 'vendor.minimax').removed, true);
    const saved = state.connections.find(c => c.id === custom.id);
    assert.equal(saved.pluginId, 'vendor.starrouter'); assert.equal(saved.enabled, false);
    assert.equal(saved.models[0].upstreamModel, 'custom-model'); assert.equal(saved.models[0].name, 'My model');
    assert.equal(state.connections.find(c => c.id === 'starrouter.processing').pluginId, 'vendor.starrouter');
    assert.equal(settings.providerConfigs['starrouter.processing'].apiKey, 'different');
    assert.equal(migration.migrateVendorPlugins(state, settings), false);
  } finally { await env.dispose(); }
});

// Exercise the real native registry, ORM transaction, credential lookup and isolated runtime.
test('native vendor tools use the generation key and old processing tasks can still poll after upgrade', async t => {
  const root = mkdtempSync(join(tmpdir(), 'shotloom-vendor-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const built = await build({ stdin: { contents: "export * from './electron/core/plugins'; export { withDatabase } from './electron/core/db'; export { saveSettings, loadSettings } from './electron/core/storage';", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false });
  const module = join(root, 'native.mjs'); writeFileSync(module, built.outputFiles[0].text);
  const native = await import(pathToFileURL(module));
  const runtime = join(root, 'runtime'); mkdirSync(runtime); symlinkSync(process.execPath, join(runtime, 'node'));
  const distributionDir = join(root, 'distribution'); mkdirSync(distributionDir);
  const index = [];
  for (const item of packages) {
    const bytes = zipSync(item.files); const file = `${item.manifest.id}.shotloom-plugin`;
    writeFileSync(join(distributionDir, file), bytes);
    index.push({ id: item.manifest.id, version: item.manifest.version, file, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  writeFileSync(join(distributionDir, 'index.json'), JSON.stringify({ apiVersion: 1, plugins: index }));
  const nativeEnv = { appData: root, databaseFile: join(root, 'app.sqlite'), distributionDir, runtimeRoot: runtime, appVersion: '0.9.2' };
  const old = legacy.find(m => m.id === 'protocol.starrouter.processing');
  const bytes = zipSync({ 'manifest.json': Buffer.from(JSON.stringify(old)), 'runtime/index.mjs': readFileSync('plugin-packages/vendor.starrouter/runtime/index.mjs') });
  const oldFile = join(root, 'old.shotloom-plugin'); writeFileSync(oldFile, bytes);
  const checked = await native.inspectProviderPackage(nativeEnv, oldFile, 'npm');
  await native.installProviderPackage(nativeEnv, oldFile, checked.digest, true, 'npm');
  const requests = [];
  const server = createHttpServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    requests.push({ path: req.url, key: req.headers.authorization, body: body && JSON.parse(body) });
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ id: 'fixture_task', status: 'running' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  native.withDatabase(nativeEnv.databaseFile, db => native.saveSettings(db, { providerConfigs: { starrouter: { apiKey: 'shared-fixture-key', baseUrl }, 'starrouter.processing': { apiKey: 'shared-fixture-key', baseUrl } } }));
  const state = (await native.listProviderPlugins(nativeEnv)).state;
  assert.equal(state.connections.filter(c => c.pluginId === 'vendor.starrouter').length, 1);
  const env = await createRendererEnv({ includeStarrouter: true, storage: new Map() }); t.after(() => env.dispose());
  const registry = await env.load('domain/provider/plugins/ProviderPlugins'); registry.setProviderPluginSnapshot(state);
  const capabilities = await env.load('domain/provider/plugins/PluginCapabilities');
  const prepared = capabilities.preparePluginAction({ key: 'plugin:vendor.starrouter:video-upscale', connectionId: 'starrouter', inputs: { source: ['input'] } }, { nodes: [{ id: 'input', type: 'videoGeneration', uploadedFile: { url: 'https://example.com/input.mp4' } }] });
  assert.equal(prepared.ready, true, prepared.errors.join('\n'));
  const contract = prepared.contract;
  assert.equal(registry.resolvePluginProvider(contract.reference).engine, 'module');
  const catalog = await env.load('domain/catalog/ModelCatalog');
  const video = registry.registeredModels().find(model => model.provider === 'starrouter' && model.type === 'videoGeneration');
  const generation = catalog.modelCatalog.buildRuntimeContract(video);
  assert.equal(generation.provider, contract.connectionId);
  assert.equal(generation.pluginRef.id, contract.reference.id);
  assert.equal(registry.resolvePluginProvider(generation.pluginRef).engine, 'declarative');
  const result = await native.callProviderPlugin(nativeEnv, { requestId: 'new', reference: contract.reference, providerId: 'starrouter', method: 'submit', input: { submissionId: 'once', processingContract: contract }, timeoutMs: 10000 });
  assert.equal(result.remoteTaskId, 'fixture_task');
  assert.equal(requests[0].key, 'Bearer shared-fixture-key');
  assert.equal(requests[0].body.model, 'comfly/1849');
  const oldContract = { ...contract, reference: { id: old.id, version: old.version, providerId: 'protocol' }, connectionId: 'starrouter.processing', digest: checked.digest, capability: old.capabilities[0], operation: old.protocols[0] };
  assert.equal((await native.callProviderPlugin(nativeEnv, { requestId: 'old', reference: oldContract.reference, providerId: oldContract.connectionId, method: 'poll', input: { remoteTaskId: 'fixture_task', processingContract: oldContract }, timeoutMs: 10000 })).status, 'running');
  assert.equal(requests.length, 2);
  assert.equal((await native.listProviderPlugins(nativeEnv)).changed, false);
});

test('plugin center presents vendors, media types, model and tool counts without protocol configuration', async () => {
  const env = await createRendererEnv({ includeStarrouter: true, storage: new Map() });
  try {
    const { ProviderPluginsPanel } = await env.load('app/views/ProviderPluginsPanel.tsx');
    const html = renderToStaticMarkup(createElement(ProviderPluginsPanel, { standalone: true }));
    assert.match(html, /StarRouter/);
    assert.match(html, /19 个模型/);
    assert.match(html, /1 个工具/);
    assert.doesNotMatch(html, /协议插件|文本协议|provider-plugin-sections/);
  } finally { await env.dispose(); }
});
