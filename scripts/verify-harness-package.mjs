import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';

// Exercise the actual resource closure without borrowing the development Host.
const root = resolve('src-tauri/resources/agent-host');
const dataRoot = await mkdtemp(join(tmpdir(), 'shotloom-package-smoke-'));
const token = randomUUID();
let child;
async function start() {
  child = spawn(join(root, process.platform === 'win32' ? 'node.exe' : 'node'), ['--max-http-header-size=65536', join(root, 'dist/main.js')], {
    cwd: dataRoot,
    env: { ...process.env, SHOTLOOM_CONTENT_ROOT: join(root, 'content'), SHOTLOOM_RULES_PATH: join(root, 'AGENTS.md'),
      SHOTLOOM_DATA_ROOT: dataRoot, SHOTLOOM_BRIDGE_URL: 'http://127.0.0.1:1', SHOTLOOM_BRIDGE_TOKEN: token },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return await new Promise((resolve, reject) => {
    let stdout = '', stderr = '';
    const timeout = setTimeout(() => reject(new Error('Packaged Host startup timed out')), 20000);
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdout.on('data', chunk => {
      stdout += chunk;
      const match = stdout.match(/shotloom host: (http:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
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
async function session(origin, sessionId) {
  const response = await fetch(`${origin}/shotloom/session`, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, 'content-type': 'application/json',
  }, body: JSON.stringify({ binding, tools: [], skills: [], ...(sessionId ? { sessionId } : {}) }) });
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.ok(body.sessionId);
  const login = await fetch(body.url, { redirect: 'manual' });
  assert.equal(login.status, 303);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const page = await fetch(new URL(body.url).origin, { headers: { cookie } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /client\.js/);
  // Loopback cookies are shared across ports, including old Host activations.
  const largeCookie = `${cookie}; previous-hosts=${'x'.repeat(20 * 1024)}`;
  assert.equal((await fetch(new URL(body.url).origin, { headers: { cookie: largeCookie } })).status, 200);
  const rejected = await fetch(new URL(body.url).origin, { headers: { cookie: `${cookie}; oversized=${'x'.repeat(70 * 1024)}` } });
  assert.equal(rejected.status, 431);
  return body.sessionId;
}
try {
  const id = await session(await start());
  await stop();
  assert.equal(await session(await start(), id), id);
  await stop();
  assert.equal((await readFile(join(dataRoot, 'agent.sqlite'))).subarray(0, 16).toString(), 'SQLite format 3\0');
  const persistedFiles = await readdir(dataRoot, { recursive: true });
  assert.deepEqual(persistedFiles.filter(path => /\.jsonl?$/.test(path)), [], 'Host must not persist JSON or JSONL business files');
  console.log('Packaged Node/Host/UI startup, SQLite storage, no JSON business files, empty Session restart/resume and shutdown: PASS');
} finally {
  child?.kill('SIGKILL');
  await rm(dataRoot, { recursive: true, force: true });
}
