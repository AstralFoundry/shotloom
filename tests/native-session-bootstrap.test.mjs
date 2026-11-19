import assert from 'node:assert/strict';
import test from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

test('native bootstrap is scoped to embedded documents and supplies locale before storage is available', async () => {
  const env = await createRendererEnv({ withWindow: true });
  const savedLocation = globalThis.location;
  try {
    globalThis.location = window.location = { search: '?native=embedded' };
    window.ReactNativeWebView = { injectedObjectJson: () => JSON.stringify({ userId: 'user', locale: 'en-US', token: 'must-not-propagate' }) };
    const { readNativeWorkspaceBootstrap } = await env.load('app/nativeWorkspaceBootstrap');
    const { getLocale } = await env.load('i18n/index');
    assert.deepEqual(readNativeWorkspaceBootstrap(), { userId: 'user', locale: 'en-US' });
    assert.equal(getLocale(), 'en-US');
    location.search = '';
    assert.equal(readNativeWorkspaceBootstrap(), undefined);
    location.search = '?native=embedded';
    window.ReactNativeWebView.injectedObjectJson = () => '{broken';
    assert.equal(readNativeWorkspaceBootstrap(), undefined);
    window.ReactNativeWebView.injectedObjectJson = () => '{"userId":7,"locale":"en-US"}';
    assert.equal(readNativeWorkspaceBootstrap(), undefined);
  } finally {
    if (savedLocation === undefined) delete globalThis.location; else globalThis.location = savedLocation;
    await env.dispose();
  }
});
