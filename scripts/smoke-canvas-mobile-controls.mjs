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
      React.useEffect(() => { window.chatMounts = (window.chatMounts || 0) + 1; onStatusChange?.('ready'); }, []);
      return React.createElement('section', {className:'harness-chat-panel', hidden},
        React.createElement('button', {onClick:onClose}, 'Close test assistant'),
        React.createElement('textarea', {'aria-label':'Test draft'}));
    }`,
}));
await page.route('**/__canvas-mobile-test', route => route.fulfill({
  contentType: 'text/html; charset=utf-8',
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
await page.route('**/__canvas-params-test*', route => route.fulfill({
  contentType: 'text/html; charset=utf-8',
  body: `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div>
    <script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
    </script><script type="module">
    import React from '${reactUrl}';
    import ReactDOM from '${domUrl}';
    import {GenerationNodeComposer} from '/src/app/canvas/GenerationNodeComposer.tsx';
    import {AntdProvider} from '/src/app/ui/antd/AntdProvider.tsx';
    ${['/styles/tokens.css', '/styles.css', '/styles/canvas.css', '/styles/responsive.css'].map(path => `import '${path}';`).join('\n')}
    const params = [
      {key:'duration', label:'时长', default:5, options:[5,6,7,8,9,10,11,12,13,14,15]},
      {key:'aspectRatio', label:'比例', default:'9:16', options:['16:9','9:16','1:1','4:3','3:4']},
      {key:'resolution', label:'分辨率', default:'480p', options:['480p','720p','1K','2K']},
      {key:'seed', label:'种子', type:'number', default:0},
      {key:'note', label:'备注', type:'text', default:''},
    ];
    function Fixture() {
      const [config, setConfig] = React.useState({});
      const promptRef = React.useRef(null);
      const node = {id:'test', type:location.search.includes('image') ? 'imageGeneration' : 'videoGeneration', prompt:'跳个舞'};
      const state = {config, params, summaryParams:params, inputModes:[], mediaInputs:[], fixedImageSlots:[], models:[], selectedModel:'MiniMax Hailuo', kind:'video', busy:false};
      const actions = {listReferenceCandidates:() => [], update:(_id, patch) => { if (patch.config) setConfig(patch.config); }};
      return React.createElement('div', {style:{width:'min(570px, calc(100vw - 24px))',margin:'24px auto'}},
        React.createElement(GenerationNodeComposer, {node,state,actions,promptRef}));
    }
    ReactDOM.createRoot(document.getElementById('app')).render(React.createElement(AntdProvider,null,React.createElement(Fixture)));
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
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({reducedMotion: theme === 'dark' ? 'reduce' : 'no-preference'});
    for (const [width, height] of [[375, 667], [430, 932], [844, 390], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      await page.goto(`${base}/__canvas-params-test?image`);
      await page.locator('.generation-settings-trigger').waitFor();
      await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), theme === 'dark');
      const mobile = width <= 920;
      const trigger = page.getByRole('button', {name:'生成参数', exact:true});
      if (mobile) {
        assert.equal(await trigger.innerText(), '生成参数');
        for (const selector of ['.generation-settings-trigger', '.work-model-trigger', '.work-camera-btn', '.work-run-btn']) {
          const box = await page.locator(selector).boundingBox();
          assert.ok(box.height >= 44 && box.width >= 44, `${selector} touch target at ${width}`);
        }
      }
      await trigger.click();
      const panel = page.locator('.generation-settings-panel');
      await panel.waitFor();
      assert.equal(await page.getByRole('dialog', {name:'生成参数'}).count(), mobile ? 1 : 0);
      const box = await panel.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width, 'parameter panel fits viewport');
      if (mobile) {
        assert.equal(await panel.evaluate(element => element.scrollWidth > element.clientWidth), false);
        for (const option of await panel.locator('.generation-settings-options button').all()) {
          const optionBox = await option.boundingBox();
          assert.ok(optionBox.width >= 44 && optionBox.height >= 44, 'parameter option touch target');
        }
        await panel.getByRole('button', {name:'9:16', exact:true}).click();
        await panel.getByRole('button', {name:'16:9', exact:true}).click();
        assert.equal(await panel.getByRole('button', {name:'16:9', exact:true}).getAttribute('aria-pressed'), 'true');
        await panel.getByRole('textbox', {name:'备注'}).fill('保留参数');
        await page.keyboard.press('Escape');
        await panel.waitFor({state:'detached'});
        await page.waitForFunction(() => document.activeElement?.classList.contains('generation-settings-trigger'));
        await trigger.click();
        assert.equal(await panel.getByRole('textbox', {name:'备注'}).inputValue(), '保留参数');
        assert.equal(await panel.getByRole('button', {name:'16:9', exact:true}).getAttribute('aria-pressed'), 'true');
        if (width === 375) {
          await page.setViewportSize({width:1024, height:768});
          await page.getByRole('dialog', {name:'生成参数'}).waitFor({state:'detached'});
          await panel.waitFor();
          await page.setViewportSize({width, height});
          await page.getByRole('dialog', {name:'生成参数'}).waitFor();
          assert.equal(await panel.getByRole('textbox', {name:'备注'}).inputValue(), '保留参数');
        }
        await page.locator('.generation-settings-sheet .ant-drawer-close').click();
        await panel.waitFor({state:'detached'});
      }
      console.log('parameters', theme, width, height, 'OK');
    }
  }
  assert.deepEqual(failures, []);
  console.log('CANVAS_MOBILE_CONTROLS_OK');
} catch (error) {
  console.error((await page.locator('body').innerText()).slice(0, 1500));
  throw error;
} finally {
  if (failures.length) console.error(failures);
  await browser.close();
}

