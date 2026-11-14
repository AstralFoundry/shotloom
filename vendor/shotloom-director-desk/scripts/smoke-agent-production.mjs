import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const base = process.env.DIRECTOR_URL || 'http://127.0.0.1:5174';
    await page.goto(base);
    await page.setContent(`<iframe src="${base}" style="width:100%;height:100%"></iframe>`);
    await page.evaluate(() => {
        window.calls = new Map(); window.ingestCount = 0; window.allowIngest = false;
        window.addEventListener('message', event => {
            if (event.source !== document.querySelector('iframe').contentWindow || event.origin !== location.origin) return;
            const { type, payload } = event.data ?? {};
            if (type === 'storyai:director-desk-agent-result') { const resolve = window.calls.get(payload.requestId); if (resolve) { window.calls.delete(payload.requestId); resolve(payload); } }
            if (type === 'storyai:director-desk-captures-sent') {
                window.ingestCount++;
                event.source.postMessage({ type: 'storyai:director-desk-captures-saved', payload: { requestId: payload.requestId, success: window.allowIngest, ...(window.allowIngest ? { outputs: [{ nodeId: 'real-host-node', materialId: 'real-host-material' }] } : { error: 'test storage unavailable' }) } }, location.origin);
            }
        });
        window.command = (operation, args = {}) => new Promise(resolve => { const requestId = crypto.randomUUID(); window.calls.set(requestId, resolve); document.querySelector('iframe').contentWindow.postMessage({ type: 'storyai:director-desk-agent-request', payload: { requestId, operation, args } }, location.origin); });
    });
    const frame = page.frames().find(f => f !== page.mainFrame());
    await frame.waitForFunction(() => !!window.__editorDebug?.session.engine);
    const command = async (operation, args = {}) => {
        const receipt = await page.evaluate(({ operation, args }) => window.command(operation, args), { operation, args });
        assert.equal(receipt.success, true, JSON.stringify(receipt)); return receipt.result;
    };
    await page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({ type: 'storyai:director-desk-session', payload: { instanceId: 'production-test', theme: 'light', locale: 'zh-CN', project: null } }, location.origin));
    const snapshot = await command('snapshot');
    assert.ok(snapshot.document.projectId);
    const catalog = await command('catalog', { group: '道路市政' });
    const road = catalog.assets.find(a => a.id === 'road-straight');
    assert.ok(road.defaultSize.depth > 0);
    assert.ok(road.parameters.length.min < road.parameters.length.max);
    assert.equal(catalog.actionTiming.walk.duration, 4);
    const actor = snapshot.document.scenes[0].state.entities.find(e => e.kind === 'actor');
    await command('batch_edit', { expectedSessionId: snapshot.sessionId, expectedRevision: snapshot.revision, edits: [
        { operation: 'remove_clip', entityId: actor.id, clipId: actor.clips[0].id },
        { operation: 'add_action', entityId: actor.id, action: 'walk', startSec: 0, endSec: 1, loop: true, blendIn: 0.2 },
        { operation: 'add_camera', ref: 'close', name: 'Close' },
        { operation: 'add_shot', cameraId: '$close', timeSec: 0, subjectIds: [actor.id], patch: { targetId: actor.id, focal: 35 }, points: [{ timeSec: 0, position: [3, 2, 4] }, { timeSec: 1, position: [2, 2, 4] }] },
    ] });
    const started = await command('export_video_start', { size: 640, start: 0, end: 1, fps: 24, filename: 'recovery' });
    let job;
    for (let attempt = 0; attempt < 300; attempt++) { job = await command('export_video_job', { jobId: started.jobId }); if (job.status !== 'running') break; await page.waitForTimeout(100); }
    assert.equal(job.status, 'delivery_failed', JSON.stringify(job));
    assert.equal(job.artifact.persistence, 'stored'); assert.ok(job.bytes > 0); assert.equal(job.frameCount, 24);
    const artifactId = job.artifact.id;
    const artifact = await command('export_artifact_read', { artifactId });
    const encoded = await frame.evaluate(async url => { const v = document.createElement('video'); v.src = url; await new Promise((resolve, reject) => { v.onloadedmetadata = resolve; v.onerror = reject; }); return { duration: v.duration, width: v.videoWidth, height: v.videoHeight }; }, artifact.url);
    assert.deepEqual([encoded.width, encoded.height], [started.width, started.height]); assert.ok(Math.abs(encoded.duration - 1) < 0.05);
    await page.evaluate(() => window.allowIngest = true);
    const retried = await command('export_artifact_deliver', { artifactId, mode: 'ingest' });
    assert.equal(retried.ingestion, 'completed'); assert.equal(retried.delivery[0].materialId, 'real-host-material');
    await command('export_artifact_deliver', { artifactId, mode: 'ingest' });
    assert.equal(await page.evaluate(() => window.ingestCount), 2, 'completed delivery is idempotent');
    job = await command('export_video_job', { jobId: started.jobId }); assert.equal(job.status, 'completed');
    const bundle = await command('export_delivery_package', { videoArtifactId: artifactId });
    const files = await frame.evaluate(async url => { const { unzipSync } = await import('/node_modules/fflate/esm/browser.js'); return Object.keys(unzipSync(new Uint8Array(await (await fetch(url)).arrayBuffer()))); }, bundle.url);
    for (const name of ['scene.director.json', 'shots.json', 'shots.csv', 'manifest.json', 'video/recovery.mp4', 'previews/storyboard-1.jpg']) assert.ok(files.includes(name), name);
    const document = (await command('snapshot')).document;
    await frame.goto(base);
    await frame.waitForFunction(() => !!window.__editorDebug?.session.engine);
    await page.evaluate(scene => document.querySelector('iframe').contentWindow.postMessage({ type: 'storyai:director-desk-session', payload: { instanceId: 'production-test', theme: 'light', locale: 'zh-CN', project: scene } }, location.origin), document);
    const restored = await command('export_artifact_read', { artifactId }); assert.equal(restored.bytes, artifact.bytes); assert.equal(restored.ingestion, 'completed');
    await page.evaluate(scene => document.querySelector('iframe').contentWindow.postMessage({ type: 'storyai:director-desk-session', payload: { instanceId: 'other-host', artifactScope: 'other-project', project: scene } }, location.origin), document);
    assert.deepEqual(await command('export_artifact_list'), []);
    await page.evaluate(scene => document.querySelector('iframe').contentWindow.postMessage({ type: 'storyai:director-desk-session', payload: { instanceId: 'production-test', project: scene } }, location.origin), document);
    assert.equal((await command('export_artifact_read', { artifactId })).bytes, artifact.bytes);
    const other = structuredClone(document); other.projectId = crypto.randomUUID();
    await command('import_scene', { document: other });
    assert.deepEqual(await command('export_artifact_list'), []);
    const denied = await page.evaluate(id => window.command('export_artifact_read', { artifactId: id }), artifactId); assert.equal(denied.success, false);
    await command('import_scene', { document });
    await command('export_artifact_remove', { artifactId }); await command('export_artifact_remove', { artifactId: bundle.id });
    console.log(JSON.stringify({ production: 'ok', bytes: artifact.bytes, actualSize: encoded, packageFiles: files, recovery: 'persisted across reload; project isolated; delivery retried without encoding' }));
} finally { await browser.close(); }
