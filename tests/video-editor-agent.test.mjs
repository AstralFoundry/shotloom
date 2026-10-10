import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyVideoEditorAgentBatch,
  rewriteVideoEditorMediaOps,
  videoEditorAgentDiagnostics,
  videoEditorAgentSnapshot,
} from '../renderer/src/utils/videoEditorAgent.mjs';
import { createVideoEditorProject } from '../renderer/src/utils/videoEditorProject.mjs';

function project() {
  return createVideoEditorProject({ sourceFile: '/tmp/sample.mp4', sourceName: 'sample.mp4', duration: 12 });
}

function resolvedVideo(id, name, duration) {
  return {
    id: `agent:${id}`,
    type: 'video',
    name,
    sourceUrl: `asset://localhost/tmp/${name}`,
    duration,
    width: 1280,
    height: 720,
  };
}

test('add_media imports a real source and appends it after the existing clip', () => {
  const source = project();
  const asset = resolvedVideo('material:m1', '第二段.mp4', 4);
  const rewritten = rewriteVideoEditorMediaOps(
    source,
    [{ sourceKey: 'material:m1', asset }],
    [{ type: 'add_media', materialId: 'm1' }],
  );

  assert.deepEqual(rewritten.operations, [{ type: 'add_clip', assetId: 'agent:material:m1' }]);
  assert.equal(rewritten.notices.length, 0);
  assert.equal(rewritten.project.assets.length, source.assets.length + 1);
  assert.equal(source.assets.length, 1, '原项目不能被改动');

  const result = applyVideoEditorAgentBatch(rewritten.project, rewritten.operations);
  const clips = result.project.tracks[0].clips;
  assert.equal(clips.length, 2);
  assert.equal(clips[1].timelineStart, 12);
  assert.equal(clips[1].assetId, 'agent:material:m1');
  assert.equal(videoEditorAgentSnapshot(result.project).durationSec, 16);
});

test('one batch of add_media concatenates sources in the given order', () => {
  const source = project();
  const existing = source.tracks[0].clips[0].assetId;
  const first = resolvedVideo('material:a', 'A.mp4', 3);
  const second = resolvedVideo('node:n1', 'B.mp4', 5);
  const rewritten = rewriteVideoEditorMediaOps(
    source,
    [
      { sourceKey: 'material:a', asset: first },
      { sourceKey: 'node:n1', asset: second },
    ],
    [
      { type: 'add_media', materialId: 'a' },
      { type: 'add_media', nodeId: 'n1' },
      { type: 'set_speed', clipId: source.tracks[0].clips[0].id, speed: 1.5 },
    ],
  );

  assert.deepEqual(rewritten.operations[2], {
    type: 'set_speed',
    clipId: source.tracks[0].clips[0].id,
    speed: 1.5,
  });

  const result = applyVideoEditorAgentBatch(rewritten.project, rewritten.operations);
  const ordered = [...result.project.tracks[0].clips].sort((left, right) => left.timelineStart - right.timelineStart);
  assert.deepEqual(ordered.map((clip) => clip.assetId), [existing, 'agent:material:a', 'agent:node:n1']);
  // 追加位置在各自操作执行时确定：变速排在导入之后，因此只压缩首个片段而不移动后两段。
  assert.deepEqual(ordered.map((clip) => clip.timelineStart), [0, 12, 15]);
  assert.equal(ordered[0].speed, 1.5);
  assert.equal(videoEditorAgentDiagnostics(result.project).gaps.length, 1);
});

test('add_media reuses an asset already in the project instead of duplicating it', () => {
  const source = project();
  const existing = source.assets[0];
  const rewritten = rewriteVideoEditorMediaOps(
    source,
    [{ sourceKey: `node:n1`, asset: { ...existing, name: '同一素材' } }],
    [{ type: 'add_media', nodeId: 'n1' }],
  );

  assert.equal(rewritten.project.assets.length, source.assets.length);
  assert.match(rewritten.notices.join(' '), /已在剪辑工程中/);
});

