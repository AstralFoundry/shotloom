import assert from 'node:assert/strict';
import { access, writeFile } from 'node:fs/promises';

// Visual test only: the isolated session has no paid gateway credentials.
// Project loading/saving and authentication continue to use the live API.
function fixture(path) {
  if (path === '/api/auth/account') return { username: 'Android login acceptance', app_quota: 100000, app_used_quota: 10000 };
  if (path === '/api/models') return { publications: [], upstreamModels: [] };
}
if (process.argv.includes('--self-test')) {
  assert.equal(fixture('/api/auth/me'), undefined);
  assert.equal(fixture('/api/project/test'), undefined);
  assert.deepEqual(fixture('/api/models'), { publications: [], upstreamModels: [] });
  console.log('Canvas visual fixtures only intercept account display and model discovery');
  process.exit(0);
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let target;
for (let i = 0; i < 180; i++) {
  try {
    target = (await (await fetch('http://127.0.0.1:9222/json')).json()).find(item => item.url.startsWith('https://shotloom.0xfiang.com/?') && item.url.includes('project='));
    if (target) break;
  } catch { /* WebView is still starting. */ }
  await pause(500);
}
assert.ok(target, 'Project WebView was not exposed by test instrumentation');
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
const source = `(() => {
  const fixture = ${fixture.toString()};
  window.__canvasVisualFixtureHits = {};
  const original = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const value = url.origin === location.origin ? fixture(url.pathname) : undefined;
    if (value !== undefined) {
      window.__canvasVisualFixtureHits[url.pathname] = (window.__canvasVisualFixtureHits[url.pathname] || 0) + 1;
      return Promise.resolve(new Response(JSON.stringify({success:true,data:value}), {headers:{'Content-Type':'application/json'}}));
    }
    return original(input, init);
  };
})();`;
await command('Page.enable');
await command('Runtime.enable');
await command('Page.addScriptToEvaluateOnNewDocument', { source });
await command('Page.reload', { ignoreCache: true, scriptToEvaluateOnLoad: source });
const inspect = async () => {
  const result = await command('Runtime.evaluate', {
    expression: `JSON.stringify({ready:!!document.querySelector('.react-flow__viewport'),width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,transform:document.querySelector('.react-flow__viewport')?.style.transform})`,
    returnByValue: true,
  });
  return JSON.parse(result.result.value);
};
let before;
for (let i = 0; i < 120; i++) {
  try { before = await inspect(); if (before.ready) break; } catch { /* Navigation replaces the JS context. */ }
  await pause(500);
}
if (!before?.ready) {
  const result = await command('Runtime.evaluate', {
    expression: `JSON.stringify({url:location.href,text:document.body.innerText.slice(0,1800),fixtures:window.__canvasVisualFixtureHits,authStatus:await fetch('/api/auth/me',{credentials:'include'}).then(r=>r.status)})`,
    returnByValue: true, awaitPromise: true,
  });
  await writeFile('acceptance/canvas-diagnostic.json', JSON.stringify(result));
}
assert.ok(before?.ready, 'Canvas did not mount');
assert.ok(before.scrollWidth <= before.width, 'Canvas causes horizontal page overflow');
await writeFile('acceptance/canvas-ready.json', JSON.stringify(before));
console.log('CANVAS_READY', JSON.stringify(before));
async function marker(name) {
  for (let i = 0; i < 120; i++) {
    try { await access(`acceptance/${name}.marker`); return; } catch { await pause(500); }
  }
  throw new Error(`Android gesture was not performed: ${name}`);
}
await marker('canvas-zoom');
const zoomed = await inspect();
assert.notEqual(zoomed.transform, before.transform, 'Android zoom did not change the canvas viewport');
await writeFile('acceptance/canvas-zoom.json', JSON.stringify(zoomed));
await marker('canvas-pan');
const after = await inspect();
assert.notEqual(after.transform, zoomed.transform, 'Android pan did not move the canvas viewport');
assert.equal(after.transform.match(/scale\([^)]+\)/)?.[0], zoomed.transform.match(/scale\([^)]+\)/)?.[0], 'Pan unexpectedly changes zoom');
await writeFile('acceptance/canvas-interaction.json', JSON.stringify({ before, zoomed, after, fixtures: ['/api/auth/account', '/api/models'] }));
console.log('CANVAS_INTERACTION_PASSED', JSON.stringify(after));
ws.close();
