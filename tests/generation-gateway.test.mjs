import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('画布模型请求统一进入原生 Generation Gateway', () => {
  const api = read('renderer/src/services/tauriApi.js');
  assert.match(api, /generation_request/);
  assert.match(api, /generation_stream/);
  assert.match(api, /generation_download/);
  assert.match(api, /generation_cancel/);
  assert.doesNotMatch(api, /nativeFetch/);
  assert.doesNotMatch(api, /requestWithDeadline/);
  assert.doesNotMatch(api, /file:download-url/);
});

test('Generation Gateway 在原生层持有凭据、代理、multipart 和取消边界', () => {
  const rust = read('src-tauri/src/commands/generation_gateway.rs');
  assert.match(rust, /app-settings\.json/);
  assert.match(rust, /providerConfigs/);
  assert.match(rust, /"starrouter" => "https:\/\/starrouter\.io\/v1"/);
  assert.match(rust, /"minimax" => "https:\/\/api\.minimax\.io"/);
  assert.match(rust, /resolved_system_proxy_url/);
  assert.match(rust, /multipart::Form/);
  assert.match(rust, /generation_cancel/);
  assert.match(rust, /request\s*\.path/);
  assert.match(rust, /request_url\(&base_url, path/);
  assert.match(rust, /BLOCKED_HEADERS/);
  assert.match(rust, /模型请求必须使用相对 endpoint path/);
  assert.match(rust, /response_encoding/);
  assert.match(rust, /body_base64/);
  assert.match(rust, /BASE64\.encode\(&bytes\)/);
  const api = read('renderer/src/services/tauriApi.js');
  assert.match(api, /responseEncoding === 'binary'/);
  assert.match(api, /__responseBodyBase64/);
});

test('项目不再分发 WebView HTTP 插件与网络权限', () => {
  const pkg = JSON.parse(read('package.json'));
  const cargo = read('src-tauri/Cargo.toml');
  const lib = read('src-tauri/src/lib.rs');
  const capability = read('src-tauri/capabilities/default.json');
  assert.equal(pkg.dependencies['@tauri-apps/plugin-http'], undefined);
  assert.doesNotMatch(cargo, /tauri-plugin-http/);
  assert.doesNotMatch(lib, /tauri_plugin_http/);
  assert.doesNotMatch(capability, /http:default/);
});
