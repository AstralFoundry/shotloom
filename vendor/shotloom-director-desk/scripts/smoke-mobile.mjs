import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const url = new URL(process.env.DIRECTOR_URL || 'http://127.0.0.1:5173');
    url.searchParams.set('theme', 'light');
    await page.goto(url.href);
    await page.waitForFunction(() => !!window.__editorDebug?.session.engine);
    assert.equal(await page.locator('.timeline').isVisible(), true);
    assert.equal(await page.locator('.clip--cut').count(), 1, 'the initial shot appears before adding another camera');

    for (const [width, height] of [[320, 568], [375, 575], [390, 844], [844, 390], [1440, 1000]]) {
        await page.setViewportSize({ width, height });
        await page.waitForFunction(() => document.querySelector('.editor').classList.contains('editor--narrow') === (innerWidth <= 860));
        const geometry = await page.evaluate(() => {
            const rect = selector => {
                const box = document.querySelector(selector).getBoundingClientRect();
                return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
            };
            return {
                overflow: document.documentElement.scrollWidth > innerWidth,
                stage: rect('.viewport'), timeline: rect('.timeline'), rail: rect('.sidebar__rail'),
                buttons: [...document.querySelectorAll('.topbar button')].filter(button => button.getBoundingClientRect().width > 0).map(button => ({
                    name: button.getAttribute('aria-label'), ...rectFor(button),
                })),
            };
            function rectFor(element) {
                const box = element.getBoundingClientRect();
                return { x: box.x, right: box.right, y: box.y, bottom: box.bottom, width: box.width, height: box.height };
            }
        });
        assert.equal(geometry.overflow, false, `no horizontal overflow at ${width}×${height}`);
        assert.ok(geometry.stage.width >= width - 400 && geometry.stage.height >= 100, 'stage stays usable');
        assert.ok(geometry.timeline.height >= 140 && geometry.timeline.bottom <= height, 'timeline stays in the viewport');
        for (const button of geometry.buttons) {
            assert.ok(button.x >= 0 && button.right <= width + 1 && button.y >= 0 && button.bottom <= height, `${button.name} stays reachable at ${width}px`);
            if (width <= 640) assert.ok(button.width >= 44 && button.height >= 44, `${button.name} has a phone touch target`);
        }
        if (width <= 640) {
            assert.equal(geometry.rail.width, width);
            assert.equal(geometry.rail.bottom, height, 'phone navigation stays at the bottom');
            assert.equal(geometry.stage.width, width);
            assert.ok(geometry.timeline.bottom <= geometry.rail.y, 'navigation does not cover timeline');
            const toolbar = page.locator('.viewport__toolbar');
            assert.ok((await toolbar.boundingBox()).height <= 60, 'phone toolbar stays in one row');
            assert.ok(await page.locator('.topbar').evaluate(element => element.getBoundingClientRect().height <= 56), 'phone header stays in one row');
            assert.ok(await page.locator('.timeline__transport').evaluate(element => element.getBoundingClientRect().height <= 56), 'playback controls leave room for tracks');
            for (const selector of ['.viewport__toolbar', '.timeline__controls', '.timeline__meta', '.timeline__body']) {
                assert.ok(await page.locator(selector).evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${selector} has no unnecessary horizontal scrolling at ${width}px`);
            }
            for (const button of await toolbar.getByRole('button').all()) {
                const box = await button.boundingBox();
                const bounds = await toolbar.boundingBox();
                assert.ok(box.x >= bounds.x - 1 && box.x + box.width <= bounds.x + bounds.width + 1, 'every stage tool is visible without scrolling');
            }
            await page.getByRole('button', { name: '更多工具', exact: true }).click();
            const tools = page.locator('.viewport__mobile-options');
            await tools.getByRole('button', { name: '旋转', exact: true }).click();
            assert.equal(await page.evaluate(() => window.__editorDebug.store.getState().transformMode), 'rotate');
            await page.getByRole('button', { name: '更多工具', exact: true }).click();
            await tools.getByRole('button', { name: '移动', exact: true }).click();
            await page.getByRole('dialog', { name: '更多工具', exact: true }).waitFor({ state: 'hidden' });
            if (width === 375) {
                await mkdir('tmp/smoke', { recursive: true });
                await page.mouse.move(1, 1);
                await page.getByRole('tooltip').waitFor({ state: 'hidden' });
                await page.screenshot({ path: 'tmp/smoke/mobile-director-375.png' });
            }
        }
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector('.editor').classList.contains('editor--narrow'));
    await page.getByRole('button', { name: '时间线选项', exact: true }).click();
    const settings = page.locator('.timeline__mobile-options');
    await settings.getByRole('combobox', { name: '项目帧率' }).waitFor();
    await settings.getByRole('spinbutton', { name: '时长', exact: true }).fill('20');
    await settings.getByRole('spinbutton', { name: '时长', exact: true }).press('Enter');
    assert.equal(await page.evaluate(() => window.__editorDebug.store.getState().project.duration), 20);
    await settings.getByRole('switch', { name: '循环', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__editorDebug.store.getState().loop), true);
    await settings.getByRole('slider').press('End');
    await page.waitForFunction(() => document.querySelector('.timeline__zoom-value').textContent === '800%');
    assert.ok(await page.locator('.timeline__body').evaluate(element => element.scrollWidth > element.clientWidth), 'zoomed tracks still scroll horizontally');
    await settings.getByRole('button', { name: '适合窗口', exact: true }).click();
    await settings.getByRole('button', { name: /角色动画/ }).click();
    await page.getByRole('tab', { name: '动作', exact: true }).waitFor();
    assert.equal(await page.getByRole('tab', { name: '动作', exact: true }).getAttribute('aria-selected'), 'true');
    await page.getByRole('button', { name: '跑步循环 4.0s ↻', exact: true }).click();
    assert.ok(await page.evaluate(() => window.__editorDebug.session.current().clips.some(clip => clip.action === 'run')), 'phone actions create real clips');
    await page.getByRole('button', { name: '隐藏属性面板', exact: true }).click();

    for (const name of ['场景', '资产', '添加机位', '运镜', '镜头']) {
        const tab = page.getByRole('navigation', { name: '侧栏面板' }).getByRole('button', { name, exact: true });
        await tab.click();
        assert.equal(await tab.getAttribute('aria-expanded'), 'true');
        const panel = await page.locator('#director-sidebar').boundingBox();
        const rail = await page.locator('.sidebar__rail').boundingBox();
        assert.equal(panel.width, 390);
        assert.ok(panel.y + panel.height <= rail.y + 1, `${name} stays above navigation`);
    }
    assert.ok(await page.locator('.shot-card').count() >= 1, 'shot storyboard remains available');
    await page.getByRole('navigation', { name: '侧栏面板' }).getByRole('button', { name: '镜头', exact: true }).click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.track-label')).width === '132px');
    const ruler = await page.locator('.lane--ruler').boundingBox();
    await page.mouse.click(ruler.x + ruler.width / 2, ruler.y + ruler.height / 2);
    const time = await page.evaluate(() => window.__editorDebug.store.getState().time);
    const duration = await page.evaluate(() => window.__editorDebug.store.getState().project.duration);
    assert.ok(Math.abs(time - duration / 2) < 0.1, `seeking uses the phone label width: ${JSON.stringify({ time, duration, ruler })}`);
    await page.setViewportSize({ width: 375, height: 575 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => window.__editorDebug.session.setTheme('dark'));
    await page.screenshot({ path: 'tmp/smoke/mobile-director-dark.png' });
    await page.getByRole('button', { name: '时间线选项', exact: true }).click();
    await page.getByRole('dialog', { name: '时间线选项', exact: true }).waitFor();
    assert.ok(await page.locator('.timeline__mobile-options').evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'options fit in dark mode with reduced motion');
    await page.getByRole('dialog', { name: '时间线选项', exact: true }).locator('.ant-drawer-close').click();
    await page.addStyleTag({ content: '.editor button, .sidebar__rail-item span { font-size: 20px !important; }' });
    assert.ok(await page.locator('.viewport__toolbar').evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'larger text keeps stage tools reachable');
    assert.deepEqual(errors, []);
    console.log('PASS: phone and desktop geometry, touch targets, bottom navigation, shot sequence, action editing and timeline seeking.');
} finally {
    await browser.close();
}
