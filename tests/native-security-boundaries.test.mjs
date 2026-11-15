import assert from 'node:assert/strict';

import test from 'node:test';
import { readSource } from './helpers/sourceContract.mjs';

const read = (path) => readSource(path);
const config = JSON.parse(read('src-tauri/tauri.conf.json'));
const capabilities = JSON.parse(read('src-tauri/capabilities/default.json'));

test('cloud native access permits media and import without local domain or Harness writes', () => {
  const permissions = JSON.parse(read('src-tauri/permissions/client.json')).permission;
  const local = permissions.find(item => item.identifier === 'local-commands').commands.allow;
  const cloud = permissions.find(item => item.identifier === 'cloud-client').commands.allow;
  const registered = [...read('src-tauri/src/lib.rs').matchAll(/commands::([a-z0-9_]+),/g)].map(match => match[1]);
  assert.deepEqual(local.toSorted(), registered.toSorted());
  assert.ok(cloud.every(command => registered.includes(command)));
  for (const command of ['cloud_media_workspace', 'cloud_media_upload', 'project_read_bundle', 'openreel_cloud_export_start']) assert.ok(cloud.includes(command));
  for (const command of ['storage_set', 'settings_get', 'project_save', 'harness_bind_session', 'start_harness_runtime']) assert.ok(!cloud.includes(command));
  assert.ok(capabilities.permissions.includes('local-commands'));
  const script = read('scripts/desktop-cloud.mjs');
  assert.match(script, /permission !== 'local-commands'/);
  assert.match(script, /'cloud-client'/);
});

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

test('CSP permits the configured BFF and Storage without broad network permissions', () => {
  const mediaSrc = directive(metaPolicy, 'media-src');
  for (const source of ['asset:', 'http://asset.localhost', 'blob:']) {
    assert.match(mediaSrc, new RegExp(source.replace('.', '\\.')));
  }
  const connectSources = directive(metaPolicy, 'connect-src').split(/\s+/).slice(1);
  assert.ok(connectSources.includes("ipc://localhost"));
  assert.ok(connectSources.includes('https://ipc.localhost'));
  assert.ok(connectSources.includes('asset:'));
  assert.ok(connectSources.includes('https://dnxsksdoipdctstpqtsa.supabase.co'));
  assert.ok(connectSources.includes('http://127.0.0.1:3001'));
  assert.ok(connectSources.every((source) => !source.includes('*')));
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