test('set_canvas 只改画布尺寸，不动已有片段', () => {
  const source = project();
  const before = structuredClone(source.tracks[0].clips);

  const result = applyVideoEditorAgentBatch(source, [
    { type: 'set_canvas', width: 1080, height: 1920 },
  ]);

  assert.equal(result.project.settings.width, 1080);
  assert.equal(result.project.settings.height, 1920);
  assert.deepEqual(result.project.tracks[0].clips, before);
  assert.equal(source.settings.width, 1920, '原项目不能被改动');

  for (const bad of [
    { type: 'set_canvas', width: 1080.5, height: 1920 },
    { type: 'set_canvas', width: 8, height: 1920 },
    { type: 'set_canvas', width: 1080, height: 9000 },
  ]) {
    assert.throws(() => applyVideoEditorAgentBatch(source, [bad]), /16–8192 的整数像素/);
  }
  assert.throws(
    () => applyVideoEditorAgentBatch(source, [{ type: 'set_canvas', width: 1920, height: 1080 }]),
    /画布已经是 1920×1080/,
  );
});

test('set_transform 的 fit 只接受 fit 或 fill', () => {
  const source = project();
  const clipId = source.tracks[0].clips[0].id;

  const filled = applyVideoEditorAgentBatch(source, [
    { type: 'set_transform', clipId, fit: 'fill' },
  ]);
  assert.equal(filled.project.tracks[0].clips[0].transform.fit, 'fill');

  const restored = applyVideoEditorAgentBatch(source, [
    { type: 'set_transform', clipId, fit: 'fit' },
  ]);
  // 留边是缺省语义，规范化后只保留 fill 这一种显式取值。
  assert.notEqual(restored.project.tracks[0].clips[0].transform.fit, 'fill');

  assert.throws(
    () => applyVideoEditorAgentBatch(source, [{ type: 'set_transform', clipId, fit: 'cover' }]),
    /fit 必须是 fit 或 fill/,
  );
});

test('转场和特效应报出可用 key 而不是静默失败', () => {
  const source = project();
  const clipId = source.tracks[0].clips[0].id;

  assert.throws(
    () => applyVideoEditorAgentBatch(source, [{ type: 'add_effect', key: '', atSec: 1 }]),
    (error) => /可用的特效：vignette、glitch/.test(error.message),
  );
  assert.throws(
    () => applyVideoEditorAgentBatch(source, [{ type: 'add_effect', key: 'dissolve', atSec: 1 }]),
    (error) => /不支持的特效「dissolve」/.test(error.message) && /filmStripPro/.test(error.message),
  );
  assert.throws(
    () => applyVideoEditorAgentBatch(source, [
      { type: 'add_transition', key: 'wipe', atSec: 1, fromClipId: clipId, toClipId: clipId },
    ]),
    (error) => /可用的转场：fade、Directional/.test(error.message),
  );
});

test('agent batch splits and trims real clips without mutating its input', () => {
  const source = project();
  const first = source.tracks[0].clips[0];
  const result = applyVideoEditorAgentBatch(source, [
    { type: 'split_clip', clipId: first.id, atSec: 5 },
    { type: 'trim_clip', clipId: first.id, newStartSec: 1 },
  ]);
  assert.equal(source.tracks[0].clips.length, 1);
  assert.equal(result.project.tracks[0].clips.length, 2);
  assert.equal(result.project.tracks[0].clips[0].timelineStart, 1);
  assert.equal(result.project.tracks[0].clips[0].trimStart, 1);
  assert.equal(result.project.tracks[0].clips[0].trimEnd, 5);
  assert.equal(result.project.tracks[0].clips[1].timelineStart, 5);
  assert.equal(result.project.tracks[0].clips[1].trimStart, 5);
});

test('agent batch rejects an invalid later step atomically', () => {
  const source = project();
  const before = structuredClone(source);
  assert.throws(() => applyVideoEditorAgentBatch(source, [
    { type: 'add_text', text: '字幕', atSec: 2 },
    { type: 'remove_clip', clipId: 'missing' },
  ]), /第 2 步/);
  assert.deepEqual(source, before);
});

