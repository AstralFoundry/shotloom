import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '../vendor/shotloom-director-desk/node_modules/playwright-core/index.mjs';

// Use a dedicated QA project: this creates and removes empty nodes, without generation.
const { SHOTLOOM_URL, SHOTLOOM_QA_CREDENTIALS, SHOTLOOM_QA_PROJECT } = process.env;
assert(SHOTLOOM_URL && SHOTLOOM_QA_CREDENTIALS && SHOTLOOM_QA_PROJECT,
  'Set SHOTLOOM_URL, SHOTLOOM_QA_CREDENTIALS (JSON file) and SHOTLOOM_QA_PROJECT');
const origin = new URL(SHOTLOOM_URL).origin;
const user = JSON.parse(await readFile(SHOTLOOM_QA_CREDENTIALS, 'utf8'));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole('button', { name: '使用 new-api 登录', exact: true }).click();
  await page.getByRole('textbox', { name: '用户名或电子邮件', exact: true }).fill(user.username);
  await page.getByRole('textbox', { name: '密码', exact: true }).fill(user.password);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL(`${origin}/**`);
  await page.locator('.project-canvas-tile').filter({ hasText: SHOTLOOM_QA_PROJECT }).click();
  await page.locator('.react-flow__node').first().waitFor();
  const close = page.getByRole('button', { name: '关闭助手', exact: true });
  if (await close.isVisible()) await close.click();
  const zoom = () => page.locator('.react-workflow-canvas').evaluate(element =>
    Number(element.style.getPropertyValue('--canvas-semantic-zoom')));
  const before = await zoom();
  const session = await context.newCDPSession(page);
  const touch = (type, points) => session.send('Input.dispatchTouchEvent', {
    type, touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 2, radiusY: 2, force: 1 })),
  });
  await touch('touchStart', [[120, 420], [260, 420]]);
  await touch('touchMove', [[80, 420], [300, 420]]);
  await touch('touchEnd', []);
  await page.waitForFunction(previous => Number(document.querySelector('.react-workflow-canvas')
    .style.getPropertyValue('--canvas-semantic-zoom')) > previous, before);
  assert.ok(Math.abs(await zoom() / before - 220 / 140) < 0.01, 'Canvas follows the finger distance ratio');
  assert.equal(await page.evaluate(() => visualViewport.scale), 1, 'The webpage itself must not zoom');
  console.log('PINCH_OK');

  for (const label of ['文本生成', '图片生成', '视频生成', '音频生成', '3D导演台', '剪辑', '创建分区']) {
    const ids = await page.locator('.react-flow__node').evaluateAll(elements => elements.map(element => element.dataset.id));
    await page.locator('.canvas-mobile-add-node').tap();
    await page.getByRole('menuitem', { name: label, exact: true }).tap();
    await page.waitForFunction(ids => [...document.querySelectorAll('.react-flow__node')]
      .some(element => !ids.includes(element.dataset.id)), ids);
    const added = await page.locator('.react-flow__node').evaluateAll((elements, ids) =>
      elements.map(element => element.dataset.id).find(id => !ids.includes(id)), ids);
    const section = label === '创建分区';
    const remove = section
      ? page.locator(`.react-flow__node[data-id="${added}"] .canvas-section-actions button`).last()
      : page.locator('.canvas-node-delete-action');
    try {
      const box = await remove.boundingBox();
      assert.ok(box && box.width >= 44 && box.height >= 44, `${label}: delete needs a 44px touch target`);
      if (section) {
        const icon = await remove.locator('svg').boundingBox();
        assert.ok(icon && icon.width >= 16 && icon.height >= 16, 'Section action icons remain legible when zoomed out');
      }
    } finally {
      await remove.tap();
      await page.waitForFunction(id => ![...document.querySelectorAll('.react-flow__node')]
        .some(element => element.dataset.id === id), added);
    }
    console.log('DELETE_OK', label);
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, [], 'No browser runtime errors');
  console.log('CANVAS_TOUCH_OK');
} finally {
  await browser.close();
}
