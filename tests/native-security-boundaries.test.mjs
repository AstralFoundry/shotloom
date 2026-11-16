import assert from 'node:assert/strict';

import test from 'node:test';
import { readSource, readSources } from './helpers/sourceContract.mjs';

const read = (path) => readSource(path);

const metaPolicy = read('renderer/index.html').match(
  /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
)[1];

const directive = (policy, name) =>
  policy.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name} `));

test('CSP keeps script execution same-origin and blocks plugin objects', () => {
  assert.doesNotMatch(directive(metaPolicy, 'script-src'), /'unsafe-inline'|'unsafe-eval'/);
  assert.equal(directive(metaPolicy, 'object-src'), "object-src 'none'");
  assert.equal(directive(metaPolicy, 'base-uri'), "base-uri 'self'");
  assert.match(directive(metaPolicy, 'script-src'), /'self'/);
});

test('CSP allows local media through the Electron asset scheme only', () => {
  for (const name of ['img-src', 'media-src']) {
    const sources = directive(metaPolicy, name).split(/\s+/).slice(1);
    assert.ok(sources.includes('shotloom:'), `${name} must allow shotloom://asset`);
    assert.ok(sources.includes('blob:'), `${name} must allow blob previews`);
    assert.ok(sources.includes('data:'), `${name} must allow inline previews`);
    assert.ok(sources.every((source) => !source.includes('*')), `${name} must not allow wildcards`);
  }
  const connectSources = directive(metaPolicy, 'connect-src').split(/\s+/).slice(1);
  // 渲染进程没有任意网络出口：只放行同源、本地预览和登记过的服务地址。
  assert.ok(connectSources.every((source) => !source.includes('*')));
  assert.ok(!connectSources.some((source) => /^(wss?|https?):$/.test(source)));
  assert.ok(!connectSources.some((source) => source.startsWith('http://127.0.0.1') || source.startsWith('http://localhost:5')));
});

test('the renderer has no shell permission and opens paths only through the guarded command', () => {
  const pkg = JSON.parse(read('package.json'));
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
  assert.equal(dependencies['@tauri-apps/plugin-shell'], undefined);
  assert.equal(dependencies['@tauri-apps/cli'], undefined);
  const api = readSources([
    'renderer/src/services/tauriApi.ts',
    'electron/ipc/commands/files.ts',
  ]);
  assert.doesNotMatch(api, /@tauri-apps\/plugin-shell/);
  assert.match(api, /case 'file:open-path': return invoke\('file_open_path'/);
  // 打开路径必须经过 canonicalize + 目录/媒体边界，而不是直接把字符串交给系统。
  assert.match(read('electron/ipc/commands/files.ts'), /requireSafeOpenTarget\(target\)/);
  assert.match(read('electron/core/files.ts'), /EXECUTABLE_BUNDLE_SUFFIXES/);
});

test('the Electron preload is the only native bridge surface', () => {
  const preload = read('electron/preload.ts');
  assert.match(preload, /contextBridge\.exposeInMainWorld\('shotloomDesktop'/);
  assert.match(preload, /contextBridge\.exposeInMainWorld/);
  const main = read('electron/main.ts');
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.doesNotMatch(main, /webSecurity: false/);
  assert.match(main, /registerSchemesAsPrivileged/);
});

test('native commands reject foreign pages, subframes and detached senders', async () => {
  const { default: ts } = await import('typescript');
  const { runInNewContext } = await import('node:vm');
  const handlers = new Map();
  const contents = { mainFrame: { url: 'shotloom://app/index.html' } };
  const module = { exports: {} };
  const code = ts.transpileModule(read('electron/ipc/registry.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, {
    module, exports: module.exports, URL,
    process: { env: {} },
    require(name) {
      if (name === 'electron') return {
        ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
        BrowserWindow: { fromWebContents: value => value === contents ? {} : null },
      };
      if (name === '../core/errors') return { errorMessage: String };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const registry = module.exports;
  registry.defineCommand('secret', () => 'private data');
  registry.registerCommandChannel();
  const invoke = handlers.get('shotloom:command');
  const event = { sender: contents, senderFrame: contents.mainFrame };
  assert.equal((await invoke(event, 'secret', {})).value, 'private data');
  await assert.rejects(invoke({ ...event, senderFrame: { url: 'shotloom://app/index.html' } }, 'secret', {}), /Untrusted/);
  await assert.rejects(invoke({ ...event, sender: {} }, 'secret', {}), /Untrusted/);
  for (const url of ['https://example.com', 'data:text/html,test', 'shotloom://asset/file']) {
    contents.mainFrame.url = url;
    await assert.rejects(invoke(event, 'secret', {}), /Untrusted/);
  }
});
