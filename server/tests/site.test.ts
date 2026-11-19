import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSiteApp } from '../src/site';

test('public pages are independent of auth and existing workspace links keep opening the app', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shotloom-site-'));
  try {
    await Promise.all(['index', 'home', 'download'].map(name => writeFile(join(directory, `${name}.html`), `<h1>${name}</h1>`)));
    await mkdir(join(directory, 'assets'));
    await writeFile(join(directory, 'assets', 'site.css'), 'body{margin:0}');
    await writeFile(join(directory, 'payment-return.html'), '<a href="shotloom-preview://payment/return">Return to app</a>');
    const app = createSiteApp(directory);
    for (const [path, page] of [['/', 'home'], ['/?utm_source=test', 'home'], ['/download', 'download'], ['/app', 'index'], ['/native', 'index'], ['/admin', 'index'], ...['native=embedded&project=fixture', 'native=prewarm', 'project=fixture', 'auth=error', 'route=account', 'panel=settings', 'folder=fixture'].map(query => [`/?${query}`, 'index'])]) {
      const response = await app.request(path!, { headers: { accept: 'text/html' } });
      assert.equal(response.status, 200, path);
      assert.equal(await response.text(), `<h1>${page}</h1>`, path);
      assert.equal(response.headers.get('cache-control'), 'no-cache');
    }
    for (const path of ['/api/missing', '/assets/missing.js']) {
      assert.equal((await app.request(path, { headers: { accept: 'application/json' } })).status, 404);
    }
    assert.equal((await app.request('/api/missing', { headers: { accept: 'text/html' } })).status, 404);
    assert.equal((await app.request('/assets/site.css')).status, 200);
    assert.equal((await app.request('/app')).status, 200);
    const returned = await app.request('/payment/return?status=success&redirect=https://attacker.example');
    assert.equal(returned.status, 200);
    assert.equal(await returned.text(), '<a href="shotloom-preview://payment/return">Return to app</a>');
    assert.equal(returned.headers.get('cache-control'), 'no-cache');
    for (const [path, destination] of [['/app/?project=fixture', '/app?project=fixture'], ['/download/', '/download']]) {
      const response = await app.request(path!);
      assert.equal(response.status, 308);
      assert.equal(response.headers.get('location'), destination);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
