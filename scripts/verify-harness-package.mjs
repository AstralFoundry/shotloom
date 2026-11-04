import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createInterface } from 'node:readline';

// Exercise the actual resource closure without borrowing the development Host.
const root = resolve('src-tauri/resources/agent-host');
const dataRoot = await mkdtemp(join(tmpdir(), 'shotloom-package-smoke-'));
const token = randomUUID();
let child;
const replies = new Map();
function request(kind, payload) {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { replies.delete(requestId); reject(new Error(`Native ${kind} timed out`)); }, 20000);
    replies.set(requestId, message => { clearTimeout(timeout); replies.delete(requestId); if (message.kind === 'error') reject(new Error(message.error)); else resolve(message.value); });
    child.stdin.write(JSON.stringify({ requestId, kind, payload }) + '\n');
  });
}
async function start() {
  child = spawn(join(root, process.platform === 'win32' ? 'node.exe' : 'node'), [join(root, 'dist/main.js')], {
    cwd: dataRoot,
    env: { ...process.env, SHOTLOOM_CONTENT_ROOT: join(root, 'content'), SHOTLOOM_RULES_PATH: join(root, 'AGENTS.md'),
      SHOTLOOM_DATA_ROOT: dataRoot, SHOTLOOM_BRIDGE_URL: 'http://127.0.0.1:1', SHOTLOOM_BRIDGE_TOKEN: token },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return await new Promise((resolve, reject) => {
    let stderr = '';
    const timeout = setTimeout(() => reject(new Error('Packaged Host startup timed out')), 20000);
    child.stderr.on('data', chunk => { stderr += chunk; });
    createInterface({ input: child.stdout }).on('line', line => {
      if (line === 'shotloom host: native') { clearTimeout(timeout); resolve(); }
      if (line.startsWith('shotloom transport: ')) {
        const message = JSON.parse(line.slice('shotloom transport: '.length));
        replies.get(message.requestId)?.(message);
      }
    });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Host exited ${code}: ${stderr}`)); });
  });
}
async function stop() {
  const exit = once(child, 'exit');
  child.stdin.end('shutdown\n');
  const [code] = await exit;
  assert.equal(code, 0);
  child = undefined;
}
const binding = { projectKey: 'package-smoke', conversationId: 'package-smoke', agentId: 'canvas-primary' };
async function session(sessionId) {
  const body = await request('bind', { binding, tools: [], skills: [], ...(sessionId ? { sessionId } : {}) });
  assert.ok(body.sessionId);
  const value = await request('fetch', { path: '/api/session/list', method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: 'session/list', payload: { args: { _request: {} } } })).toString('base64') });
  assert.equal(value.status, 200);
  const catalog = JSON.parse(Buffer.from(value.body, 'base64').toString()).result;
  assert.equal(catalog.ok, true, JSON.stringify(catalog));
  assert.ok(catalog.value.items.some(item => item.sessionId === body.sessionId));
  return body.sessionId;
}
try {
  await start();
  const id = await session();
  await stop();
  await start();
  assert.equal(await session(id), id);
  await stop();
  assert.equal((await readFile(join(dataRoot, 'agent.sqlite'))).subarray(0, 16).toString(), 'SQLite format 3\0');
  const persistedFiles = await readdir(dataRoot, { recursive: true });
  assert.deepEqual(persistedFiles.filter(path => /\.jsonl?$/.test(path)), [], 'Host must not persist JSON or JSONL business files');
  console.log('Packaged Node/Host native IPC, SQLite storage, no JSON business files, empty Session restart/resume and shutdown: PASS');
} finally {
  child?.kill('SIGKILL');
  await rm(dataRoot, { recursive: true, force: true });
}
