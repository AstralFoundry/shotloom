import assert from 'node:assert/strict';
import { access, writeFile } from 'node:fs/promises';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
const target = targets.find(item => new URL(item.url).pathname === '/native');
assert.ok(target, 'Authenticated API bridge is available');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map();
ws.onmessage = event => {
  const data = JSON.parse(event.data);
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

let connected = false;
for (let attempt=0; attempt<60; attempt++) {
  try { const state = await command('Runtime.evaluate', {expression:'typeof window.__shotloomNativeRequest === \'function\'',returnByValue:true}); if (state.result.value) {connected=true;break;} } catch {}
  await pause(500);
}
assert.ok(connected, 'API bridge reconnected after real authentication');
await command('Runtime.evaluate', { expression: `(() => {
  window.__nativePageReads = {};
  const original = window.__shotloomNativeRequest;
  window.__shotloomNativeRequest = request => {
    if (request.method === 'GET' && request.path !== '/auth/me') window.__nativePageReads[request.path] = (window.__nativePageReads[request.path] || 0) + 1;
    return original(request);
  };
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    // Only display fixtures; authentication, settings reads and writes stay live.
    const value = url.origin !== location.origin ? undefined : url.pathname === '/api/models' ? {publications:[],upstreamModels:[]} : url.pathname === '/api/auth/usage' ? {items:[],total:0,page_size:10} : url.pathname === '/api/auth/account' ? {username:'Android native acceptance',app_quota:100000,app_used_quota:10000} : undefined;
    return value === undefined ? fetchOriginal(input, init) : Promise.resolve(new Response(JSON.stringify({success:true,data:value}),{headers:{'Content-Type':'application/json'}}));
  };
})()` });
await writeFile('acceptance/pages-attached.marker', 'ready');
async function marker(name) {
  for (let attempt=0; attempt<180; attempt++) {
    try { await access(`acceptance/${name}.marker`); return; } catch { await pause(1000); }
  }
  throw new Error(`Missing UI phase: ${name}`);
}
await marker('pages-warm');
await command('Runtime.evaluate', { expression: 'window.__nativePageReads = {}' });
await writeFile('acceptance/pages-counting.marker', 'ready');
await marker('pages-roundtrip');
const result = await command('Runtime.evaluate', { expression: 'JSON.stringify(window.__nativePageReads)', returnByValue:true });
const counts = JSON.parse(result.result.value);
assert.deepEqual(counts, {}, 'Two native tab roundtrips must reuse cached page data');
const settings = await command('Runtime.evaluate', { expression: `fetch('/api/settings/mobile',{credentials:'include'}).then(r=>r.json()).then(r=>JSON.stringify(r.data))`, returnByValue:true, awaitPromise:true });
assert.equal(JSON.parse(settings.result.value).agentAutoLayout, false, 'Native switch saved the actual account setting');
await writeFile('acceptance/pages-cache-passed.json', JSON.stringify({counts,settingsSaved:true}));
ws.close();
console.log('Native settings save and tab cache verified');
