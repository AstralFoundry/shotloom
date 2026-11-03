import assert from 'node:assert/strict';

import test from 'node:test';
import { readSource } from './helpers/sourceContract.mjs';

const read = (path) => readSource(path);
const config = JSON.parse(read('src-tauri/tauri.conf.json'));
const capabilities = JSON.parse(read('src-tauri/capabilities/default.json'));

const metaPolicy = read('renderer/index.html').match(
  /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
)[1];

const directive = (policy, name) =>
  policy.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name} `));

test('the native CSP and the document CSP are the same single policy', () => {
  assert.equal(config.app.security.csp, metaPolicy);
});

test('CSP keeps script execution same-origin and blocks plugin objects', () => {
  assert.doesNotMatch(directive(metaPolicy, 'script-src'), /'unsafe-inline'|'unsafe-eval'/);
  assert.equal(directive(metaPolicy, 'object-src'), "object-src 'none'");
  assert.equal(directive(metaPolicy, 'base-uri'), "base-uri 'self'");
});

test('CSP allows local media but keeps requests on the native IPC channel', () => {
  const mediaSrc = directive(metaPolicy, 'media-src');
  for (const source of ['asset:', 'http://asset.localhost', 'blob:']) {
    assert.match(mediaSrc, new RegExp(source.replace('.', '\\.')));
  }
  const connectSources = directive(metaPolicy, 'connect-src').split(/\s+/).slice(1);
  assert.ok(connectSources.includes("ipc://localhost"));
  assert.ok(connectSources.includes('https://ipc.localhost'));
  assert.ok(connectSources.includes('asset:'));
  // 渲染进程没有任何 fetch/XHR，允许任意 scheme 或本机端口等于给 webview 开一条外传通道。
  assert.ok(connectSources.every((source) => !source.includes('*') && !source.includes('127.0.0.1')));
  assert.ok(!connectSources.some((source) => /^(https?|ws|wss):$/.test(source)));
});

test('the webview has no shell permission and opens paths only through the native check', () => {
  const permissions = JSON.stringify(capabilities.permissions);
  assert.doesNotMatch(permissions, /shell/);
  assert.doesNotMatch(read('src-tauri/Cargo.toml'), /tauri-plugin-shell/);
  assert.doesNotMatch(read('package.json'), /plugin-shell/);
  const api = read('renderer/src/services/tauriApi.ts');
  assert.doesNotMatch(api, /@tauri-apps\/plugin-shell/);
  assert.match(api, /case 'file:open-path': return invoke\('file_open_path'/);
});
