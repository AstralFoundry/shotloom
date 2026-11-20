import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const id = 'triangle-test';
const asset = {
    id, title: 'Test triangle', free: true, class: 'prop',
    credit: 'Test triangle by Polyfork, CC BY 4.0', license: 'Mesh files: CC BY 4.0',
    source: `https://polyfork.dev/asset/${id}`, licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    download: { glb: `https://polyfork.dev/cdn/${id}.glb` },
};
const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
let json = JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    bufferViews: [{ buffer: 0, byteLength: positions.byteLength }], buffers: [{ byteLength: positions.byteLength }],
});
json = json.padEnd(Math.ceil(Buffer.byteLength(json) / 4) * 4, ' ');
const glb = Buffer.alloc(28 + Buffer.byteLength(json) + positions.byteLength);
glb.write('glTF'); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
glb.writeUInt32LE(Buffer.byteLength(json), 12); glb.writeUInt32LE(0x4e4f534a, 16); glb.write(json, 20);
const binary = 20 + Buffer.byteLength(json);
glb.writeUInt32LE(positions.byteLength, binary); glb.writeUInt32LE(0x004e4942, binary + 4);
Buffer.from(positions.buffer).copy(glb, binary + 8);

const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true,
});
try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let requests = 0, offline = false;
    await page.route('**/api/polyfork/**', async route => {
        requests++;
        if (offline) return route.abort();
        if (new URL(route.request().url()).pathname.endsWith('/model'))
            return route.fulfill({ contentType: 'model/gltf-binary', body: glb });
        const data = new URL(route.request().url()).pathname.endsWith('/assets')
            ? { assets: [asset], page: 1, per_page: 24, total: 1 } : asset;
        return route.fulfill({ json: { success: true, data } });
    });
    const openAssets = async () => {
        if (!await page.getByRole('combobox', { name: '资产来源' }).isVisible())
            await page.getByRole('button', { name: '资产', exact: true }).click();
        await page.getByRole('combobox', { name: '资产来源' }).waitFor();
    };
    const select = async (name, option) => {
        await page.getByRole('combobox', { name, exact: true }).click();
        await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText(option, { exact: true }).click();
    };
    await page.goto(process.env.DIRECTOR_URL || 'http://127.0.0.1:5173');
    await page.waitForFunction(() => Boolean(window.__editorDebug?.session.engineOrNull));
    await openAssets();
    await select('资产来源', 'Polyfork');
    await page.getByRole('button', { name: 'Test triangle', exact: true }).click();
    await page.getByRole('button', { name: '下载并导入', exact: true }).click();
    await page.waitForFunction(() => window.__editorDebug.store.getState().project.entities.some(entity => entity.asset === 'external-model'));
    await openAssets();
    await select('资产来源', '本地');
    await select('资产分组', '已下载');
    await page.locator('.asset-card').filter({ hasText: 'Test triangle' }).waitFor();
    const count = requests;
    offline = true;
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__editorDebug?.session.engineOrNull));
    await openAssets();
    await select('资产分组', '已下载');
    const before = await page.evaluate(() => window.__editorDebug.store.getState().project.entities.length);
    await page.locator('.asset-card').filter({ hasText: 'Test triangle' }).click();
    await page.waitForFunction(before => window.__editorDebug.store.getState().project.entities.length === before + 1, before);
    assert.equal(requests, count, 'offline reuse must not request the model service');
    assert.deepEqual(errors, []);
    console.log('Polyfork sidebar imports a GLB and reuses it after reload without network access.');
} finally {
    await browser.close();
}
