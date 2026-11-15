import test from 'node:test';
import assert from 'node:assert/strict';
import { readDefaultPluginPackages } from '../scripts/provider-distribution.mjs';
import { loadDefaultPluginSnapshot, loadLegacyModelCatalog } from './helpers/modelCatalog.mjs';
import { createRendererEnv } from './helpers/rendererSsr.mjs';
import { sourceExists } from './helpers/sourceContract.mjs';

const packages = () => { const snapshot = loadDefaultPluginSnapshot(); return readDefaultPluginPackages().map((item, index) => ({ ...item, digest: snapshot.plugins[index].digest })); };

test('default packages install into an empty registry and stay uninstalled after restart', async () => {
  const storage = new Map();
  const env = await createRendererEnv({ storage });
  try {
    localStorage.removeItem('shotloom-provider-plugins');
    const registry = await env.load('domain/provider/plugins/ProviderPlugins');
    registry.setProviderPluginSnapshot({ plugins: [], connections: [], registryUrl: '' });
    assert.deepEqual(registry.registeredModels(), []);
    const { createBrowserProviderPlugins } = await env.load('services/browserProviderPlugins');
    const createBridge = () => createBrowserProviderPlugins({ loadDistribution: async () => packages() });
    let bridge = createBridge();
    let snapshot = await bridge.manage('list');
    registry.setProviderPluginSnapshot(snapshot);
    assert.equal(snapshot.plugins.length, 32);
    assert.equal(snapshot.connections.length, 18);
    assert.equal(registry.registeredModels().length, 86);
    assert.ok(snapshot.plugins.every(item => item.source.startsWith('distribution:')));
    const historical = loadLegacyModelCatalog();
    for (const model of historical.models) assert.ok(registry.registeredModels().some(item => item.id === model.id));
    await bridge.manage('remove', { id: 'protocol.openai.images' });
    bridge = createBridge();
    snapshot = await bridge.manage('list');
    registry.setProviderPluginSnapshot(snapshot);
    assert.equal(snapshot.plugins.find(item => item.manifest.id === 'protocol.openai.images').removed, true);
    assert.equal(registry.registeredModels().some(item => item.id === 'gpt-image-2.6-sunburst'), false);
    assert.ok(registry.resolvePluginProvider({ id: 'protocol.openai.images', version: '1.0.0', providerId: 'protocol' }));
    assert.ok(registry.resolvePluginProvider({ id: 'builtin.openai', version: '1.0.0', providerId: 'openai' }));
    const docs = await bridge.manage('documentation', { id: 'protocol.google.text', path: 'README.md' });
    assert.match(docs.content, /Google Gemini Text/);
  } finally { await env.dispose(); }
});

test('default package migration respects explicit saved connections and disabled states', async () => {
  const env = await createRendererEnv({ storage: new Map() });
  try {
    const saved = { id: 'openai', name: 'My OpenAI', baseUrl: 'https://my.example/v1', enabled: false, pluginId: 'builtin.openai', presetId: 'openai', models: [] };
    localStorage.setItem('shotloom-provider-plugins', JSON.stringify({ plugins: [], connections: [saved], disabledBuiltins: ['protocol.google.text'], registryUrl: 'https://my.example/plugins' }));
    const { createBrowserProviderPlugins } = await env.load('services/browserProviderPlugins');
    const bridge = createBrowserProviderPlugins({ loadDistribution: async () => packages() });
    const snapshot = await bridge.manage('list');
    assert.deepEqual(snapshot.connections.find(item => item.id === 'openai'), saved);
    assert.equal(snapshot.plugins.find(item => item.manifest.id === 'protocol.google.text').enabled, false);
    assert.equal(snapshot.registryUrl, 'https://my.example/plugins');
    assert.equal(snapshot.disabledBuiltins, undefined);
  } finally { await env.dispose(); }
});

test('product runtime contains no former provider catalog source files', () => {
  for (const path of ['renderer/src/config/model-catalog-v2', 'renderer/src/config/model-catalog-v2.json', 'renderer/src/config/provider-plugins.bundled.json', 'renderer/src/config/protocol-plugins.bundled.json', 'renderer/src/config/provider-connections.bundled.json', 'renderer/src/domain/provider/adapters/runninghub.ts']) assert.equal(sourceExists(path), false, path);
});
