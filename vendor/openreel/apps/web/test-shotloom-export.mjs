import { chromium } from 'playwright-core';
import fs from 'node:fs';
const exe = process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--no-sandbox','--enable-features=SharedArrayBuffer'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (msg) => { if (msg.type() === 'error') console.log('CONSOLE', msg.text().slice(0,300)); });
page.on('pageerror', (err) => console.log('PAGEERROR', String(err), err.stack?.slice(0,3000)));
await page.goto('http://127.0.0.1:4173/?shotloom=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(5000);
const base64 = fs.readFileSync('/tmp/test-clip.mp4').toString('base64');
await page.evaluate((b64) => {
  window.__openreelMsgs = [];
  window.__exportBuffer = null;
  window.addEventListener('message', (e) => {
    if (e.data?.source !== 'openreel') return;
    if (e.data.type === 'shotloom:exported') {
      window.__exportBuffer = e.data.buffer;
      window.__openreelMsgs.push({ type: e.data.type, size: e.data.size, mime: e.data.mime });
      return;
    }
    window.__openreelMsgs.push(e.data);
  });
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  window.postMessage({
    source: 'shotloom', type: 'load', payload: {
      name: '导出测试', width: 640, height: 360, fps: 30, duration: 2,
      assets: [{ key: 'a1', name: 'test-clip.mp4', type: 'video', mime: 'video/mp4', bytes: bytes.buffer }],
      tracks: [{ id: 't1', type: 'video', name: '主画面', clips: [{ id: 'c1', mediaKey: 'a1', start: 0, duration: 2, inPoint: 0, outPoint: 2, speed: 1, volume: 1 }], transitions: [] }],
    },
  }, '*', [bytes.buffer]);
}, base64);
await page.waitForFunction(() => window.__openreelMsgs?.some((m) => m.type === 'shotloom:loaded' || m.type === 'shotloom:error'), null, { timeout: 45000 });
await page.waitForTimeout(1000);
await page.evaluate(() => window.postMessage({ source: 'shotloom', type: 'export', settings: { width: 640, height: 360, fps: 30 } }, '*'));
for (let i=0;i<15;i++) {
  await page.waitForTimeout(2000);
  const done = await page.evaluate(() => window.__openreelMsgs.some(m => m.type === 'shotloom:exported' || m.type === 'shotloom:error'));
  if (done) break;
}
const msgs = await page.evaluate(() => window.__openreelMsgs.map(m => ({ type: m.type, phase: m.phase, progress: m.progress, error: m.error, size: m.size, mime: m.mime })));
console.log('MSGS', JSON.stringify(msgs).slice(0,3000));
const size = await page.evaluate(async () => window.__exportBuffer ? window.__exportBuffer.byteLength : 0);
console.log('EXPORTED SIZE', size);
await browser.close();
