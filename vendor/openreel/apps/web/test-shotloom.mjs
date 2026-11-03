import { chromium } from 'playwright-core';
const exe = process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--no-sandbox','--enable-features=SharedArrayBuffer'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (msg) => { if (msg.type() === 'error' || msg.type() === 'warning') console.log('CONSOLE', msg.type(), msg.text().slice(0,300)); });
page.on('pageerror', (err) => console.log('PAGEERROR', String(err).slice(0,500)));
await page.goto('http://127.0.0.1:4173/?shotloom=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);
console.log('TITLE', await page.title());
console.log('BODY', (await page.locator('body').innerText().catch(()=>'')).slice(0,500));
console.log('HAS_ROOT', await page.evaluate(() => !!document.getElementById('root')?.children.length));
await page.evaluate(() => {
  window.__openreelMsgs = [];
  window.addEventListener('message', (e) => { if (e.data?.source === 'openreel') window.__openreelMsgs.push(e.data); });
  window.postMessage({ source: 'shotloom', type: 'ping' }, '*');
});
await page.waitForTimeout(1000);
console.log('PING MSGS', await page.evaluate(() => window.__openreelMsgs));
await page.evaluate(() => {
  window.postMessage({ source: 'shotloom', type: 'load', payload: { name: '桥接测试', width: 1920, height: 1080, fps: 30, duration: 0, assets: [], tracks: [] } }, '*');
});
await page.waitForTimeout(5000);
console.log('LOAD MSGS', JSON.stringify(await page.evaluate(() => window.__openreelMsgs)).slice(0,1500));
console.log('HASH', await page.evaluate(() => location.hash));
console.log('TEXT2', (await page.locator('body').innerText().catch(()=>'')).slice(0,800));
await page.screenshot({ path: '/tmp/openreel-shotloom-test.png', fullPage: false });
await browser.close();
