import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

for (const storageMode of ['cloud', 'local']) test(`${storageMode} settings display the upstream list regardless of bundled provider configs`, async () => {
  let data;
  const env = await createRendererEnv({ storageMode, storage: new Map(), withWindow: true, plugins: [{
    name: 'capture-settings-data',
    transform(_source, id) {
      if (id.replaceAll('\\', '/').endsWith('/app/views/SettingsPanel.tsx')) {
        return 'export function SettingsPanel({ data }) { globalThis.__captureUpstreamSettings(data); return null; }';
      }
    },
  }] });
  globalThis.__captureUpstreamSettings = value => { data = value; };
  try {
    const { settingsStore } = await env.load('store/settingsStore');
    const { SettingsFeature } = await env.load('app/views/SettingsFeature.tsx');
    settingsStore.providerConfigs = {};
    renderToStaticMarkup(createElement(SettingsFeature));
    assert.deepEqual(data.providers, []);

    settingsStore.providerConfigs = {
      openai: { apiKey: '', baseUrl: '', serverManaged: true, allowedModelIds: ['local-only-model'] },
      google: { apiKey: 'legacy-key', baseUrl: '' },
      minimax: { apiKey: '', baseUrl: '', serverManaged: true, allowedModelIds: [] },
    };
    renderToStaticMarkup(createElement(SettingsFeature));
    assert.equal(data.managedModels, true);
    assert.deepEqual(data.providers, []);
    assert.deepEqual(data.upstreamModels, []);
    settingsStore.upstreamModels = [
      { id: 'speech-2.8-hd', owned_by: 'minimax', supported_endpoint_types: ['openai'] },
      { id: 'not-in-local-catalog', owned_by: 'actual-upstream', supported_endpoint_types: ['image-generation'] },
    ];
    renderToStaticMarkup(createElement(SettingsFeature));
    assert.deepEqual(data.upstreamModels.map(model => model.id), ['speech-2.8-hd', 'not-in-local-catalog']);
    assert.deepEqual(data.upstreamModels.map(model => model.type), ['audioGeneration', 'imageGeneration']);
    assert.equal(data.upstreamModels[1].providerName, 'actual-upstream');
  } finally {
    delete globalThis.__captureUpstreamSettings;
    await env.dispose();
  }
});

test('managed models are displayed by text, image, video and audio type across providers', async () => {
  const env = await createRendererEnv({ plugins: [{
    name: 'open-model-settings',
    enforce: 'pre',
    transform(source, id) {
      if (id.replaceAll('\\', '/').endsWith('/app/views/SettingsPanel.tsx')) {
        return source.replace('useState<Tab>("general")', 'useState<Tab>("providers")');
      }
    },
  }] });
  try {
    const { SettingsPanel } = await env.load('app/views/SettingsPanel.tsx');
    const { getTypeMeta } = await env.load('domain/catalog/ModelCatalog');
    const types = ['textGeneration', 'imageGeneration', 'videoGeneration', 'audioGeneration'];
    const data = {
      managedModels: true,
      upstreamModels: [
        { id: 'image-test', type: 'imageGeneration', providerName: 'First provider' },
        { id: 'text-test', type: 'textGeneration', providerName: 'First provider' },
        { id: 'text-second', type: 'textGeneration', providerName: 'Second provider' },
        { id: 'audio-test', type: 'audioGeneration', providerName: 'Second provider' },
        { id: 'unclassified-upstream-model', type: 'other', providerName: 'New upstream' },
      ],
      providers: [
        { id: 'first', name: 'First provider', iconId: 'openai', models: [
          { id: 'image-test', name: 'Image test', type: 'imageGeneration' },
          { id: 'text-test', name: 'Text test', type: 'textGeneration' },
        ] },
        { id: 'second', name: 'Second provider', iconId: 'google', models: [
          { id: 'text-second', name: 'Text second', type: 'textGeneration' },
          { id: 'audio-test', name: 'Audio test', type: 'audioGeneration' },
        ] },
      ],
    };
    const html = renderToStaticMarkup(createElement(SettingsPanel, { data, controller: {} }));
    const headings = types.map(type => html.indexOf(`<strong>${getTypeMeta(type).label}</strong>`));
    assert.ok(headings.every(index => index >= 0));
    assert.deepEqual(headings, [...headings].sort((a, b) => a - b));
    assert.ok(html.indexOf('text-test') < headings[1]);
    assert.ok(html.indexOf('text-second') < headings[1]);
    assert.ok(html.indexOf('image-test') > headings[1]);
    assert.ok(html.indexOf('audio-test') > headings[3]);
    assert.ok(html.indexOf('unclassified-upstream-model') > headings[3]);
    assert.equal((html.match(/class="provider-model-card"/g) || []).length, 5);
    assert.match(html, /<em>5<\/em>/);
    assert.doesNotMatch(html, /Text test|Text second|Image test|Audio test/);
    assert.doesNotMatch(html, /provider-list-row|API Key/);
  } finally { await env.dispose(); }
});

test('upstream IDs are unique, validated and never expanded into bundled provider aliases', async () => {
  const env = await createRendererEnv();
  try {
    const { parseUpstreamModels, getUpstreamModelRows } = await env.load('domain/provider/UpstreamModels');
    const input = [
      { id: 'speech-2.8-hd', owned_by: 'minimax' },
      { id: 'new-image-model', supported_endpoint_types: ['image-generation', 'openai'] },
      { id: 'new-video-model', supported_endpoint_types: ['openai-video'] },
      { id: 'new-transport-only-model', supported_endpoint_types: ['openai', 'gemini'] },
      { id: 'upstream-no-metadata', supported_endpoint_types: null },
    ];
    const rows = getUpstreamModelRows(parseUpstreamModels([...input, input[0]]));
    assert.deepEqual(rows.map(model => model.id), input.map(model => model.id));
    assert.deepEqual(rows.map(model => model.type), ['audioGeneration', 'imageGeneration', 'videoGeneration', 'other', 'other']);
    for (const invalid of [undefined, {}, [{ id: '' }], [{ id: 3 }], [{ id: 'valid', owned_by: {} }], [{ id: 'valid', supported_endpoint_types: [3] }]]) {
      assert.throws(() => parseUpstreamModels(invalid));
    }
    assert.deepEqual(parseUpstreamModels([]), []);
  } finally { await env.dispose(); }
});
