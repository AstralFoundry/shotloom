import assert from 'node:assert/strict';
import { access, writeFile } from 'node:fs/promises';

// Hold the real auth request during a background reload; never replace its result.
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
const target = targets.find(item => item.url === 'https://shotloom.0xfiang.com/native');
assert.ok(target, 'Session WebView missing');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
let blocked;
const pending = new Map();
ws.onmessage = event => {
  const data = JSON.parse(event.data);
  if (data.method === 'Fetch.requestPaused') blocked = data.params.requestId;
  if (data.id && pending.has(data.id)) {
    const { resolve, reject, timer } = pending.get(data.id);
    clearTimeout(timer); pending.delete(data.id);
    if (data.error) reject(new Error(JSON.stringify(data.error))); else resolve(data.result);
  }
};
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(requestId, { resolve, reject, timer });
    ws.send(JSON.stringify({ id: requestId, method, params }));
  });
}
try {
  await command('Page.enable');
  await command('Runtime.enable');
  await command('Fetch.enable', { patterns: [{ urlPattern: 'https://shotloom.0xfiang.com/api/auth/me', requestStage: 'Request' }] });
  await command('Page.reload', { ignoreCache: true });
  for (let i = 0; i < 100 && !blocked; i++) await pause(500);
  assert.ok(blocked, 'Reload did not request the real session');
  await writeFile('acceptance/session-reload-blocked.json', JSON.stringify({ authRequestHeld: true }));
  let released = false;
  for (let i = 0; i < 120; i++) {
    try { await access('acceptance/session-reload-release.marker'); released = true; break; } catch { await pause(500); }
  }
  assert.ok(released, 'Native screen was not checked during the blocked reload');
  await command('Fetch.continueRequest', { requestId: blocked });
  await command('Fetch.disable');
  let connected = false;
  for (let i = 0; i < 100; i++) {
    const result = await command('Runtime.evaluate', { expression: '!!window.__shotloomNativeRequest && !document.body.innerText.includes("正在检查登录状态") && !document.body.innerText.includes("Checking your session")', returnByValue: true });
    if (result.result.value) { connected = true; break; }
    await pause(500);
  }
  assert.ok(connected, 'Background session did not reconnect');
  await writeFile('acceptance/session-reload-passed.json', JSON.stringify({ realAuthResumed: true, nativeScreenVerifiedWhileAuthPending: true }));
} finally {
  await command('Fetch.disable').catch(() => {});
  ws.close();
}
