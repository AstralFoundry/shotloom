import { chromium } from 'playwright-core';
import fs from 'node:fs';
const exe = process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--no-sandbox','--enable-features=SharedArrayBuffer'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (msg) => { if (msg.type() === 'error') console.log('CONSOLE', msg.text().slice(0,300)); });
page.on('pageerror', (err) => console.log('PAGEERROR', String(err).slice(0,500)));
await page.goto('http://127.0.0.1:4173/?shotloom=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(5000);
const base64 = fs.readFileSync('/tmp/test-clip.mp4').toString('base64');
await page.evaluate((b64) => {
  window.__openreelMsgs = [];
  window.addEventListener('message', (e) => { if (e.data?.source === 'openreel') window.__openreelMsgs.push(e.data); });
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  window.postMessage({
    source: 'shotloom', type: 'load', payload: {
      name: '桥接媒体测试', width: 640, height: 360, fps: 30, duration: 3,
      assets: [{ key: 'a1', name: 'test-clip.mp4', type: 'video', mime: 'video/mp4', bytes: bytes.buffer }],
      tracks: [{ id: 't1', type: 'video', name: '主画面', clips: [{ id: 'c1', mediaKey: 'a1', start: 0, duration: 3, inPoint: 0, outPoint: 3, speed: 1, volume: 1 }], transitions: [] }],
    },
  }, '*', [bytes.buffer]);
}, base64);
await page.waitForTimeout(12000);
console.log('MSGS', JSON.stringify(await page.evaluate(() => window.__openreelMsgs)).slice(0,2000));
console.log('TEXT', (await page.locator('body').innerText().catch(()=>'')).slice(0,600));
await page.screenshot({ path: '/tmp/openreel-shotloom-media.png', fullPage: false });
await browser.close();
