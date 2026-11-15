import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '../vendor/shotloom-director-desk/node_modules/playwright-core/index.mjs';

// All API calls are intercepted: no real login, order, generation or project write.
const origin = process.env.SHOTLOOM_URL || 'http://localhost:5173';
const output = process.env.SHOTLOOM_SCREENSHOTS;
const id = 'a0000000-0000-4000-8000-000000000001';
const folderId = 'b0000000-0000-4000-8000-000000000001';
const directory = `cloud/projects/folders/${folderId}/${id}`;
const project = { schema: 'shotloom-project', schemaVersion: 2, id, name: 'Refresh QA',
  cloudFolderId: folderId,
  nodes: [{ id: 'director', type: 'threeDDirector', title: '3D 导演台', x: 100, y: 100, width: 640, height: 380 }],
  edges: [], tasks: [], settings: { autoSave: false }, canvasViewport: { x: 0, y: 0, zoom: 0.43 } };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  const unexpected = [];
  page.on('pageerror', error => errors.push(error.message));
  let authenticated = false;
  let releaseSession;
  let sessionGate = new Promise(resolve => { releaseSession = resolve; });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    let data;
    if (path === '/auth/me') {
      await sessionGate;
      return route.fulfill({ status: authenticated ? 200 : 401, json: { success: authenticated, data: { id: 'qa-user' } } });
    }
    if (path === '/relay/models') return route.fulfill({ json: { data: [] } });
    if (path === '/auth/account') data = { username: 'QA', app_quota: 100000, app_used_quota: 0 };
    else if (path === '/auth/topup/options') data = { quotaPerAmount: 500000 };
    else if (path === '/auth/topup') data = { checkoutUrl: 'https://checkout.example/order' };
    else if (path === '/auth/usage') data = { items: [], page: 1, page_size: 10, total: 0 };
    else if (path === '/settings') data = { locale: 'zh-CN' };
    else if (path === '/projects' || path === '/recent') data = [project];
    else if (path === '/library-folders') data = [{ id: folderId, parentId: null, name: 'QA folder' }];
    else if (path.startsWith('/catalog/')) data = {};
    else if (path === `/project/${id}`) data = project;
    else if (path === '/agent/connect') return; // Keep the actual connection UI loading.
    else { unexpected.push(path); return route.fulfill({ status: 500, json: { success: false, message: `Unexpected QA request: ${path}` } }); }
    return route.fulfill({ json: { success: true, data } });
  });
  await page.goto(`${origin}/?route=tasks&project=${encodeURIComponent(directory)}`);
  await page.locator('.cloud-session-loading').waitFor();
  assert.equal(await page.locator('.cloud-login-card').count(), 0);
  releaseSession();
  await page.locator('.cloud-login-card form').waitFor();
  assert.equal(await page.locator('input[name="redirect"]').inputValue(), page.url());
  if (output) {
    await mkdir(output, { recursive: true });
    await page.screenshot({ path: `${output}/login-mobile.png` });
  }
  authenticated = true;
  sessionGate = Promise.resolve();
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.app-shell.route-tasks'));
  assert.equal(new URL(page.url()).searchParams.get('project'), directory);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.app-shell.route-tasks'));
    assert.equal(new URL(page.url()).searchParams.get('project'), directory);
    assert.ok(await page.getByText('Refresh QA', { exact: true }).count(), 'restored project is visible');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.waitForURL(url => url.searchParams.get('route') === 'account');
  await page.reload();
  await page.locator('.account-view').waitFor();
  await page.locator('.account-topup-trigger').click();
  await page.locator('.account-topup form > button').click();
  const payment = page.locator('.account-payment-handoff a');
  await payment.waitFor();
  assert.equal(await payment.getAttribute('href'), 'https://checkout.example/order');
  assert.equal(await payment.getAttribute('target'), '_blank');
  assert.equal(await page.locator('.account-topup iframe').count(), 0);
  await page.context().route('https://checkout.example/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>QA checkout</h1>' }));
  const openedPayment = page.waitForEvent('popup');
  await payment.click();
  const popup = await openedPayment;
  await popup.waitForLoadState();
  assert.equal(popup.url(), 'https://checkout.example/order');
  assert.equal(await popup.evaluate(() => window.opener), null);
  await popup.close();
  await page.locator('.account-topup-close').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '项目画布', exact: true }).click();
  await page.locator('.director-node-label input').waitFor();
  const title = await page.locator('.director-node-label input').evaluate(input => ({
    size: parseFloat(getComputedStyle(input).fontSize), weight: getComputedStyle(input).fontWeight,
  }));
  assert.ok(title.size < 16, `node title follows canvas zoom: ${JSON.stringify(title)}`);
  assert.equal(title.weight, '400');
  const reopen = page.getByRole('button', { name: '打开助手', exact: true });
  if (await reopen.isVisible()) await reopen.click();
  await page.locator('.harness-connection-loading').waitFor();
  if (output) await page.screenshot({ path: `${output}/agent-mobile.png` });
  assert.deepEqual(unexpected, []);
  assert.deepEqual(errors, []);
  console.log('SESSION_UI_OK: login check, OAuth return, project/page refresh, payment handoff, mobile title, Agent loading');
} finally { await browser.close(); }
