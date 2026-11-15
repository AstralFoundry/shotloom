import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from '../vendor/shotloom-director-desk/node_modules/playwright-core/index.mjs';

// Real view components with delayed controllers; no project or Agent network writes.
const bundle = await build({
  stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { ProjectsView } from './renderer/src/app/views/ProjectsView';
    import { DirectorAgentPane } from './renderer/src/app/agent-chat/DirectorAgentPane';
    let release;
    window.qa = { calls: [], finish(error) { release(error); }, projects() {
      const folder = { kind:'folder', folderDir:'/qa', name:'QA', children:[] };
      createRoot(document.getElementById('root')).render(<ProjectsView entries={[folder]} initialFolderPath={['/qa']} controller={{
        createFolder: (...args) => wait('folder', args), createProject: (...args) => wait('canvas', args),
      }} />);
    }, director() {
      createRoot(document.getElementById('root')).render(<div className="director-workspace-host">
        <DirectorAgentPane className="director-workspace-agent" collapsed={false} onCollapsedChange={() => {}} />
      </div>);
    }};
    function wait(type, args) { window.qa.calls.push({type, args}); return new Promise((resolve, reject) => { release = error => error ? reject(new Error('QA failure')) : resolve(); }); }
  ` },
  bundle: true, write: false, format: 'iife', jsx: 'automatic',
  alias: { '@': `${process.cwd()}/renderer/src` },
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}', 'import.meta.glob': '__qaGlob' },
  banner: { js: 'var __qaGlob = () => ({});' },
  plugins: [{ name: 'chat-boundary', setup(build) {
    build.onLoad({ filter: /HarnessChatPanel\.tsx$/ }, () => ({ loader: 'tsx', contents: `
      import React from 'react';
      export function HarnessChatPanel({agentId}) { return <section className="harness-chat-panel" data-agent={agentId}>
        <div style={{flex:1}}>conversation</div><textarea aria-label="QA composer" style={{height:100,flexShrink:0}} />
      </section>; }
    ` }));
  } }], logLevel: 'silent',
});
const css = (await Promise.all(['renderer/styles/creation-view.css', 'renderer/styles/agent-session.css'].map(path => readFile(path, 'utf8')))).join('\n');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width:393, height:852 } });
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => console.error(error.message));
  await page.route('http://qa.local/**', route => route.fulfill({ contentType:'text/html', body:'<html></html>' }));
  async function mount(view) {
    await page.goto('http://qa.local');
    await page.setContent(`<style>html,body{margin:0;height:100%;}#root{height:700px;display:flex;flex-direction:column;overflow:hidden;}${css}</style><div id="root"></div>`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(view => window.qa[view](), view);
  }
  await mount('projects');
  for (const [label, type] of [['新建文件夹','folder'], ['新建画布','canvas']]) {
    const before = await page.evaluate(() => window.qa.calls.length);
    await page.getByRole('button', {name:label, exact:true}).click();
    const name = page.locator('.project-create-name');
    await name.fill(`QA ${type}`);
    await name.press('Enter');
    await page.waitForFunction(before => window.qa.calls.length === before + 1, before);
    assert.equal(await page.locator('.project-create-tile[aria-busy="true"]').count(), 1, `${type} shows pending feedback`);
    assert.equal(await name.isDisabled(), true);
    assert.equal(await page.getByRole('button', {name:label, exact:true}).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.qa.calls.length), before + 1, 'Enter and blur create once');
    await page.evaluate(() => window.qa.finish(true));
    await page.waitForFunction(() => document.querySelector('.project-create-name')?.disabled === false);
    assert.equal(await name.inputValue(), `QA ${type}`, 'failure preserves the name for retry');
    await name.press('Enter');
    await page.waitForFunction(before => window.qa.calls.length === before + 2, before);
    await page.evaluate(() => window.qa.finish());
    await page.locator('.project-create-tile').waitFor({state:'detached'});
  }
  for (const width of [393, 1440]) {
    await page.setViewportSize({width, height:852});
    await mount('director');
    const composer = page.getByRole('textbox', {name:'QA composer'});
    await composer.waitFor();
    const bounds = await composer.boundingBox();
    assert.ok(bounds.y + bounds.height <= 700, `composer must fit the workspace: ${JSON.stringify(bounds)}`);
    assert.equal(await page.locator('[data-agent]').getAttribute('data-agent'), 'canvas-primary');
  }
  console.log('PROJECT_DIRECTOR_UI_OK: pending project/canvas creation, canvas conversation, mobile/desktop composer bounds');
} finally { await browser.close(); }
