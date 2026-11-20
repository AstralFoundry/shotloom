import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readDefaultPluginPackages, defaultPluginConnections } from '../../../scripts/provider-distribution.mjs';

test('bundled text providers retain their declared wire endpoints and cache capabilities', async t => {
  const root = fileURLToPath(new URL('../../../renderer/', import.meta.url));
  const server = await createServer({ configFile: false, root, resolve: { alias: { '@': join(root, 'src') } },
    server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true } });
  t.after(() => server.close());
  const registry = await server.ssrLoadModule('/src/domain/provider/plugins/ProviderPlugins.ts');
  const { settingsStore } = await server.ssrLoadModule('/src/store/settingsStore.ts');
  const { harnessModelConfig } = await server.ssrLoadModule('/src/services/harnessModelConfig.ts');
  const { normalizeProviderConfigs } = await server.ssrLoadModule('/src/domain/provider/ProviderConfig.ts');
  const { catalogModelValidationErrors } = await server.ssrLoadModule('/src/domain/catalog/ModelCatalog.ts');
  const packages = readDefaultPluginPackages();
  const state = { plugins: packages.map(({ manifest }) => ({ manifest, enabled: true, history: [], trustedCode: false })),
    connections: defaultPluginConnections(packages), registryUrl: '' };
  registry.setProviderPluginSnapshot(state);
  settingsStore.providerConfigs = normalizeProviderConfigs(Object.fromEntries(state.connections.map(c => [c.id,
    { apiKey: 'local-test-key', baseUrl: c.baseUrl || 'https://dashscope.aliyuncs.com', cacheRetention: 'long' }])));
  const { providers } = harnessModelConfig();
  const expected = {
    google: ['openai-completions', 'https://generativelanguage.googleapis.com/v1beta/openai', false],
    openai: ['openai-responses', 'https://api.openai.com/v1', true],
    anthropic: ['anthropic-messages', 'https://api.anthropic.com', true],
    deepseek: ['openai-completions', 'https://api.deepseek.com/v1', false],
    qwen: ['openai-completions', 'https://dashscope.aliyuncs.com/compatible-mode/v1', false],
    zhipu: ['openai-completions', 'https://open.bigmodel.cn/api/paas/v4', false],
    moonshot: ['openai-completions', 'https://api.moonshot.ai/v1', false],
    xai: ['openai-completions', 'https://api.x.ai/v1', false],
    minimax: ['openai-completions', 'https://api.minimax.io/v1', false],
  };
  for (const [id, [api, url, long]] of Object.entries(expected)) {
    await t.test(id, () => {
      const profile = providers[`shotloom-${id}-${api}`]?.profile;
      assert.ok(profile, `Missing ${id} Agent route`);
      assert.equal(profile.baseURL, url);
      assert.equal(profile.cacheRetention, 'long');
      assert.ok(profile.models.length > 0);
      for (const model of profile.models) assert.equal(model.compat.supportsLongCacheRetention, long);
    });
  }
  await t.test('automatic mode clears retention without losing credentials', () => {
    const { cacheRetention, ...config } = settingsStore.providerConfigs.google;
    settingsStore.providerConfigs = normalizeProviderConfigs({ ...settingsStore.providerConfigs, google: config });
    assert.equal(harnessModelConfig().providers['shotloom-google-openai-completions'].profile.cacheRetention, undefined);
    assert.equal(settingsStore.providerConfigs.google.apiKey, 'local-test-key');
  });
  await t.test('origin and v1 scopes survive plugin and connection aliases', () => {
    const plugin = state.plugins.find(p => p.manifest.id === 'vendor.google');
    const agent = plugin.manifest.protocols[0].mode.agent;
    agent.endpoint = { method: 'POST', path: '/custom/openai/chat/completions', scope: 'origin' };
    registry.setProviderPluginSnapshot(state);
    assert.equal(harnessModelConfig().providers['shotloom-google-openai-completions'].profile.baseURL,
      'https://generativelanguage.googleapis.com/custom/openai');
    agent.endpoint = { method: 'POST', path: '/chat/completions', scope: 'v1' };
    settingsStore.providerConfigs.google.baseUrl = 'https://gateway.invalid';
    registry.setProviderPluginSnapshot(state);
    assert.equal(harnessModelConfig().providers['shotloom-google-openai-completions'].profile.baseURL, 'https://gateway.invalid/v1');
    settingsStore.providerConfigs.google.baseUrl = 'https://gateway.invalid/v1/';
    assert.equal(harnessModelConfig().providers['shotloom-google-openai-completions'].profile.baseURL, 'https://gateway.invalid/v1');
  });
  await t.test('malformed compatibility declarations fail plugin validation', () => {
    const mode = structuredClone(state.plugins.find(p => p.manifest.id === 'vendor.google').manifest.protocols[0].mode);
    mode.agent.compat = { supportsLongCacheRetention: 'yes' };
    const model = { id: 'cache-test', name: 'Cache test', type: 'textGeneration', defaultMode: mode.id, modes: [mode] };
    assert.ok(catalogModelValidationErrors(model).some(error => error.includes('agent.compat')));
  });
});
