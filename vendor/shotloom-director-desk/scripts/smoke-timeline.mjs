import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.DIRECTOR_URL || 'http://127.0.0.1:5173');
    await page.waitForFunction(() => !!window.__editorDebug?.session.engine);
    await page.evaluate(() => {
        const { session, store } = window.__editorDebug;
        const camera = store.getState().project.entities.find(entity => entity.kind === 'camera');
        session.selectEntity(camera.id);
        session.setCameraField({ focalKeys: [{ time: 0, value: 28 }, { time: 3, value: 50 }] });
    });
    await page.waitForFunction(() => document.querySelectorAll('.lane__parameter-key').length === 2);
    await page.waitForTimeout(300);
    const selectedColors = await page.locator('.topbar > .ant-segmented .ant-segmented-item-selected').evaluate(el => {
        const style = getComputedStyle(el);
        return { background: style.backgroundColor, color: style.color };
    });
    for (const selector of ['.topbar__actions .ant-btn-primary', '.timeline__meta .ant-btn-primary', '.viewport__toolbar .ant-btn.is-active']) {
        const button = page.locator(selector).first();
        const colors = await button.evaluate(el => {
            const style = getComputedStyle(el);
            return { background: style.backgroundColor, color: style.color };
        });
        assert.deepEqual(colors, selectedColors, `${selector} matches the director-view selected colors`);
        await button.hover();
        await page.waitForTimeout(250);
        const hover = await button.evaluate(el => {
            const style = getComputedStyle(el);
            return { background: style.backgroundColor, color: style.color };
        });
        assert.equal(hover.color, selectedColors.color, 'hover keeps readable theme text');
        assert.notEqual(hover.background, hover.color, 'hover never hides text in the background');
        await page.mouse.move(0, 0);
        await page.waitForTimeout(250);
    }
    const transformButtons = page.locator('.viewport__tool-group').first().getByRole('button');
    for (let index = 0; index < 3; index++) {
        await transformButtons.nth(index).click();
        await page.waitForTimeout(250);
        assert.equal(await transformButtons.nth(index).getAttribute('aria-pressed'), 'true');
        assert.equal(await transformButtons.nth(index).evaluate(el => getComputedStyle(el).backgroundColor), selectedColors.background);
    }
    await transformButtons.first().click();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(250);
    await fs.mkdir('tmp/smoke', { recursive: true });
    const theme = new URL(page.url()).searchParams.get('theme') || 'default';
    await page.screenshot({ path: `tmp/smoke/soft-selection-${theme}.png` });
    assert.equal(await page.locator('.timeline__object').count(), 3, 'static ground remains in object list');
    assert.deepEqual(
        await page.locator('.timeline__row--object').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height)),
        [32, 32, 32],
        'object tracks keep the compact row height',
    );
    assert.deepEqual(
        await page.locator('.lane--object').allTextContents(),
        ['', '', ''],
        'empty object lanes do not repeat entity type labels',
    );
    assert.equal(await page.locator('.track-label__expand[aria-expanded="true"]').count(), 1);
    const selected = page.locator('.timeline__object.is-selected');
    await selected.locator('.lane__parameter-key').last().click();
    assert.equal(await page.evaluate(() => window.__editorDebug.store.getState().time), 3);
    assert.equal(await page.evaluate(() => window.__editorDebug.store.getState().inspectorTab), 'keys');
    await selected.locator('.track-label__lock').click();
    assert.equal(await page.evaluate(() => window.__editorDebug.session.current().locked), true);
    await selected.locator('.track-label__lock').click();
    assert.equal(await page.evaluate(() => window.__editorDebug.session.current().locked), false);
    await selected.locator('.track-label__expand').click();
    assert.equal(await selected.locator('.timeline__row--property').count(), 0);
    await selected.locator('.track-label__expand').click();
    await selected.getByRole('button', { name: '变换', exact: true }).click();
    assert.equal(await selected.getByRole('button', { name: '位置', exact: true }).count(), 0);
    await selected.getByRole('button', { name: '变换', exact: true }).click();
    await selected.getByRole('button', { name: '缩放', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__editorDebug.store.getState().inspectorTab), 'base');
    await fs.mkdir('tmp/smoke', { recursive: true });
    await page.locator('.timeline').screenshot({ path: 'tmp/smoke/timeline-hierarchy.png' });
    await page.evaluate(() => window.__editorDebug.session.setDuration(39.5));
    const initialTiming = await page.evaluate(() => {
        const state = window.__editorDebug.store.getState();
        return { duration: state.project.duration, entities: JSON.stringify(state.project.entities), cuts: JSON.stringify(state.project.cuts) };
    });
    for (const fps of [30, 50, 59, 60, 90, 120]) {
        await page.getByRole('combobox', { name: '项目帧率', exact: true }).click();
        await page.locator(`.ant-select-item-option[title="${fps} fps"]`).click();
        assert.equal(await page.evaluate(() => window.__editorDebug.store.getState().project.fps), fps);
        assert.deepEqual(await page.evaluate(() => {
            const state = window.__editorDebug.store.getState();
            return { duration: state.project.duration, entities: JSON.stringify(state.project.entities), cuts: JSON.stringify(state.project.cuts) };
        }), initialTiming, 'frame rate changes preserve scene data and timing');
        await page.getByRole('button', { name: '回到开头', exact: true }).click();
        await page.getByRole('button', { name: '下一帧', exact: true }).click();
        assert.ok(Math.abs(await page.evaluate(() => window.__editorDebug.store.getState().time) - 1 / fps) < 0.000001);
        assert.match(await page.locator('.timecode').innerText(), /^00:00:00:01/);
        await page.getByRole('button', { name: '上一帧', exact: true }).click();
        assert.equal(await page.evaluate(() => window.__editorDebug.store.getState().time), 0);
    }
    await page.evaluate(() => window.__editorDebug.session.undo());
    assert.equal(await page.evaluate(() => window.__editorDebug.store.getState().project.fps), 90);
    await page.evaluate(() => window.__editorDebug.session.redo());
    assert.equal(await page.evaluate(() => window.__editorDebug.store.getState().project.fps), 120);
    await page.getByRole('combobox', { name: '项目帧率', exact: true }).click();
    await page.locator('.ant-select-item-option[title="24 fps"]').click();
    await page.evaluate(() => window.__editorDebug.session.seek(3));
    for (const kind of ['camera', 'actor']) {
        await page.evaluate(kind => {
            const { session, store } = window.__editorDebug;
            session.selectEntity(store.getState().project.entities.find(entity => entity.kind === kind).id);
        }, kind);
        for (const width of [1600, 1100, 900, 760, 584, 400, 320]) {
            await page.setViewportSize({ width, height: 1050 });
            await page.waitForTimeout(300);
            const layout = await page.locator('.timeline__transport').evaluate(bar => {
                const rect = bar.getBoundingClientRect();
                const controls = bar.querySelector('.timeline__controls').getBoundingClientRect();
                const meta = bar.querySelector('.timeline__meta').getBoundingClientRect();
                const overflow = [...bar.querySelectorAll('button, input, .timecode')].filter(el => {
                    const box = el.getBoundingClientRect();
                    return box.width > 0 && (box.left < rect.left || box.right > rect.right + 1);
                }).map(el => el.outerHTML);
                return { width: rect.width, height: rect.height, controlsX: controls.x, metaX: meta.x,
                    wrapped: meta.top > controls.bottom, overflow };
            });
            assert.deepEqual(layout.overflow, [], `${kind} controls fit at ${width}px`);
            if (layout.width >= 760) assert.equal(layout.height, 34, 'desktop transport stays on one compact row');
            if (layout.wrapped) assert.equal(layout.metaX, layout.controlsX, 'wrapped groups align left');
            if ([1100, 400].includes(width)) {
                const theme = new URL(page.url()).searchParams.get('theme') || 'default';
                await page.locator('.timeline').screenshot({ path: `tmp/smoke/transport-${theme}-${kind}-${width}.png` });
            }
        }
    }
    await page.setViewportSize({ width: 1100, height: 1050 });
    await page.waitForTimeout(300);
    const duration = page.getByRole('spinbutton', { name: '时长', exact: true });
    await duration.fill('45');
    await duration.press('Enter');
    assert.equal(await page.evaluate(() => window.__editorDebug.store.getState().project.duration), 45);
    const loopBefore = await page.evaluate(() => window.__editorDebug.store.getState().loop);
    await page.getByRole('switch', { name: '循环', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__editorDebug.store.getState().loop), !loopBefore);
    await page.locator('.timeline__meta').getByRole('button', { name: /角色动画/ }).click();
    assert.equal(await page.evaluate(() => window.__editorDebug.store.getState().inspectorTab), 'actions');
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await page.waitForFunction(() => window.__editorDebug.store.getState().time > 3);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await page.getByRole('button', { name: '回到开头', exact: true }).click();
    await page.getByRole('button', { name: '下一帧', exact: true }).click();
    assert.ok(await page.evaluate(() => window.__editorDebug.store.getState().time > 0));
    await page.getByRole('button', { name: '上一帧', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__editorDebug.store.getState().time), 0);
    while (!(await page.getByRole('button', { name: '放大时间轴', exact: true }).isDisabled()))
        await page.getByRole('button', { name: '放大时间轴', exact: true }).click();
    await page.locator('.timeline__body').evaluate(body => body.scrollLeft = 2700);
    await page.getByRole('button', { name: '回到开头', exact: true }).click();
    assert.equal(await page.locator('.timeline__body').evaluate(body => body.scrollLeft), 0);
    await page.locator('.timeline__body').evaluate(body => body.scrollLeft = 2200);
    const ruler = await page.locator('.lane--ruler').boundingBox();
    const body = await page.locator('.timeline__body').boundingBox();
    const x = body.x + 360;
    await page.mouse.click(x, ruler.y + 20);
    const expected = (x - ruler.x) / ruler.width * 45;
    assert.ok(Math.abs(await page.evaluate(() => window.__editorDebug.store.getState().time) - expected) < 0.05);
    const head = await page.locator('.timeline__playhead').boundingBox();
    const beforeGrab = await page.evaluate(() => window.__editorDebug.store.getState().time);
    await page.mouse.move(head.x + 9, ruler.y + 7);
    await page.mouse.down();
    assert.equal(await page.evaluate(() => window.__editorDebug.store.getState().time), beforeGrab, 'grabbing handle edge does not jump');
    await page.mouse.move(head.x + 89, ruler.y + 7, { steps: 8 });
    await page.mouse.up();
    assert.ok(Math.abs(await page.evaluate(() => window.__editorDebug.store.getState().time) - beforeGrab - 80 / ruler.width * 45) < 0.05);
    await page.getByRole('slider', { name: '拖动播放头', exact: true }).press('Home');
    assert.equal(await page.locator('.timeline__body').evaluate(body => body.scrollLeft), 0);
    await page.getByRole('button', { name: '设置时间轴缩放', exact: true }).click();
    await page.getByRole('button', { name: '适合窗口', exact: true }).click();
    await page.getByRole('button', { name: '设置时间轴缩放', exact: true }).click();
    assert.equal(await page.locator('.timeline__zoom-value').innerText(), '100%');
    assert.deepEqual(errors, []);
    console.log('PASS: hierarchy, compact responsive transport, playback, duration, loop, zoom, scrolled seeking and playhead dragging.');
} finally {
    await browser.close();
}
