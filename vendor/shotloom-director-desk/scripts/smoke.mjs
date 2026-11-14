import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

/**
 * Browser smoke test for the React editor shell.
 *
 * Runs against the Vite dev server because it drives the dev-only `window.__editorDebug`
 * handle (a release build never exposes it). It covers the guarantees the unit suite cannot:
 * the three.js viewport mounts, selection and the inspector agree, one numeric edit commits and
 * one undo restores it, playback advances, and the console stays clean.
 */
const base = process.env.DIRECTOR_URL || 'http://127.0.0.1:5173';
const url = new URL(base);
url.searchParams.set('theme', 'light');
await fs.mkdir('tmp/smoke', { recursive: true });
const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (error) => {
    errors.push(error.stack || error.message);
    console.log('PAGE ERROR', error.stack);
});
page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
});
page.on('dialog', (dialog) => dialog.accept());

const state = () =>
    page.evaluate(() => {
        const debug = window.__editorDebug;
        const snapshot = debug.store.getState();
        return {
            entities: snapshot.project.entities.length,
            selected: snapshot.project.entities.find((entity) => entity.id === snapshot.selected)?.name ?? '',
            time: snapshot.time,
            playing: snapshot.playing,
            view: snapshot.view,
            revision: snapshot.revision,
        };
    });

