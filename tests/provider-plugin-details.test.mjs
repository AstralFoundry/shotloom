import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRendererEnv } from './helpers/rendererSsr.mjs';
import { readSource } from './helpers/sourceContract.mjs';

test('plugin documentation renders tables and code while keeping HTML and unsafe links inert', async () => {
  const env = await createRendererEnv();
  try {
    const { PluginMarkdown } = await env.load('app/views/ProviderPluginDetails.tsx');
    const html = renderToStaticMarkup(createElement(PluginMarkdown, {
      text: '# Example\n<script>alert(1)</script>\n[bad](javascript:alert)\n[fields](docs/interface.md)\n[site](https://example.com)\n| Field | Type |\n| --- | --- |\n| `apiKey` | secret |\n```js\n<script>unsafe</script>\n```', onDocument: () => {},
    }));
    assert.match(html, /<table>/);
    assert.match(html, /<code>apiKey<\/code>/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>|href="javascript:/);
    assert.match(html, /href="https:\/\/example.com"/);
    assert.match(html, /<button[^>]*>.*fields/s);
  } finally { await env.dispose(); }
});

test('plugin details describe the real operation endpoints, parameters, lifecycle and packaged README', async () => {
  const env = await createRendererEnv();
  try {
    const { ProviderPluginDetails } = await env.load('app/views/ProviderPluginDetails.tsx');
    const manifest = JSON.parse(readSource('plugin-packages/examples/openai-compatible/manifest.json'));
    manifest.readme = '# Packaged documentation\nIndependent author instructions';
    manifest.protocols[0].mode.params.push({ key: 'fixtureRequiredField', label: 'Required fixture', type: 'text', required: true, default: 'example' });
    const plugin = { manifest, source: 'npm:@scope/plugin@1.0.0', digest: 'abc123', enabled: true, trustedCode: false, installedAt: '', history: [] };
    const html = renderToStaticMarkup(createElement(ProviderPluginDetails, { plugin, connections: [] }));
    assert.match(html, /Packaged documentation/);
    assert.match(html, /npm:@scope\/plugin@1\.0\.0/);
    assert.match(html, /POST .*chat\/completions/);
    assert.match(html, /fixtureRequiredField/);
    assert.match(html, /secret/);
    assert.match(html, /abc123/);
  } finally { await env.dispose(); }
});

test('browser preview gives a useful npm desktop requirement before fetching', async () => {
  const env = await createRendererEnv({ storage: new Map() });
  try {
    const { createBrowserProviderPlugins } = await env.load('services/browserProviderPlugins');
    await assert.rejects(createBrowserProviderPlugins().manage('inspect', { source: 'npm:@scope/plugin@latest' }), /desktop app/);
  } finally { await env.dispose(); }
});

test('plugin README metadata is validated before entering the details renderer', async () => {
  const env = await createRendererEnv();
  try {
    const { providerManifestErrors } = await env.load('domain/provider/plugins/ProviderPlugins');
    const manifest = JSON.parse(readSource('plugin-packages/examples/openai-compatible/manifest.json'));
    assert.ok(providerManifestErrors({ ...manifest, readme: { html: 'bad' } }).includes('readme must be a string'));
    assert.ok(providerManifestErrors({ ...manifest, readme: 'a'.repeat(512 * 1024 + 1) }).includes('Plugin README exceeds 512 KiB'));
  } finally { await env.dispose(); }
});
