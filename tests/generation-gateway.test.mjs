import assert from 'node:assert/strict';

import test from 'node:test';
import { readSource } from './helpers/sourceContract.mjs';

const read = (path) => readSource(path);

test('画布模型请求统一进入原生 Generation Gateway', () => {
  const api = read('renderer/src/services/tauriApi.ts');
  assert.match(api, /generation_request/);
  assert.match(api, /generation_stream/);
  assert.match(api, /generation_download/);
  assert.match(api, /generation_cancel/);
  assert.doesNotMatch(api, /nativeFetch/);
  assert.doesNotMatch(api, /requestWithDeadline/);
  assert.doesNotMatch(api, /file:download-url/);
  assert.doesNotMatch(api, /__apiKey|__baseUrl/);
});

test('Generation Gateway 在原生层持有凭据、主机边界、multipart 和取消边界', () => {
  const gateway = read('electron/core/gateway.ts');
  assert.match(gateway, /loadSettings/);
  assert.match(gateway, /providerConfigs/);
  // 地址唯一来源是设置里由厂商适配器写入的生效值，原生层不再维护厂商地址表，
  // 也不接受渲染进程携带的凭据覆盖。
  assert.doesNotMatch(gateway, /default_base_url|defaultBaseUrl\s*=/);
  assert.doesNotMatch(gateway, /pub base_url|pub api_key/);
  assert.match(gateway, /BLOCKED_HEADERS/);
  assert.match(gateway, /requestUrl\(/);
  assert.match(gateway, /resolveInputFile/);
  assert.match(gateway, /FormData/);
  assert.match(gateway, /cancelGenerationRequest/);
  assert.match(gateway, /responseEncoding/);
  assert.match(gateway, /bodyBase64/);
  const api = read('renderer/src/services/tauriApi.ts');
  assert.match(api, /responseEncoding === 'binary'/);
  assert.match(api, /__responseBodyBase64/);
  const commands = read('electron/ipc/commands/generation.ts');
  assert.match(commands, /generation-stream-event/);
});

test('项目不再分发 WebView HTTP 插件与网络权限', () => {
  const pkg = JSON.parse(read('package.json'));
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const name of ['@tauri-apps/plugin-http', '@tauri-apps/api', '@tauri-apps/cli']) {
    assert.equal(dependencies[name], undefined, name);
  }
  // 网络请求只发生在主进程网关；渲染进程没有任何 fetch/XHR 出口。
  const gateway = read('electron/core/gateway.ts');
  assert.match(gateway, /fetch\(/);
  assert.doesNotMatch(read('electron/preload.ts'), /fetch\(|XMLHttpRequest/);
});
