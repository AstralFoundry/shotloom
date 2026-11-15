import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await page.goto(process.env.DIRECTOR_URL || 'http://127.0.0.1:5173');
    await page.waitForFunction(() => !!window.__editorDebug?.session.engine);
    for (const width of [320, 390, 640]) {
        await page.setViewportSize({ width, height: 844 });
        const rail = page.getByRole('navigation', { name: '侧栏面板' });
        for (const name of ['场景', '资产', '添加机位', '运镜', '镜头']) {
            const tab = rail.getByRole('button', { name, exact: true });
            await tab.tap();
            assert.equal(await tab.getAttribute('aria-expanded'), 'true');
            const stage = await page.locator('.viewport').boundingBox();
            assert.equal(stage.x, 0, `${name} at ${width}px: stage stays at the left edge`);
            assert.equal(stage.width, width, `${name} at ${width}px: stage stays full width`);
            for (const button of await rail.getByRole('button').all()) {
                assert.ok((await button.boundingBox()).width >= 44, `${name}: navigation tabs stay usable`);
            }
        }
        await rail.getByRole('button', { name: '镜头', exact: true }).tap();
        assert.equal(await page.locator('#director-sidebar').isVisible(), false);
        assert.equal((await page.locator('.viewport').boundingBox()).width, width);
    }
    console.log('PASS: switching and closing all sidebar tabs preserves stage and navigation widths at 320, 390 and 640px.');
} finally {
    await browser.close();
}