test('snapshot reports stable timeline facts', () => {
  const source = project();
  const snapshot = videoEditorAgentSnapshot(source, 3, source.tracks[0].clips[0].id);
  assert.equal(snapshot.durationSec, 12);
  assert.equal(snapshot.playheadSec, 3);
  assert.equal(snapshot.tracks[0].clips[0].endSec, 12);
  assert.equal(snapshot.assets[0].name, 'sample.mp4');
});

test('agent can place existing media and retime it using the project model', () => {
  const source = project();
  const added = applyVideoEditorAgentBatch(source, [
    { type: 'add_clip', assetId: source.assets[0].id, atSec: 15 },
  ]).project;
  const second = added.tracks[0].clips.find((clip) => clip.timelineStart === 15);
  assert.ok(second);
  const retimed = applyVideoEditorAgentBatch(added, [
    { type: 'set_speed', clipId: second.id, speed: 2 },
  ]).project;
  assert.equal(videoEditorAgentSnapshot(retimed).durationSec, 21);
  assert.deepEqual(videoEditorAgentDiagnostics(retimed).gaps, [{ trackId: retimed.tracks[0].id, fromSec: 12, toSec: 15 }]);
  assert.equal(source.tracks[0].clips.length, 1);
});

test('agent refuses an unknown explicit track rather than choosing another track', () => {
  const source = project();
  assert.throws(() => applyVideoEditorAgentBatch(source, [
    { type: 'add_clip', assetId: source.assets[0].id, trackId: 'missing' },
  ]), /轨道不存在/);
  assert.equal(source.tracks[0].clips.length, 1);
});

test('range deletion preserves source timing and closes the gap', () => {
  const source = project();
  const next = applyVideoEditorAgentBatch(source, [
    { type: 'remove_range', fromSec: 3, toSec: 5 },
  ]).project;
  const clips = next.tracks[0].clips;
  assert.equal(clips.length, 2);
  assert.deepEqual(clips.map((clip) => [clip.timelineStart, clip.trimStart, clip.trimEnd]), [
    [0, 0, 3],
    [3, 5, 12],
  ]);
  assert.equal(videoEditorAgentSnapshot(next).durationSec, 10);
  assert.equal(source.tracks[0].clips[0].trimEnd, 12);
});

test('range deletion across locked target rejects the whole batch', () => {
  const source = project();
  source.tracks[0].locked = true;
  assert.throws(() => applyVideoEditorAgentBatch(source, [
    { type: 'remove_range', fromSec: 2, toSec: 4, trackIds: [source.tracks[0].id] },
  ]), /轨道已锁定/);
  assert.equal(source.tracks[0].clips.length, 1);
});

test('agent edits text placement and adds a transition with real neighboring clips', () => {
  const source = project();
  const cut = applyVideoEditorAgentBatch(source, [
    { type: 'split_clip', clipId: source.tracks[0].clips[0].id, atSec: 6 },
  ]).project;
  const [from, to] = cut.tracks[0].clips;
  const edited = applyVideoEditorAgentBatch(cut, [
    { type: 'add_text', text: '第一幕', atSec: 1, durationSec: 2 },
    { type: 'add_transition', key: 'fade', fromClipId: from.id, toClipId: to.id, atSec: 5.7, durationSec: .6 },
  ]).project;
  const textClip = edited.tracks.find((track) => track.type === 'text').clips[0];
  const final = applyVideoEditorAgentBatch(edited, [
    { type: 'set_text_style', clipId: textClip.id, fontSize: 68, color: '#ffeeaa' },
    { type: 'set_transform', clipId: textClip.id, x: 200, y: 300, opacity: .9 },
  ]).project;
  const styled = final.tracks.find((track) => track.type === 'text').clips[0];
  assert.equal(styled.style.fontSize, 68);
  assert.equal(styled.style.color, '#ffeeaa');
  assert.equal(styled.transform.x, 200);
  assert.equal(styled.transform.opacity, .9);
  assert.equal(final.tracks.find((track) => track.type === 'transition').clips[0].transitionKey, 'fade');
  assert.throws(() => applyVideoEditorAgentBatch(cut, [
    { type: 'add_transition', key: 'fade', fromClipId: to.id, toClipId: from.id, atSec: 5.7 },
  ]), /相邻/);
});
