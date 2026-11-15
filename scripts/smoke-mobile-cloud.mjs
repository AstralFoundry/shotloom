import assert from 'node:assert/strict';
import { chromium } from '../vendor/shotloom-director-desk/node_modules/playwright-core/index.mjs';

const browser = await chromium.connectOverCDP(process.argv[2]);
// Run against an authenticated QA project containing a director node; no generation or deletion.
const preview = new URL(process.env.SHOTLOOM_URL || 'http://localhost:5173/');
const page = browser.contexts().flatMap(context => context.pages()).find(page => {
  const url = new URL(page.url());
  return url.origin === preview.origin && url.pathname === preview.pathname;
});
assert(page, 'authenticated local preview must be open');
const failures = [];
page.on('pageerror', error => failures.push(error.message));
await page.setViewportSize({ width: 390, height: 844 });
if (await page.getByRole('button', { name: '返回画布', exact: true }).count()) await page.getByRole('button', { name: '返回画布', exact: true }).click();
if (!await page.locator('.react-workflow-canvas').count()) await page.getByRole('button', { name: '项目画布', exact: true }).click();
await page.locator('.react-workflow-canvas').waitFor();
const closeAssistant = page.getByRole('button', { name: '关闭助手', exact: true });
if (await closeAssistant.isVisible()) await closeAssistant.click();
if (await page.locator('.canvas-material-picker').count()) await page.locator('.canvas-material-picker').getByRole('button', { name: '关闭', exact: true }).click();
await page.setViewportSize({ width: 390, height: 844 });
await page.locator('.director-node-placeholder').click({ position: { x: 20, y: 20 } });
await page.locator('.canvas-node-selection-toolbar').waitFor();
const sizes = [[320, 740], [390, 844], [844, 390], [1440, 1000]];
for (const [width, height] of sizes) {
  await page.setViewportSize({ width, height });
  const result = await page.evaluate(() => {
    const bounds = selector => document.querySelector(selector).getBoundingClientRect();
    const bar = bounds('.bottom-mode-switch');
    const assistant = bounds('.forge-agent-reopen');
    const overlap = bar.left < assistant.right && bar.right > assistant.left && bar.top < assistant.bottom && bar.bottom > assistant.top;
    const covered = [...document.querySelectorAll('.bottom-mode-switch button')].filter(button => {
      const rect = button.getBoundingClientRect();
      if (button.disabled || !rect.width || !rect.height) return false;
      return !button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    }).map(button => button.title);
    return { overlap, covered, barHeight: bar.height, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  assert.equal(result.overlap, false, `assistant must not cover tools at ${width}×${height}`);
  assert.deepEqual(result.covered, [], `all bottom tools reachable at ${width}×${height}`);
  assert.equal(result.overflow, false);
  if (width === 390) assert.ok(result.barHeight <= 56, '390px bottom tools stay in one row');
  if (width <= 920) {
    await page.locator('.canvas-node-selection-toolbar button[aria-haspopup="menu"]').first().click();
    const menu = page.locator('.canvas-node-toolbar-menu');
    await menu.waitFor();
    const menuBox = await menu.boundingBox();
    assert.ok(menuBox.x >= 0 && menuBox.y >= 0 && menuBox.x + menuBox.width <= width && menuBox.y + menuBox.height <= height, 'menu stays in viewport');
    for (const item of await menu.getByRole('menuitem').all()) {
      await item.scrollIntoViewIfNeeded();
      const box = await item.boundingBox();
      assert.ok(box.height >= 44, 'every menu action has a touch target');
      assert.ok(await item.evaluate(element => {
        const box = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      }), 'scrolled menu action is not covered');
    }
    await page.locator('.mobile-workspace-head strong').click();
  }
  console.log('canvas', width, height, result);
}
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole('button', { name: '打开资产中心', exact: true }).click();
for (const [width, height] of sizes) {
  await page.setViewportSize({ width, height });
  const picker = page.locator('.canvas-material-picker');
  await page.locator('.canvas-asset-popover-layer').evaluate(element => Promise.all(element.getAnimations({ subtree: true }).filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
  const box = await picker.boundingBox();
  for (const child of await picker.locator(':scope > *').all()) {
    const childBox = await child.boundingBox();
    assert.ok(childBox.x >= box.x - 1 && childBox.x + childBox.width <= box.x + box.width + 1, `asset contents fit panel at ${width}px`);
  }
  const bodyBox = await page.locator('.canvas-material-picker-body').boundingBox();
  assert.ok(bodyBox.height >= 44, `asset list remains scrollable at ${width}×${height}: ${JSON.stringify({ box, bodyBox })}`);
  await picker.getByRole('combobox', { name: '资产类型', exact: true }).click();
  const popup = page.locator('.ant-select-dropdown:visible').filter({ has: page.getByRole('option', { name: '其他文件', exact: true }) });
  await popup.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
  const popupBox = await popup.boundingBox();
  assert.ok(popupBox.x >= 0 && popupBox.x + popupBox.width <= width, 'asset dropdown fits horizontally');
  if (width <= 920) assert.ok((await popup.locator('.ant-select-item-option').first().boundingBox()).height >= 44, 'select options have touch targets');
  await page.getByRole('option', { name: '其他文件', exact: true }).click();
  await picker.getByRole('combobox', { name: '资产类型', exact: true }).click();
  await page.getByRole('option', { name: '全部类型', exact: true }).click();
  await picker.getByRole('combobox', { name: '资产排序', exact: true }).click();
  await page.getByRole('option', { name: '按名称', exact: true }).click();
  assert.equal(await picker.count(), 1, 'sorting must not dismiss asset directory');
  console.log('assets', width, height);
}
await page.locator('.canvas-material-picker').getByRole('button', { name: '关闭', exact: true }).click();
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole('button', { name: '视频剪辑', exact: true }).click();
await page.getByRole('navigation', { name: '编辑工作区' }).waitFor();
for (const label of ['时间线', '媒体', '剪辑']) {
  await page.getByRole('navigation', { name: '编辑工作区' }).getByRole('button', { name: label, exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  console.log('editor pane', label);
}
await page.getByRole('button', { name: '返回画布', exact: true }).click();
await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '我的', exact: true }).click();
await page.getByRole('button', { name: /^设置 / }).click();
assert.equal(await page.getByText('所有偏好自动保存在本机', { exact: true }).count(), 0);
assert.equal(await page.getByText('项目根目录', { exact: true }).count(), 0);
for (const name of ['通用', '画布', '可用模型', 'Agent']) {
  await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name, exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  console.log('settings', name);
}
await page.getByRole('button', { name: '完成', exact: true }).click();
assert.deepEqual(failures, [], 'no browser runtime errors');
console.log('MOBILE_LAYOUT_OK');
process.exit(0);
