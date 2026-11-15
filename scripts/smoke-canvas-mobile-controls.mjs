import assert from 'node:assert/strict';
import { chromium } from '../vendor/shotloom-director-desk/node_modules/playwright-core/index.mjs';

// Exercise the real canvas and parent lifecycle without a paid model or cloud account.
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-features=LocalNetworkAccessChecks'] });
const page = await browser.newPage();
const failures = [];
const base = process.env.SHOTLOOM_URL || 'http://localhost:5173';
const main = await (await fetch(`${base}/src/main.tsx`)).text();
const reactUrl = main.match(/from "([^"]*\/react\.js[^\"]*)"/)[1];
const domUrl = main.match(/from "([^"]*\/react-dom_client\.js[^\"]*)"/)[1];
page.on('pageerror', error => failures.push(error.message));
page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
await page.route('**/src/app/agent-chat/HarnessChatPanel.tsx*', route => route.fulfill({
  contentType: 'application/javascript',
  body: `import React from '${reactUrl}';
    export function HarnessChatPanel({onClose, onStatusChange, hidden}) {
      React.useEffect(() => { window.chatMounts = (window.chatMounts || 0) + 1; onStatusChange('ready'); }, []);
      return React.createElement('section', {className:'harness-chat-panel', hidden},
        React.createElement('button', {onClick:onClose}, 'Close test assistant'),
        React.createElement('textarea', {'aria-label':'Test draft'}));
    }`,
}));
await page.route('**/__canvas-mobile-test', route => route.fulfill({
  contentType: 'text/html',
  body: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div>
    <script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
    </script><script type="module">
    import React from '${reactUrl}';
    import ReactDOM from '${domUrl}';
    import {CreationView} from '/src/app/views/CreationView.tsx';
    import {AntdProvider} from '/src/app/ui/antd/AntdProvider.tsx';
    ${['/styles/tokens.css', '/styles.css', '/styles/app-shell.css', '/styles/workbench.css', '/styles/agent-session.css', '/styles/canvas.css', '/styles/creation-view.css', '/styles/responsive.css'].map(path => `import '${path}';`).join('\n')}
    const noop = () => {};
    const controller = {nodes:{}, canvas: {saveViewport:noop, selectNodes:noop, selectEdge:noop, createNodeAt:noop}, undo:noop, redo:noop, autoLayout:noop, mergeVideos:noop, loadMaterials: async () => []};
    const data = {nodes:[], edges:[], viewport:{x:0,y:0,zoom:1}, history:{canUndo:true,canRedo:true}, shortcutLabels:{fitView:'F',autoLayout:'L'}};
    ReactDOM.createRoot(document.getElementById('app')).render(React.createElement(AntdProvider, null,
      React.createElement('div', {className:'app-shell', style:{display:'block',height:'100dvh'}}, React.createElement(CreationView, {data,controller}))));
    </script></body></html>`,
}));
try {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(`${process.env.SHOTLOOM_URL || 'http://localhost:5173'}/__canvas-mobile-test`);
  await page.locator('.forge-lite-main:not([inert])').waitFor();
  for (const [width, height] of [[320, 568], [375, 667], [390, 844], [844, 390], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    const layout = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      return {top:rect('.canvas-corner-controls').height, bottom:rect('.bottom-mode-switch').height, overflow:document.documentElement.scrollWidth > innerWidth};
    });
    assert.ok(layout.top <= 56 && layout.bottom <= 56, `tools must stay in one row at ${width}×${height}: ${JSON.stringify(layout)}`);
    assert.equal(layout.overflow, false);
    if (width <= 920) {
      await page.locator('.canvas-mobile-add-node').click();
      const menu = page.locator('.canvas-context-menu');
      await menu.waitFor();
      const addBox = await page.locator('.canvas-mobile-add-node').boundingBox();
      const menuBox = await menu.boundingBox();
      assert.ok(menuBox.y >= addBox.y + addBox.height, 'add menu opens below its trigger');
      for (const item of await menu.getByRole('menuitem').all()) {
        await item.scrollIntoViewIfNeeded();
        assert.ok(await item.evaluate(element => {
          const box = element.getBoundingClientRect();
          return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
        }), `add menu item must not be covered at ${width}×${height}`);
      }
      await page.locator('.react-flow__pane').click({ position: { x: width - 20, y: height / 2 } });
      await page.locator('.canvas-display-settings .canvas-tools-more').click();
      await page.getByRole('menuitem', { name: '画布设置', exact: true }).click();
      await page.getByRole('dialog', { name: '画布设置', exact: true }).waitFor();
      await page.locator('.canvas-display-panel header button').click();
      await page.locator('.bottom-mode-switch .canvas-tools-more').click();
      await page.getByRole('menuitem', { name: '整理节点', exact: true }).click();
      await page.locator('.canvas-layout-menu').waitFor();
      await page.locator('.bottom-mode-switch .canvas-tools-more').click();
      await page.getByRole('menuitem', { name: '整理节点', exact: true }).click();
    }
    console.log('layout', width, height, layout);
  }
  await page.setViewportSize({ width: 375, height: 667 });
  await page.locator('.forge-agent-reopen').click();
  await page.getByRole('textbox', {name:'Test draft'}).fill('keep my draft');
  const mounts = await page.evaluate(() => window.chatMounts);
  await page.getByRole('button', {name:'Close test assistant'}).click();
  assert.equal(await page.getByRole('textbox', {name:'Test draft'}).isVisible(), false);
  await page.locator('.forge-agent-reopen').click();
  assert.equal(await page.evaluate(() => window.chatMounts), mounts, 'reopening must not remount assistant');
  assert.equal(await page.getByRole('textbox', {name:'Test draft'}).inputValue(), 'keep my draft');
  assert.deepEqual(failures, []);
  console.log('CANVAS_MOBILE_CONTROLS_OK');
} catch (error) {
  console.error((await page.locator('body').innerText()).slice(0, 1500));
  throw error;
} finally {
  if (failures.length) console.error(failures);
  await browser.close();
}

