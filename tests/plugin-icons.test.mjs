import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { pluginIconPath, pluginIconSource, packagedPluginIcon } from '../shared/pluginIcon.ts';
import { readPluginPackage, readDefaultPluginPackages } from '../scripts/provider-distribution.mjs';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

test('every default plugin carries its own icon and includes it in npm packaging', () => {
  for (const { manifest, files } of readDefaultPluginPackages()) {
    const metadata = JSON.parse(files['package.json'].toString());
    assert.equal(manifest.icon, 'icon.png', manifest.id);
    assert.equal(metadata.shotloomIcon, manifest.icon, manifest.id);
    assert.ok(metadata.files.includes(manifest.icon), manifest.id);
    assert.equal(metadata.version, manifest.version, manifest.id);
    assert.deepEqual([...files[manifest.icon].subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], manifest.id);
    assert.equal(manifest.iconData, packagedPluginIcon(manifest.icon, files[manifest.icon]), manifest.id);
  }
});

test('plugin icon uses a bundled raster asset without requiring a built-in brand', async () => {
  const pkg = readPluginPackage('plugin-packages/vendor.starrouter');
  assert.equal(pkg.manifest.icon, 'icon.png');
  assert.equal(pkg.manifest.iconData, packagedPluginIcon('icon.png', pkg.files['icon.png']));
  assert.ok(pluginIconSource(pkg.manifest.iconData));
  for (const path of ['../icon.png', '/icon.png', 'https://example.com/icon.png', 'icon.svg', 'assets//icon.png']) assert.equal(pluginIconPath(path), false, path);
  assert.throws(() => packagedPluginIcon('missing.png', undefined), /existing/);
  assert.throws(() => packagedPluginIcon('huge.png', new Uint8Array(65537)), /64 KiB/);
  assert.equal(pluginIconSource('data:image/svg+xml;base64,PHN2Zz4='), undefined);
  const env = await createRendererEnv();
  try {
    const { ProviderBrandIcon } = await env.load('app/components/ProviderBrandIcon.tsx');
    const html = renderToStaticMarkup(createElement(ProviderBrandIcon, { icon: 'unknown-vendor', src: pkg.manifest.iconData }));
    assert.ok(html.includes(pkg.manifest.iconData));
    const { providerManifestErrors } = await env.load('domain/provider/plugins/ProviderPlugins');
    assert.deepEqual(providerManifestErrors(pkg.manifest), []);
    assert.ok(providerManifestErrors({ ...pkg.manifest, icon: '../icon.png' }).length);
  } finally { await env.dispose(); }
});

test('market resolves current package assets and tolerates unavailable metadata', async () => {
  const env = await createRendererEnv();
  try {
  const { withNpmPluginIcons } = await env.load('../../shared/npmPluginIcons');
  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync('plugin-packages/vendor.starrouter/icon.png');
  const search = { objects: [{ package: { name: '@author/shotloom-plugin-images', version: '0.0.0-stage' } }], total: 1 };
  const result = await withNpmPluginIcons(search, 'https://registry.npmjs.org/', async url => {
    if (url.endsWith('/latest')) return new TextEncoder().encode(JSON.stringify({ name: '@author/shotloom-plugin-images', version: '1.0.1', shotloomPlugin: 'manifest.json', shotloomIcon: 'assets/icon.png' }));
    assert.equal(url, 'https://cdn.jsdelivr.net/npm/@author/shotloom-plugin-images@1.0.1/assets/icon.png');
    return bytes;
  });
  assert.equal(result.objects[0].package.version, '1.0.1');
  assert.equal(result.objects[0].package.shotloomIcon, packagedPluginIcon('assets/icon.png', bytes));
  const offline = await withNpmPluginIcons(search, 'https://registry.npmjs.org/', async () => { throw new Error('offline'); });
  assert.equal(offline.objects.length, 1);
  assert.equal(offline.objects[0].package.shotloomIcon, undefined);
  } finally { await env.dispose(); }
});