const chooseView = async (label) => {
    await page.getByRole('combobox', { name: '视角', exact: true }).click();
    await page.locator('.ant-select-dropdown:visible').getByText(label, { exact: true }).click();
};
try {
    await page.goto(url.href, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.__editorDebug, { timeout: 15_000 });
    await page.locator('.viewport__canvas canvas').first().waitFor({ timeout: 15_000 });
    await page.screenshot({ path: 'tmp/smoke/01-director-view.png' });

    // Composition opens with the stage expanded; the dock reveals the animation tools.
    assert.equal(await page.locator('.timeline').isVisible(), false, 'timeline starts collapsed');
    assert.equal(await page.locator('.sidebar__rail').isVisible(), true, 'navigation remains visible');
    await page.getByRole('button', { name: '动画时间轴', exact: true }).click();
    assert.equal(await page.locator('.timeline').isVisible(), true, 'dock opens the timeline');

    const initial = await state();
    assert.equal(initial.entities, 3, 'starter scene has ground, actor and camera');
    assert.equal(initial.selected, '角色 A', 'the actor starts selected');
    assert.equal(initial.view, 'stage', 'director view is the default');

    // A current-view camera marker must not cover the editor's eye with its solid lens.
    const cameraPlacementPixels = await page.evaluate(() => {
        const { session } = window.__editorDebug;
        const engine = session.engine;
        const sample = () => {
            engine.render();
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 64;
            const context = canvas.getContext('2d');
            context.drawImage(engine.editorRenderer.domElement, 0, 0, 64, 64);
            return [...context.getImageData(0, 0, 64, 64).data];
        };
        const before = sample();
        session.addCameraPlacement('current');
        session.addCameraPlacement('low-up');
        const after = sample();
        session.undo();
        session.undo();
        return { before, after };
    });
    const lightPixels = (pixels) => pixels.filter((channel, index) => index % 4 !== 3 && channel > 100).length;
    assert.ok(lightPixels(cameraPlacementPixels.after) > lightPixels(cameraPlacementPixels.before) * 0.75,
        'adding current-view and low-angle cameras keeps the stage visible');

    // Deterministic scrubbing: the session clamps and republishes the same value.
    const scrubbed = await page.evaluate(() => {
        const { session, store } = window.__editorDebug;
        session.seek(5);
        const first = store.getState().time;
        session.seek(12);
        session.seek(5);
        return { first, again: store.getState().time };
    });
    assert.equal(scrubbed.first, scrubbed.again, 'seeking the same time is stable');

    // View switching keeps the engine mounted; the shot canvas only exists in the DOM once.
    await chooseView('机位视角');
    await page.locator('.viewport__canvas--shot canvas').waitFor();
    assert.equal((await state()).view, 'shot', 'shot view is active');
    const shotColors = await page.evaluate(async () => {
        const engine = window.__editorDebug.session.engine;
        const pixel = (source, x, y) => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 1;
            const context = canvas.getContext('2d');
            context.drawImage(source, source.width * x, source.height * y, 1, 1, 0, 0, 1, 1);
            return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
        };
        engine.render();
        const preview = {
            sky: pixel(engine.shotRenderer.domElement, 0.02, 0.02),
            floor: pixel(engine.shotRenderer.domElement, 0.02, 0.98),
        };
        engine.exporting = true;
        try {
            await engine.prepareOutput(0);
            const output = engine.renderOutput(0, 640, 360, 'program');
            return { preview, output: { sky: pixel(output, 0.02, 0.02), floor: pixel(output, 0.02, 0.98) } };
        } finally {
            engine.restorePreview(0);
        }
    });
    for (const region of ['sky', 'floor']) {
        assert.ok(shotColors.preview[region].every((channel) => channel > 160), `light preview ${region} is light`);
        assert.ok(
            shotColors.preview[region].every((channel, index) => Math.abs(channel - shotColors.output[region][index]) < 8),
            `exported ${region} matches the live shot: ${JSON.stringify(shotColors)}`,
        );
    }
    await page.screenshot({ path: 'tmp/smoke/02-shot-view.png' });
    await chooseView('导演视角');

    // Selection drives the inspector: pick the camera row and expect the lens panel.
    await page.evaluate(() => {
        const { session, store } = window.__editorDebug;
        const camera = store.getState().project.entities.find((entity) => entity.kind === 'camera');
        session.selectEntity(camera.id);
    });
    await page
        .getByRole('complementary', { name: '属性面板', exact: true })
        .getByText('焦距', { exact: true })
        .waitFor();
    assert.equal((await state()).selected, '机位 1', 'camera row selects the camera');

    // One numeric edit commits a history entry; one undo restores the previous value.
    const actorId = await page.evaluate(() => {
        const { session, store } = window.__editorDebug;
        const actor = store.getState().project.entities.find((entity) => entity.kind === 'actor');
        session.selectEntity(actor.id);
        return actor.id;
    });
    const positionOf = () =>
        page.evaluate((id) => {
            const entity = window.__editorDebug.store.getState().project.entities.find((item) => item.id === id);
            return entity.position[0];
        }, actorId);

    const before = await positionOf();
    const xField = page.locator('.transform-matrix input[aria-label="X"]').first();
    await xField.fill(String(before + 1));
    await xField.press('Tab');
    assert.equal(await positionOf(), before + 1, 'position edit commits');

    await page.getByRole('button', { name: '撤销' }).click();
    assert.equal(await positionOf(), before, 'one undo restores the position');

    // Asset catalogue: placing a card adds a selected entity. The sidebar starts collapsed
    // in a fresh session, so the asset panel is only reachable after opening the sidebar.
    await page.getByRole('button', { name: '展开侧栏' }).click();
    await page.getByRole('button', { name: '资产', exact: true }).click();
    // Cards swap their icon placeholder for a lazily rendered thumbnail; click only once the
    // first card has settled so the click cannot land on a repainting node.
    const firstCard = page.locator('.asset-card').first();
    await firstCard.waitFor();
    await firstCard.click();
    await page.waitForFunction(
        (expected) => window.__editorDebug.store.getState().project.entities.length === expected,
        initial.entities + 1,
        { timeout: 5_000 },
    );
    const afterAsset = await state();
    assert.equal(afterAsset.entities, initial.entities + 1, 'catalogue asset is placed');

    // Cutting at the playhead writes a second cut and keeps the first one at 0.
    await page.evaluate(() => {
        const { session, store } = window.__editorDebug;
        const camera = store.getState().project.entities.find((entity) => entity.kind === 'camera');
        session.selectEntity(camera.id);
        session.seek(5);
    });
    await page.getByRole('button', { name: '在播放头切镜' }).click();
    const cuts = await page.evaluate(() => window.__editorDebug.store.getState().project.cuts.map((cut) => cut.time));
    assert.deepEqual(cuts, [0, 5], 'cut inserted at the playhead');

    // Path drawing: two stage clicks add waypoints, Enter commits the path.
    await page.evaluate(() => {
        const { session, store } = window.__editorDebug;
        const actor = store.getState().project.entities.find((entity) => entity.kind === 'actor');
        session.selectEntity(actor.id);
        session.startPath();
    });
    const stageBox = await page.locator('.viewport__panel--stage canvas').boundingBox();
    assert.ok(stageBox, 'stage canvas has a box');
    await page.mouse.click(stageBox.x + stageBox.width * 0.4, stageBox.y + stageBox.height * 0.7);
    await page.mouse.click(stageBox.x + stageBox.width * 0.6, stageBox.y + stageBox.height * 0.75);
    await page.keyboard.press('Enter');
    const path = await page.evaluate(() => {
        const state = window.__editorDebug.store.getState();
        const actor = state.project.entities.find((entity) => entity.kind === 'actor');
        return { draft: state.pathDraft, points: actor.path?.points.length ?? 0 };
    });
    assert.equal(path.draft, null, 'Enter finishes the path draft');
    assert.ok(path.points >= 2, `path has waypoints (${path.points})`);

    // Timeline drag: one committed drag moves the idle clip, one undo restores it.
    const idleBar = page.locator('.timeline .clip', { hasText: '站立 / 待机' }).first();
    await idleBar.scrollIntoViewIfNeeded();
    const idleBox = await idleBar.boundingBox();
    assert.ok(idleBox, 'idle clip bar has a box');
    await page.mouse.move(idleBox.x + idleBox.width / 2, idleBox.y + idleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(idleBox.x + idleBox.width / 2 + 90, idleBox.y + idleBox.height / 2, { steps: 8 });
    await page.mouse.up();
    const draggedStart = () =>
        page.evaluate(
            () =>
                window.__editorDebug.store.getState().project.entities.find((entity) => entity.kind === 'actor')
                    .clips[0].start,
        );
    assert.ok((await draggedStart()) > 0.3, 'clip drag commits a new start time');
    await page.getByRole('button', { name: '撤销' }).click();
    assert.equal(await draggedStart(), 0, 'one undo restores the clip position');

    // Action clips: add from the picker, split at the playhead, remove the right half.
    // The inspector row is a searchable Select; its field carries the "更多动作…" label.
    await page.locator('.inspector .ant-tabs-tab', { hasText: '动作' }).click();
    const picker = page.locator('.inspector .ant-select').filter({ hasText: '更多动作' }).first();
    await picker.click();
    await page.keyboard.type('挥手');
    await page.keyboard.press('Enter');
    const clipsAfterAdd = await page.evaluate(() => {
        const state = window.__editorDebug.store.getState();
        return state.project.entities.find((entity) => entity.kind === 'actor').clips.length;
    });
    assert.equal(clipsAfterAdd, 2, 'wave clip is appended after the idle clip');

    await page.evaluate(() => {
        const { session, store } = window.__editorDebug;
        const actor = store.getState().project.entities.find((entity) => entity.kind === 'actor');
        session.selectClip(actor.clips[1].id);
        session.seek(actor.clips[1].start + 0.5);
    });
    await page.getByRole('button', { name: /在播放头分\s*割/ }).click();
    assert.equal(
        await page.evaluate(
            () =>
                window.__editorDebug.store.getState().project.entities.find((entity) => entity.kind === 'actor').clips
                    .length,
        ),
        3,
        'split creates a second half',
    );
    await page.getByRole('button', { name: /移\s*除/ }).click();
    assert.equal(
        await page.evaluate(
            () =>
                window.__editorDebug.store.getState().project.entities.find((entity) => entity.kind === 'actor').clips
                    .length,
        ),
        2,
        'remove deletes the selected half',
    );

    // Pose: pick a joint, edit its X angle, then record a pose key.
    await page.locator('.inspector .ant-tabs-tab', { hasText: '姿态' }).click();
    await page.evaluate(() => window.__editorDebug.session.selectJoint('head'));
    const angleField = page.locator('.inspector .transform-matrix input[aria-label$="X"]').first();
    await angleField.fill('25');
    await angleField.press('Tab');
    const pose = await page.evaluate(() => {
        const state = window.__editorDebug.store.getState();
        return state.project.entities.find((entity) => entity.kind === 'actor').pose;
    });
    assert.ok(Math.abs(Number(pose.head?.[0] ?? 0) - 25) < 1e-6, 'joint angle edit commits');
    await page.getByRole('button', { name: '记录当前姿态' }).click();
    assert.equal(
        await page.evaluate(
            () =>
                window.__editorDebug.store.getState().project.entities.find((entity) => entity.kind === 'actor')
                    .poseKeys.length,
        ),
        1,
        'pose key is recorded',
    );

    // Export: the dialog renders a live preview, and the encoder produces an MP4 blob.
    await page.getByRole('button', { name: '输出', exact: true }).click();
    await page.getByRole('menuitem', { name: '导出运镜视频', exact: true }).click();
    await page.locator('.export-preview img').waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: /取\s*消/ }).click();
    const exported = await page.evaluate(async () => {
        const { session } = window.__editorDebug;
        const engine = session.engineOrNull;
        const { exportVideo } = await import('/src/core/export.ts');
        const skyPixel = (source, width, height) => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 1;
            const context = canvas.getContext('2d');
            context.drawImage(source, width * 0.02, height * 0.02, 1, 1, 0, 0, 1, 1);
            return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
        };
        await engine.prepareOutput(0);
        const reference = skyPixel(engine.renderOutput(0, 640, 360, 'program'), 640, 360);
        engine.restorePreview(0);
        const controller = new AbortController();
        const blob = await exportVideo(
            engine,
            {
                start: 0,
                end: 0.5,
                fps: 24,
                width: 640,
                height: 360,
                cameraId: 'program',
                format: 'mp4',
                monochrome: false,
            },
            controller.signal,
            () => {},
        );
        const video = document.createElement('video');
        const url = URL.createObjectURL(blob);
        try {
            video.src = url;
            await new Promise((resolve, reject) => {
                video.onloadeddata = resolve;
                video.onerror = () => reject(new Error('无法读取导出视频的首帧'));
                video.load();
            });
            await new Promise((resolve) => {
                video.onseeked = resolve;
                video.currentTime = 0.1;
            });
            return {
                size: blob?.size ?? 0, type: blob?.type ?? '', reference,
                firstFrame: skyPixel(video, video.videoWidth, video.videoHeight),
            };
        } finally {
            URL.revokeObjectURL(url);
        }
    });
    assert.ok(exported.size > 1000, `encoder produced a video (${exported.size} bytes)`);
    assert.equal(exported.type, 'video/mp4', 'encoder output is MP4');
    assert.ok(exported.reference.every((channel) => channel > 160), 'light shot is used for video export');
    assert.ok(
        exported.reference.every((channel, index) => Math.abs(channel - exported.firstFrame[index]) < 25),
        `encoded video keeps the light shot background: ${JSON.stringify(exported)}`,
    );

    // Model import: an OBJ round-trips through pack/parse into an external entity.
    await fs.writeFile(
        'tmp/smoke/cube.obj',
        [
            'v -0.5 0 -0.5',
            'v 0.5 0 -0.5',
            'v 0.5 0 0.5',
            'v -0.5 0 0.5',
            'v -0.5 1 -0.5',
            'v 0.5 1 -0.5',
            'v 0.5 1 0.5',
            'v -0.5 1 0.5',
            'f 1 2 3 4',
            'f 5 6 7 8',
            'f 1 2 6 5',
            'f 2 3 7 6',
            'f 3 4 8 7',
            'f 4 1 5 8',
            '',
        ].join('\n'),
    );
    await page.locator('.sidebar').getByRole('button', { name: '添加', exact: true }).click();
    await page.getByRole('menuitem', { name: '导入模型' }).click();
    await page.locator('.ant-modal input[type=file]').first().waitFor({ state: 'attached' });
    await page.locator('.ant-modal input[type=file]').first().setInputFiles('tmp/smoke/cube.obj');
    await page.getByRole('button', { name: '读取模型' }).click();
    await page.getByRole('button', { name: '放入场景' }).click({ timeout: 20_000 });
    const imported = await page.evaluate(() => {
        const state = window.__editorDebug.store.getState();
        const external = state.project.entities.find((entity) => entity.external);
        return {
            name: external?.name ?? '',
            resources: (state.project.resources ?? []).length,
            formats: (state.project.resources ?? []).map((resource) => resource.package.format),
        };
    });
    assert.equal(imported.name, 'cube', 'imported model becomes an entity');
    assert.deepEqual(imported.formats, ['obj'], 'project stores the packed OBJ resource');

    // Dialogs: project settings, help reference, and room controls.
    await page.getByRole('button', { name: '更多' }).click();
    await page.getByRole('menuitem', { name: '项目设置' }).click();
    await page.locator('input[aria-label="项目名称"]').fill('冒烟场景');
    await page.getByRole('button', { name: /应\s*用/ }).click();
    assert.equal(
        await page.evaluate(() => window.__editorDebug.store.getState().project.name),
        '冒烟场景',
        'project rename applies',
    );

    await page.getByRole('button', { name: '更多', exact: true }).click();
    await page.getByRole('menuitem', { name: '操作与快捷键' }).click();
    await page.locator('.help-group').first().waitFor();
    assert.equal(await page.locator('.help-group').count(), 4, 'help groups render');
    await page.locator('.ant-modal:visible .ant-modal-close').click();
    await page.locator('.ant-modal-wrap:visible').waitFor({ state: 'hidden' });

    // Environment is reached from the inspector header button, not from the tab strip.
    await page.locator('.inspector .inspector__scene-button').click();
    await page.locator('.inspector .ant-switch').first().click();
    assert.equal(
        await page.evaluate(() => window.__editorDebug.store.getState().project.room.enabled),
        true,
        'room structure toggles from the inspector',
    );

    // Camera framing preset: 近景 changes lens and moves the camera.
    await page.evaluate(() => {
        const { session, store } = window.__editorDebug;
        const camera = store.getState().project.entities.find((entity) => entity.kind === 'camera');
        session.selectEntity(camera.id);
    });
    const framingBefore = await page.evaluate(() => {
        const state = window.__editorDebug.store.getState();
        const camera = state.project.entities.find((entity) => entity.kind === 'camera');
        return { focal: camera.camera.focal, position: camera.position };
    });
    await page.locator('.inspector button', { hasText: /近\s*景/ }).click();
    const framingAfter = await page.evaluate(() => {
        const state = window.__editorDebug.store.getState();
        const camera = state.project.entities.find((entity) => entity.kind === 'camera');
        return { focal: camera.camera.focal, position: camera.position };
    });
    assert.equal(framingAfter.focal, 35, 'framing preset sets the lens');
    assert.ok(
        framingBefore.position.some((value, index) => Math.abs(value - framingAfter.position[index]) > 0.05),
        'framing preset moves the camera',
    );

    // Reset project: restores the default scene and remains undoable.
    const beforeNew = (await state()).entities;
    await page.getByRole('button', { name: '更多' }).click();
    await page.getByRole('menuitem', { name: '重置项目' }).click();
    await page.getByRole('dialog', { name: '重置项目' }).getByRole('button', { name: '重置项目' }).click();
    const created = await page.evaluate(() => {
        const project = window.__editorDebug.store.getState().project;
        return { name: project.name, entities: project.entities.length };
    });
    assert.equal(created.name, '冒烟场景', 'reset project keeps the current project name');
    assert.equal(created.entities, 3, 'default scene restores the ground, actor and camera');
    await page.getByRole('button', { name: '撤销' }).click();
    assert.equal((await state()).entities, beforeNew, 'reset project is undoable');

    // Playback advances the shared clock.
    await page.evaluate(() => window.__editorDebug.session.togglePlay());
    await page.waitForTimeout(600);
    const playing = await state();
    await page.evaluate(() => window.__editorDebug.session.togglePlay());
    assert.ok(playing.playing, 'playback is running');
    assert.ok(playing.time > 0.1, `playback advanced the clock (${playing.time})`);

    // Keyboard: Ctrl+D duplicates, W moves the editor viewpoint once the stage is focused.
    const entitiesBeforeDuplicate = (await state()).entities;
    await page.keyboard.press('Control+d');
    assert.equal((await state()).entities, entitiesBeforeDuplicate + 1, 'Ctrl+D duplicates the selection');
    await page.getByRole('button', { name: '撤销' }).click();
    assert.equal((await state()).entities, entitiesBeforeDuplicate, 'duplicate is undone');

    await page.locator('.viewport__panel--stage canvas').click({ position: { x: 30, y: 30 } });
    const cameraBefore = await page.evaluate(() =>
        window.__editorDebug.session.engineOrNull.editorCamera.position.toArray(),
    );
    await page.keyboard.down('w');
    await page.waitForTimeout(280);
    await page.keyboard.up('w');
    const cameraAfter = await page.evaluate(() =>
        window.__editorDebug.session.engineOrNull.editorCamera.position.toArray(),
    );
    assert.ok(
        cameraBefore.some((value, index) => Math.abs(value - cameraAfter[index]) > 0.02),
        'WASD moves the editor viewpoint',
    );

    // Recovery: a change is autosaved, then restored after a reload.
    await page.evaluate(() => window.__editorDebug.session.addAsset('chair'));
    await page.waitForTimeout(1_200);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.__editorDebug, { timeout: 15_000 });
    await page.waitForFunction(
        () => window.__editorDebug.store.getState().project.entities.some((entity) => entity.name === '椅子'),
        { timeout: 10_000 },
    );

    assert.deepEqual(errors, [], 'browser console stays clean');
    console.log(
        'Smoke passed: engine mount, view switch, selection, committed edit, undo, asset placement, cut insertion, path drawing, clip drag, action clips, pose edit, video export, model import, dialogs, camera framing, project reset, shortcuts, viewpoint navigation, playback and autosave recovery.',
    );
} finally {
    await browser.close();
}
