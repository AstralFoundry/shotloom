import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';

// GPU regression: millimetre-separated paving must occlude the ground at altitude.
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(process.env.DIRECTOR_URL || 'http://127.0.0.1:5173');
    await page.waitForFunction(() => !!window.__editorDebug?.session.engine);
    const result = await page.evaluate(async () => {
        const T = await import('/node_modules/three/build/three.module.js');
        const engine = window.__editorDebug.session.engine;
        const scene = new T.Scene();
        const geometry = new T.PlaneGeometry(8000, 8000);
        const bottom = new T.MeshBasicMaterial({ color: 0xff0000, side: T.DoubleSide });
        const top = new T.MeshBasicMaterial({ color: 0x00ff00, side: T.DoubleSide });
        for (const [material, y] of [[bottom, 0], [top, 0.006]]) {
            const plane = new T.Mesh(geometry, material);
            plane.rotation.x = -Math.PI / 2;
            plane.position.y = y;
            scene.add(plane);
        }
        const pixels = new Uint8Array(64 * 64 * 4);
        const linear = new T.WebGLRenderer();
        const samples = [];
        try {
            for (const [name, renderer, near] of [
                ['linear-control', linear, 0.025],
                ['editor', engine.editorRenderer, engine.editorCamera.near],
                ['shot', engine.shotRenderer, 0.025],
            ]) {
                const target = new T.WebGLRenderTarget(64, 64);
                const previousTarget = renderer.getRenderTarget();
                try {
                    renderer.setRenderTarget(target);
                    for (const distance of [1, 30, 100, 500, 1000]) {
                        for (const tilt of [0.2, 0.7]) {
                            const camera = new T.PerspectiveCamera(45, 1, near, 2000);
                            camera.position.set(0, distance, distance * tilt);
                            camera.lookAt(0, 0, 0);
                            renderer.render(scene, camera);
                            renderer.readRenderTargetPixels(target, 0, 0, 64, 64, pixels);
                            let wrongPixels = 0;
                            for (let i = 0; i < pixels.length; i += 4) {
                                if (pixels[i] >= pixels[i + 1]) wrongPixels++;
                            }
                            samples.push({ name, distance, tilt, wrongPixels });
                        }
                    }
                } finally {
                    renderer.setRenderTarget(previousTarget);
                    target.dispose();
                }
            }
        } finally {
            geometry.dispose();
            bottom.dispose();
            top.dispose();
            linear.dispose();
        }
        return samples;
    });
    assert.ok(result.some((s) => s.name === 'linear-control' && s.wrongPixels > 0),
        'control must reproduce distant surface depth collisions');
    for (const sample of result.filter((s) => s.name !== 'linear-control')) {
        assert.equal(sample.wrongPixels, 0, JSON.stringify(sample));
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify(result, null, 2));
    console.log('PASS: editor and shot preserve separated surfaces from 1m to 1000m.');
} finally {
    await browser.close();
}
