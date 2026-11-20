import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';

test('real browser runs official UI, tool continuation and durable Worker history', { skip: process.env.SHOTLOOM_BROWSER_TESTS !== '1', timeout: 120000 }, async t => {
  const root = fileURLToPath(new URL('../../../renderer/public/', import.meta.url));
  const html = await readFile(new URL('../../../renderer/index.html', import.meta.url), 'utf8');
  const policy = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)[1];
  const server = createServer(async (req, res) => {
    try {
      res.setHeader('Content-Security-Policy', policy);
      const path = new URL(req.url, 'http://localhost').pathname;
      if (path === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html><body><div id="chat" style="height:700px"></div><script type="module" src="/probe.mjs"></script></body></html>'); return; }
      const file = path === '/probe.mjs' ? fileURLToPath(new URL('fixtures/worker-probe.mjs', import.meta.url)) : resolve(root, '.' + path);
      if (path !== '/probe.mjs' && !file.startsWith(root)) throw new Error('Outside fixture');
      res.setHeader('content-type', ['.mjs', '.js'].includes(extname(file)) ? 'text/javascript' : extname(file) === '.css' ? 'text/css' : 'application/octet-stream');
      res.end(await readFile(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const { chromium } = await import('../../../vendor/shotloom-director-desk/node_modules/playwright-core/index.mjs');
  const instance = await chromium.launch({ headless: true }).catch(() => chromium.launch({ headless: true, channel: 'chrome' }));
  t.after(() => instance.close());
  const page = await instance.newPage();
  const evaluate = source => page.evaluate('(async()=>(' + source + '))()');
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.probe && (probe.ready || probe.errors.length), undefined, { timeout: 30000 });
  assert.deepEqual(await evaluate('probe.errors'), []);
  const sessionId = await evaluate('probe.sessionId');
  await evaluate('probe.prompt()');
  await page.waitForFunction(() => probe.models >= 2 || probe.errors.length > 0, undefined, { timeout: 30000 });
  await page.waitForFunction(() => document.getElementById("chat").shadowRoot?.textContent.includes("Worker tool roundtrip passed") || probe.errors.length > 0, undefined, { timeout: 30000 });
  assert.deepEqual(await evaluate('probe.errors'), []);
  assert.equal(await evaluate('probe.tools'), 1);
  await evaluate('window.persistenceCheck = setInterval(() => { probe.files().then(rows => { probe.persisted = rows.some(row => row.content.includes("Worker tool roundtrip passed")); }); }, 100)');
  await page.waitForFunction(() => probe.persisted === true || probe.errors.length > 0, undefined, { timeout: 30000 });
  assert.equal(await evaluate('(await probe.files()).some(row => row.content.includes("Worker tool roundtrip passed"))'), true, JSON.stringify(await evaluate('({errors:probe.errors,paths:(await probe.files()).map(row=>row.path)})')));
  await page.reload();
  await page.waitForFunction(() => window.probe && (probe.ready || probe.errors.length), undefined, { timeout: 30000 });
  assert.deepEqual(await evaluate('probe.errors'), []);
  assert.equal(await evaluate('probe.sessionId'), sessionId);
  assert.equal(await evaluate('probe.models'), 0);
  assert.equal(await evaluate('(await probe.files()).some(row => row.content.includes("Worker tool roundtrip passed"))'), true);
  await evaluate('probe.imagePrompt()');
  try { await page.waitForFunction(() => probe.images > 0 || probe.errors.length > 0, undefined, { timeout: 30000 }); }
  catch (error) {
    const detail = await evaluate('({models:probe.models,errors:probe.errors,events:(await probe.files()).filter(row=>row.path.includes("events/")).map(row=>JSON.parse(row.content)).filter(row=>/error|reject|failed/i.test(JSON.stringify(row))).slice(-6)})');
    throw new Error(JSON.stringify(detail), { cause: error });
  }
  assert.deepEqual(await evaluate('probe.errors'), []);
  assert.ok(await evaluate('probe.images > 0'));
  assert.deepEqual(await evaluate('probe.archive(true)'), { sessionIds: [sessionId] });
  assert.deepEqual(await evaluate('probe.archive(false)'), { sessionIds: [sessionId] });
});
