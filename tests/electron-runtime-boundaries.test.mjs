import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, createWriteStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { createServer as createHttpServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { build } from 'esbuild';
import { ZipFile } from 'yazl';
import { readSource } from './helpers/sourceContract.mjs';

const root = mkdtempSync(join(tmpdir(), 'shotloom-boundaries-'));
test.after(() => rmSync(root, { recursive: true, force: true }));
const require = createRequire(import.meta.url);
let sequence = 0;
async function bundle(contents, plugins = []) {
  const outfile = join(root, `module-${sequence++}.cjs`);
  await build({ stdin: { contents, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'cjs', outfile, plugins, logLevel: 'silent' });
  return require(outfile);
}
const api = await bundle(`export * from './electron/core/gateway'; export * from './electron/core/db'; export * from './electron/core/storage'; export * from './electron/core/zip';`);

test('desktop plugin inspection supports test application versions without bypassing compatibility bounds', async () => {
  const { inspectProviderPackage } = await bundle(`export { inspectProviderPackage } from './electron/core/plugins';`);
  const manifest = JSON.parse(readSource('plugin-packages/examples/openai-compatible/manifest.json'));
  manifest.shotloom = '>=0.9.0, <1.0.0';
  const source = join(root, 'plugin-manifest.json');
  writeFileSync(source, JSON.stringify(manifest));
  for (const appVersion of ['0.9.2', '0.9.2-test20261117', '0.9.2-test.1']) {
    const result = await inspectProviderPackage({ appVersion }, source, 'npm');
    assert.equal(result.manifest.id, manifest.id);
  }
  for (const appVersion of ['0.8.9-test1', '1.1.0-test1']) {
    await assert.rejects(inspectProviderPackage({ appVersion }, source, 'npm'), /incompatible/);
  }
});

async function listen(t, handler) {
  const server = createHttpServer(handler);
  await new Promise(resolve => server.listen(0, resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
function environment(name, baseUrl) {
  const settingsFile = join(root, name + '.sqlite');
  api.withDatabase(settingsFile, db => api.saveSettings(db, { providerConfigs: { audit: { baseUrl, apiKey: 'fake-audit-key' } } }));
  return { appData: root, settingsFile };
}
function request(path = '/start') {
  return { requestId: 'audit', providerId: 'audit', path, scope: 'root', method: 'GET', headers: [], formFields: [], resources: [], timeoutMs: 5000, auth: { type: 'header', name: 'x-api-key' } };
}

test('gateway waits past 15 seconds for response headers within the request budget', async t => {
  const received = Promise.withResolvers();
  const provider = await listen(t, (_req, res) => received.resolve(res));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const result = api.runGenerationRequest(
    { ...request(), timeoutMs: 30_000 },
    environment('slow-response-headers', provider),
  );
  const response = await received.promise;
  t.mock.timers.tick(16_000);
  response.end('done');
  assert.equal((await result).body, 'done');
});

test('gateway still enforces the request budget while waiting for response headers', async t => {
  const received = Promise.withResolvers();
  const provider = await listen(t, () => received.resolve());
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const result = api.runGenerationRequest(request(), environment('response-deadline', provider));
  const rejected = assert.rejects(result, /请求超时/);
  await received.promise;
  t.mock.timers.tick(5_000);
  await rejected;
});

test('gateway blocks redirects to forbidden hosts before sending custom credentials', async t => {
  let reached = false;
  const target = await listen(t, (_req, res) => { reached = true; res.end('private'); });
  const forbidden = target.replace('127.0.0.1', 'localhost');
  const provider = await listen(t, (_req, res) => { res.writeHead(302, { location: forbidden }); res.end(); });
  await assert.rejects(api.runGenerationRequest(request(), environment('redirect-block', provider)), /shotloom:localized-error/);
  assert.equal(reached, false);
});

test('gateway preserves same-origin auth and strips custom auth across allowed origins', async t => {
  const received = [];
  const target = await listen(t, (req, res) => { received.push(req.headers['x-api-key']); res.end('done'); });
  const provider = await listen(t, (req, res) => {
    received.push(req.headers['x-api-key']);
    res.writeHead(302, { location: req.url === '/start' ? '/second' : target }); res.end();
  });
  const result = await api.runGenerationRequest(request(), environment('redirect-strip', provider));
  assert.equal(result.body, 'done');
  assert.deepEqual(received, ['fake-audit-key', 'fake-audit-key', undefined]);
});

test('gateway refuses replaying body credentials across origins and limits redirect loops', async t => {
  let reached = false;
  const target = await listen(t, (_req, res) => { reached = true; res.end('bad'); });
  const provider = await listen(t, (req, res) => { res.writeHead(req.url === '/loop' ? 302 : 307, { location: req.url === '/loop' ? '/loop' : target }); res.end(); });
  const env = environment('redirect-body', provider);
  await assert.rejects(api.runGenerationRequest({ ...request(), method: 'POST', body: { prompt: 'test' }, auth: { type: 'body', name: 'key' } }, env), /credential-bearing/);
  assert.equal(reached, false);
  await assert.rejects(api.runGenerationRequest(request('/loop'), env), /Too many/);
});

test('ZIP64 archives stream files, empty entries and bounded manifest reads', async () => {
  const archive = join(root, 'zip64.zip');
  const source = join(root, 'media.bin');
  writeFileSync(source, Buffer.alloc(4 * 1024 * 1024, 0x61));
  const writer = await api.StoredZipWriter.create(archive);
  await writer.addBuffer('manifest.json', Buffer.from('{"test":true}'));
  await writer.addBuffer('empty', Buffer.alloc(0));
  await writer.addFile('media.bin', source, (await stat(source)).size);
  await writer.close({ forceZip64Format: true });
  assert.ok(readFileSync(archive).includes(Buffer.from([0x50, 0x4b, 0x06, 0x06])));
  const reader = await api.StoredZipReader.open(archive, (await stat(archive)).size);
  assert.deepEqual(JSON.parse((await reader.readBuffer('manifest.json')).toString()), { test: true });
  assert.equal((await reader.readBuffer('empty')).length, 0);
  await assert.rejects(reader.readBuffer('media.bin'), /too large/);
  const output = join(root, 'extracted.bin');
  await pipeline(reader.read('media.bin'), createWriteStream(output));
  assert.equal((await stat(output)).size, 4 * 1024 * 1024);
});

test('ZIP64 reader reads a tiny manifest beyond 4GiB without loading the archive', { skip: process.platform === 'win32' }, async () => {
  // A sparse prefix exercises actual 64-bit offsets without writing gigabytes.
  const archive = join(root, 'sparse.zip');
  const zip = new ZipFile();
  const boundary = 2 ** 32;
  zip.outputStreamCursor = boundary;
  const completion = pipeline(zip.outputStream, createWriteStream(archive, { start: boundary }));
  zip.addBuffer(Buffer.from('{"large":true}'), 'manifest.json', { compress: false });
  zip.end();
  await completion;
  assert.ok((await stat(archive)).size > boundary);
  const reader = await api.StoredZipReader.open(archive, (await stat(archive)).size);
  assert.deepEqual(JSON.parse((await reader.readBuffer('manifest.json')).toString()), { large: true });
});

test('ZIP entry corruption rejects extraction rather than accepting damaged content', async () => {
  const archive = join(root, 'corrupt.zip');
  const writer = await api.StoredZipWriter.create(archive);
  await writer.addBuffer('entry.txt', Buffer.from('original'));
  await writer.close();
  const buffer = readFileSync(archive);
  const position = buffer.indexOf(Buffer.from('original'));
  const handle = await open(archive, 'r+');
  await handle.write(Buffer.from('changed!'), 0, 8, position); await handle.close();
  const reader = await api.StoredZipReader.open(archive, buffer.length);
  await assert.rejects(reader.readBuffer('entry.txt'), /integrity/);
});

test('Host restart fences old children and the tool bridge compares binding identity independently of key order', async () => {
  const children = [];
  const events = [];
  globalThis.__shotloomAuditContents = { isDestroyed: () => false, send: (...args) => events.push(args) };
  globalThis.__shotloomAuditSpawn = (...args) => {
    const child = new EventEmitter();
    Object.assign(child, { exitCode: null, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() {} });
    child.spawnOptions = args[2]; children.push(child); return child;
  };
  const host = await bundle(`export * from './electron/core/harness';`, [{ name: 'host-stubs', setup(b) {
    b.onResolve({ filter: /^(electron|node:child_process|node:fs)$/ }, args => ({ path: args.path, namespace: 'audit' }));
    b.onLoad({ filter: /.*/, namespace: 'audit' }, args => ({ contents: args.path === 'electron'
      ? `export const BrowserWindow={getAllWindows:()=>[{webContents:globalThis.__shotloomAuditContents}]};export const ipcMain={handle(){}};export const app={isPackaged:false,getAppPath:()=>process.cwd()};`
      : args.path === 'node:fs' ? `export const existsSync=()=>true;export const mkdirSync=()=>{};`
      : `export const spawn=(...args)=>globalThis.__shotloomAuditSpawn(...args);` }));
  } }]);
  try {
    const options = { sourceRoot: join(root, 'fake-host'), dataRoot: root };
    await host.startHarnessRuntime(options);
    const old = children[0];
    host.harnessTransport({ requestId: 'subscription', kind: 'stream' }, 'subscription-channel');
    host.harnessTransport({ requestId: 'fetch', kind: 'fetch' }, 'fetch-channel');
    const interrupted = host.setHarnessSessionsArchived('project', [], true).catch(String);
    await host.restartHarnessRuntime(options);
    assert.equal(await interrupted, 'Agent Host stopped');
    assert.equal(events.find(([, event]) => event.id === 'subscription-channel')[1].payload.kind, 'end');
    assert.equal(events.find(([, event]) => event.id === 'fetch-channel')[1].payload.kind, 'error');
    assert.notEqual(children[0].spawnOptions.env.SHOTLOOM_BRIDGE_TOKEN, children[1].spawnOptions.env.SHOTLOOM_BRIDGE_TOKEN);
    const fresh = host.setHarnessSessionsArchived('project', [], true);
    old.stdout.write('shotloom host: native\n'); old.exitCode = 0; old.emit('exit', 0);
    assert.equal(host.harnessStatus().ready, false);
    const message = JSON.parse(children[1].stdin.read().toString());
    children[1].stdout.write('shotloom transport: ' + JSON.stringify({ requestId: message.requestId, kind: 'result', value: 'new-host-result' }) + '\n');
    assert.equal(await fresh, 'new-host-result');
    assert.equal(host.harnessStatus().running, true);
    const binding = { projectKey: 'project', conversationId: 'conversation', agentId: 'director-primary', nodeId: 'director-node' };
    const bound = host.bindHarnessSession({ binding, tools: [] });
    const bindMessage = JSON.parse(children[1].stdin.read().toString());
    children[1].stdout.write('shotloom transport: ' + JSON.stringify({ requestId: bindMessage.requestId, kind: 'result', value: { sessionId: 'trusted-director' } }) + '\n');
    await bound;
    const bridge = host.harnessBridgeStatus();
    globalThis.__shotloomAuditContents.send = (name, request) => {
      if (name === 'shotloom:event:harness://tool-request') host.respondHarnessTool({ requestId: request.requestId, result: { reachedRenderer: true } });
    };
    const legacyOrder = { agentId: binding.agentId, conversationId: binding.conversationId, nodeId: binding.nodeId, projectKey: binding.projectKey, sessionId: 'trusted-director' };
    const call = async identity => {
      const response = await fetch(`http://127.0.0.1:${bridge.port}`, { method: 'POST', body: JSON.stringify({ op: 'tool', token: bridge.token, requestId: 'director-call', toolName: 'director_desk_snapshot', binding: identity }) });
      return { status: response.status, value: await response.json() };
    };
    assert.deepEqual(await call(legacyOrder), { status: 200, value: { success: true, result: { reachedRenderer: true } } });
    for (const field of ['sessionId', 'projectKey', 'conversationId', 'agentId', 'nodeId']) {
      assert.equal((await call({ ...legacyOrder, [field]: 'mismatched' })).status, 400, field);
    }
    const { nodeId: _nodeId, ...missingNode } = legacyOrder;
    assert.equal((await call(missingNode)).status, 400);
    assert.equal((await call({ ...legacyOrder, extra: 'unexpected' })).status, 400);
  } finally { host.shutdownHarnessRuntime(); delete globalThis.__shotloomAuditSpawn; delete globalThis.__shotloomAuditContents; }
});

test('system proxy cache refreshes after TTL and environment edits take effect immediately', async t => {
  const keys = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy'];
  const saved = keys.map(key => [key, process.env[key]]);
  for (const key of keys) delete process.env[key];
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  globalThis.__shotloomProxyOutput = '';
  const proxy = await bundle(`export * from './electron/core/proxy';`, [{ name: 'proxy-stub', setup(b) {
    b.onResolve({ filter: /^node:child_process$/ }, () => ({ path: 'child', namespace: 'audit' }));
    b.onLoad({ filter: /.*/, namespace: 'audit' }, () => ({ contents: `export const execFileSync=()=>globalThis.__shotloomProxyOutput;` }));
  } }]);
  try {
    assert.equal(proxy.resolvedSystemProxyUrl(), null);
    process.env.HTTPS_PROXY = 'http://127.0.0.1:18080';
    assert.equal(proxy.resolvedSystemProxyUrl(), process.env.HTTPS_PROXY);
    delete process.env.HTTPS_PROXY;
    assert.equal(proxy.resolvedSystemProxyUrl(), null);
    if (process.platform === 'darwin') {
      globalThis.__shotloomProxyOutput = 'HTTPEnable : 1\nHTTPProxy : 127.0.0.1\nHTTPPort : 18081';
      assert.equal(proxy.resolvedSystemProxyUrl(), null);
      now += 5001;
      assert.equal(proxy.resolvedSystemProxyUrl(), 'http://127.0.0.1:18081/');
      globalThis.__shotloomProxyOutput = ''; now += 5001;
      assert.equal(proxy.resolvedSystemProxyUrl(), null);
    }
  } finally {
    proxy.closeProxyAgent(); delete globalThis.__shotloomProxyOutput;
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});


test('ZIP write errors reject and abort releases the output stream', async () => {
  const writer = await api.StoredZipWriter.create(join(root, 'failed.zip'));
  await assert.rejects(writer.addFile('missing.bin', join(root, 'missing.bin'), 1), /ENOENT/);
  await writer.abort();
});
