import test from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

async function fixture() {
  const env = await createRendererEnv({ withWindow: true });
  const { store, touchProject } = await env.load('store/projectStore');
  store.project = { id: 'handoff-project', nodes: [], edges: [], assets: [], tasks: [], materials: [
    { id: 'previs', name: 'Previs', filePath: '/project/previs.mp4', resourceType: 'video', duration: 8 },
    { id: 'voice', name: 'Voice', filePath: '/project/voice.wav', resourceType: 'audio', duration: 4 },
  ] }; store.projectDir = '/project'; touchProject();
  const { desktopApi } = await env.load('services/desktopApi');
  desktopApi.file.probeMedia = async path => ({ duration: path.endsWith('.wav') ? 4 : 8, width: 1280, height: 720 });
  const listeners = []; window.location = { origin: 'http://localhost' };
  window.addEventListener = (event, listener) => { if (event === 'message') listeners.push(listener); };
  const runtime = await env.load('services/directorDeskAgentRuntime');
  let ingest = true;
  const target = { postMessage({ payload }) {
    const result = ingest ? { ingestion: 'completed', delivery: [{ materialId: 'previs' }] } : { ingestion: 'failed', error: 'disk unavailable' };
    queueMicrotask(() => listeners.forEach(listener => listener({ origin: window.location.origin, source: target, data: { type: 'test-result', payload: { requestId: payload.requestId, success: true, result } } })));
  } };
  const releaseFrame = runtime.registerDirectorDeskFrame({ contentWindow: target }, { request: 'test-request', result: 'test-result' });
  const identity = (await env.load('services/agentProjectIdentity')).getAgentProjectIdentity();
  const context = { conversationId: 'director', projectKey: identity.projectKey, projectInstanceId: identity.instanceId, projectGeneration: identity.generation, turnId: 'handoff-turn', signal: new AbortController().signal };
  const sessions = await env.load('services/videoEditorSession');
  const { ActionExecutor } = await env.loadVendor('openreel/packages/core/src/actions/action-executor.ts');
  const executor = new ActionExecutor();
  const project = { id: 'editor', name: 'Editing', createdAt: 0, modifiedAt: 0, settings: { width: 1280, height: 720, frameRate: 24, sampleRate: 48000, channels: 2 }, timeline: { duration: 0, tracks: [] }, mediaLibrary: { items: [] } };
  const actions = [], imports = [];
  let exports = 0;
  const releaseEditor = sessions.registerActiveVideoEditor({
    nodeId: sessions.WORKSPACE_VIDEO_EDITOR_ID, projectKey: identity.projectKey,
    read: () => ({}), native: () => project,
    importAsset: async asset => { imports.push(asset); project.mediaLibrary.items.push({ id: asset.id, name: asset.name, type: asset.type, metadata: { duration: asset.duration } }); return { mediaId: asset.id }; },
    executeActions: async items => { actions.push(...items); const results = await executor.executeMany(items.map(a => ({ ...a, id: crypto.randomUUID(), timestamp: Date.now() })), project); return results.find(r => !r.success) ?? { success: true }; },
    exportProject: async () => ++exports === 1 ? null : { filePath: '/project/final.mp4' },
  });
  const { directorEditingHandoff } = await env.load('services/directorEditingHandoff');
  return { store, context, actions, imports, get tracks() { return project.timeline.tracks; }, project, execute: input => directorEditingHandoff(input, context), setIngest: value => { ingest = value; }, dispose: async () => { releaseFrame(); releaseEditor(); await env.dispose(); } };
}

test('导演台视频、声音和字幕一次组装，成片导出失败重试不重复轨道或素材', async () => {
  const f = await fixture();
  try {
    const input = { videoArtifactId: 'retained-video', handoffId: 'homebound', audio: [{ assetId: 'material:voice', startSec: 2, durationSec: 3, inPoint: 1, volume: 0.7 }], subtitles: [{ text: 'Welcome home', startSec: 3, endSec: 5 }], export: true };
    const failed = await f.execute(input);
    assert.equal(failed.phase, 'export'); assert.equal(failed.timelineApplied, true);
    assert.equal(f.actions.filter(a => a.type === 'subtitle/add').length, 1);
    assert.equal(f.tracks.length, 2);
    assert.equal(f.project.timeline.subtitles[0].startTime, 3);
    assert.deepEqual([f.tracks[1].clips[0].inPoint, f.tracks[1].clips[0].outPoint, f.tracks[1].clips[0].volume], [1, 4, 0.7]);
    assert.equal(f.actions.find(a => a.params.volume === 0.7).params.startTime, 2);
    const done = await f.execute(input);
    assert.equal(done.success, true); assert.equal(done.replayed, true); assert.equal(done.delivery.filePath, '/project/final.mp4');
    assert.equal(f.tracks.length, 2); assert.equal(f.imports.length, 2);
    const conflicting = await f.execute({ ...input, subtitles: [{ text: 'Changed', startSec: 1, endSec: 2 }] });
    assert.equal(conflicting.success, false); assert.match(conflicting.error, /handoffId/);
  } finally { await f.dispose(); }
});

test('视频入库失败时保留恢复信息，不创建空白剪辑或导入声音', async () => {
  const f = await fixture();
  try { f.setIngest(false); const r = await f.execute({ videoArtifactId: 'retained-video', handoffId: 'blocked' }); assert.equal(r.recoverable, true); assert.equal(r.artifactId, 'retained-video'); assert.equal(f.tracks.length, 0); assert.equal(f.imports.length, 0); }
  finally { await f.dispose(); }
});

test('并行交接请求串行核验同一时间线，重试不重复导入或创建轨道', async () => {
  const f = await fixture();
  try {
    const input = { videoArtifactId: 'retained-video', handoffId: 'parallel' };
    const results = await Promise.all([f.execute(input), f.execute(input)]);
    assert.ok(results.every(r => r.success));
    assert.deepEqual(results.map(r => r.replayed), [false, true]);
    assert.equal(f.tracks.length, 1); assert.equal(f.imports.length, 1);
    await assert.rejects(f.execute({ ...input, handoffId: 'bad-range', audio: [{ assetId: 'material:voice', startSec: 0, inPoint: 3, durationSec: 2 }] }), /超出素材/);
    assert.equal(f.imports.length, 1);
  } finally { await f.dispose(); }
});
