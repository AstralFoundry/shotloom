import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MIN_DURATION,
  addEditorClip,
  addEditorTrack,
  activeEditorClip,
  appendEditorMediaAsset,
  createVideoEditorProject,
  createVideoSegmentProject,
  editorClipDuration,
  moveEditorClip,
  normalizeVideoEditorProject,
  planEditorMediaPlacement,
  removeEmptyEditorTrack,
  snapEditorClipStart,
  trimEditorClip,
  updateEditorClip,
  updateEditorTrack,
  videoEditorDuration,
} from '../renderer/src/utils/videoEditorProject.ts';

test('冷加载概览经过工程规范化保留，且不共享可变显示数据', () => {
  const project = createVideoEditorProject();
  project.openReelSnapshot = '.shotloom/editors/node.json';
  project.openReelOverview = { id: 'native', timeline: { duration: 3, tracks: [{ id: 'track', clips: [{ id: 'clip', startTime: 1, duration: 2 }] }] }, shotloomSession: { view: { pixelsPerSecond: 120, scrollX: 40, scrollY: 80 }, playhead: 2 } };
  const normalized = normalizeVideoEditorProject(project);
  assert.deepEqual(normalized.openReelOverview, project.openReelOverview);
  assert.equal(normalized.openReelSnapshot, project.openReelSnapshot);
  normalized.openReelOverview.timeline.tracks[0].clips[0].startTime = 0;
  assert.equal(project.openReelOverview.timeline.tracks[0].clips[0].startTime, 1);
});

test('自动落轨跳过锁定轨道，按该轨最晚结束时间依选择顺序追加，保留空隙', () => {
  const project = { tracks: [
    { id: 'locked', type: 'video', locked: true, clips: [] },
    { id: 'editable', type: 'video', clips: [
      { timelineStart: 10, duration: 2 },
      { timelineStart: 0, duration: 3 },
    ] },
    { id: 'locked-audio', type: 'audio', locked: true, clips: [] },
  ] };
  const before = structuredClone(project);
  const result = planEditorMediaPlacement(project, [
    { mediaId: 'first', type: 'video', duration: 4 },
    { mediaId: 'sound', type: 'audio', duration: 2 },
    { mediaId: 'second', type: 'video', duration: 3 },
    { mediaId: 'still', type: 'image' },
  ]);
  assert.deepEqual(result.clips, [
    { trackId: 'editable', mediaId: 'first', startTime: 12, duration: 4 },
    { trackId: 'editable', mediaId: 'second', startTime: 16, duration: 3 },
  ]);
  assert.deepEqual(result.missingTracks, ['audio', 'image']);
  assert.deepEqual(project, before, '规划不能解锁、改动已有工程');
  const restored = planEditorMediaPlacement({ tracks: [
    ...project.tracks,
    { id: 'new-audio', type: 'audio', clips: [] },
    { id: 'new-image', type: 'overlay', clips: [] },
  ] }, [{ mediaId: 'sound', type: 'audio', duration: 2 }, { mediaId: 'still', type: 'image' }]);
  assert.deepEqual(restored.clips, [
    { trackId: 'new-audio', mediaId: 'sound', startTime: 0, duration: 2 },
    { trackId: 'new-image', mediaId: 'still', startTime: 0, duration: 5 },
  ]);
  assert.deepEqual(restored.missingTracks, []);
});

test('切分导出仅包含选中的源视频片段', () => {
  const source = { sourceFile: '/project/source.mp4', sourceName: 'source.mp4', duration: 8, width: 1280, height: 720 };
  const project = createVideoSegmentProject(source, { start: 2.5, end: 5.75 });
  const clips = project.tracks.flatMap((track) => track.clips);
  assert.equal(clips.length, 1);
  assert.equal(clips[0].timelineStart, 0);
  assert.equal(clips[0].trimStart, 2.5);
  assert.equal(clips[0].trimEnd, 5.75);
  assert.equal(videoEditorDuration(project), 3.25);
  assert.equal(project.assets[0].sourceFile, source.sourceFile);
  assert.throws(() => createVideoSegmentProject(source, { start: 5, end: 2 }), /范围无效/);
});

test('画布媒体按类型加入对应轨道且不会重复添加', () => {
  let id = 0;
  const localIds = (prefix) => `${prefix}-canvas-${++id}`;
  let project = createVideoEditorProject({ createId: localIds });
  const video = appendEditorMediaAsset(project, {
    id: 'canvas:video:one',
    type: 'video',
    name: '镜头一',
    sourceFile: '/tmp/one.mp4',
    sourceUrl: 'asset://one.mp4',
    duration: 3,
    width: 1920,
    height: 1080,
    sourceNodeId: 'video-node',
  }, { createId: localIds });
  assert.equal(video.added, true);
  assert.equal(video.project.tracks.find((track) => track.type === 'video').clips.length, 1);
  assert.equal(video.project.assets[0].sourceNodeId, 'video-node');

  const duplicate = appendEditorMediaAsset(video.project, {
    id: 'canvas:video:one',
    type: 'video',
    duration: 3,
  }, { createId: localIds });
  assert.equal(duplicate.added, false);
  assert.equal(duplicate.clipId, video.clipId);

  const image = appendEditorMediaAsset(duplicate.project, {
    id: 'canvas:image:one',
    type: 'image',
    name: '定帧',
    sourceUrl: 'asset://still.png',
    width: 1080,
    height: 1920,
  }, { createId: localIds });
  assert.equal(image.added, true);
  assert.equal(image.project.tracks.find((track) => track.type === 'overlay').clips[0].duration, 4);

  project = appendEditorMediaAsset(image.project, {
    id: 'canvas:audio:one',
    type: 'audio',
    name: '旁白',
    sourceUrl: 'asset://voice.wav',
    duration: 2.5,
  }, { createId: localIds }).project;
  assert.equal(project.tracks.find((track) => track.type === 'audio').clips[0].trimEnd, 2.5);
});

test('空白剪辑工程无需源视频即可初始化', () => {
  const project = normalizeVideoEditorProject(undefined, {
    sourceFile: '',
    sourceUrl: '',
    duration: 0,
  });
  assert.equal(project.schema, 'shotloom.video-edit');
  assert.deepEqual(project.assets, []);
  assert.equal(project.tracks.find((track) => track.type === 'video').clips.length, 0);
  assert.equal(videoEditorDuration(project), 0);
});

const ids = (() => {
  let value = 0;
  return (prefix) => `${prefix}-${++value}`;
})();

test('完整剪辑工程从旧片段迁移为多轨 JSON', () => {
  const project = normalizeVideoEditorProject(
    {
      version: 1,
      sourceFile: '/tmp/a.mp4',
      sourceDuration: 10,
      segments: [{ id: 'a', start: 1, end: 5, speed: 2, muted: true }],
    },
    { sourceFile: '/tmp/a.mp4', sourceUrl: 'asset://a', duration: 10, createId: ids },
  );
  assert.equal(project.version, 2);
  assert.equal(project.schema, 'shotloom.video-edit');
  assert.equal(project.tracks[0].type, 'video');
  assert.equal(project.tracks[0].clips[0].timelineStart, 0);
  assert.equal(videoEditorDuration(project), 2);
});





test('重叠视频优先播放时间线上后出现的片段', () => {
  const clips = [
    { id: 'first', type: 'video', timelineStart: 0, trimStart: 0, trimEnd: 6, speed: 1 },
    { id: 'second', type: 'video', timelineStart: 4, trimStart: 0, trimEnd: 6, speed: 1 },
  ];
  assert.equal(activeEditorClip(clips, 3).id, 'first');
  assert.equal(activeEditorClip(clips, 5).id, 'second');
  assert.equal(activeEditorClip(clips, 10), null);
});

test('拖动视频片段时开头和结尾都会吸附相邻边界', () => {
  const project = createVideoEditorProject({ sourceUrl: 'asset://a', duration: 5, createId: ids });
  const track = project.tracks[0];
  const first = track.clips[0];
  const next = addEditorClip(project, track.id, {
    ...first,
    id: 'second',
    timelineStart: 7,
  }, ids);
  assert.equal(snapEditorClipStart(next, 'second', 5.08, .1), 5);
  assert.equal(snapEditorClipStart(next, first.id, 1.92, .1), 2);
  assert.equal(snapEditorClipStart(next, 'second', 6, .1), 6);
});

test('吸附按「片段边缘 > 播放头 > 网格」优先，而不是单纯取最近', () => {
  const project = createVideoEditorProject({ sourceUrl: 'asset://a', duration: 5, createId: ids });
  const track = project.tracks[0];
  const first = track.clips[0];
  const next = addEditorClip(project, track.id, { ...first, id: 'second', timelineStart: 7 }, ids);

  // 片段边缘（5）比更近的播放头（5.06）优先。
  assert.equal(
    snapEditorClipStart(next, 'second', 5.04, .1, { playhead: 5.06 }),
    5,
  );
  // 没有片段边缘在容差内时才轮到播放头。
  assert.equal(
    snapEditorClipStart(next, 'second', 6.05, .1, { playhead: 6 }),
    6,
  );
  // 网格优先级最低：1 秒网格在容差内时生效。
  assert.equal(
    snapEditorClipStart(next, 'second', 2.03, .1, { gridSize: 1 }),
    2,
  );
  // 未提供播放头或网格时不吸附到它们，保持原有行为。
  assert.equal(snapEditorClipStart(next, 'second', 2.03, .1), 2.03);
  assert.equal(snapEditorClipStart(next, 'second', 2.03, .1, { gridSize: 0 }), 2.03);
});

test('拖动裁剪手柄调整入出点，右端固定且不越过最小时长', () => {
  const project = createVideoEditorProject({ sourceUrl: 'asset://a', duration: 10, createId: ids });
  const clip = project.tracks[0].clips[0];
  const origin = { timelineStart: clip.timelineStart, trimStart: 0, trimEnd: 10 };
  const rightEdge = clip.timelineStart + editorClipDuration(clip);

  // 裁左边：时间线起点与源入点同向移动，右端不动。
  const trimmedStart = trimEditorClip(project, clip.id, 'start', 2, origin);
  const afterStart = trimmedStart.tracks[0].clips[0];
  assert.equal(afterStart.trimStart, 2);
  assert.equal(afterStart.timelineStart, 2);
  assert.equal(
    afterStart.timelineStart + editorClipDuration(afterStart),
    rightEdge,
    '裁左边不能让片段右端漂移',
  );

  // 裁右边：出点内移，起点不变。
  const trimmedEnd = trimEditorClip(project, clip.id, 'end', -3, origin);
  const afterEnd = trimmedEnd.tracks[0].clips[0];
  assert.equal(afterEnd.trimEnd, 7);
  assert.equal(afterEnd.timelineStart, 0);

  // 最小时长与素材边界都被钳住。
  const tooShort = trimEditorClip(project, clip.id, 'end', -20, origin);
  assert.equal(
    editorClipDuration(tooShort.tracks[0].clips[0]),
    MIN_DURATION,
    '不能裁到最小时长以下',
  );
  const beyondSource = trimEditorClip(project, clip.id, 'end', 5, origin);
  assert.equal(beyondSource.tracks[0].clips[0].trimEnd, 10, '不能超出素材长度');
  const beforeZero = trimEditorClip(project, clip.id, 'start', -5, origin);
  assert.equal(beforeZero.tracks[0].clips[0].trimStart, 0);
});

test('裁剪每帧都从手势起点算绝对位置，不会把位移叠加', () => {
  const project = createVideoEditorProject({ sourceUrl: 'asset://a', duration: 10, createId: ids });
  const clip = project.tracks[0].clips[0];
  const origin = { timelineStart: clip.timelineStart, trimStart: 0, trimEnd: 10 };

  // 同一段位移重复应用（模拟拖动中每帧重算）必须收敛到同一个结果。
  const first = trimEditorClip(project, clip.id, 'start', 2, origin);
  const second = trimEditorClip(first, clip.id, 'start', 2, origin);
  assert.deepEqual(second.tracks[0].clips[0], first.tracks[0].clips[0]);

  // 变速片段：源时间增量换算到时间轴要除以速度。
  const sped = updateEditorClip(project, clip.id, { speed: 2 });
  const spedOrigin = { timelineStart: 0, trimStart: 0, trimEnd: 10 };
  const spedTrimmed = trimEditorClip(sped, clip.id, 'start', 2, spedOrigin);
  assert.equal(spedTrimmed.tracks[0].clips[0].timelineStart, 1, '变速片段裁 2 源秒只占 1 时间秒');
});

test('跨轨道移动片段：同轨只改时间，跨轨保留片段身份', () => {
  let project = createVideoEditorProject({ sourceUrl: 'asset://a', duration: 5, createId: ids });
  const videoTrack = project.tracks.find((track) => track.type === 'video');
  const clip = videoTrack.clips[0];

  // 同轨：只改时间。
  const moved = moveEditorClip(project, clip.id, videoTrack.id, 3);
  assert.equal(moved.tracks.find((t) => t.id === videoTrack.id).clips[0].timelineStart, 3);

  // 跨轨：片段 id 不变（选中态与引用都靠它），原轨道不再持有它。
  project = moveEditorClip(project, clip.id, videoTrack.id, 1);
  project = addEditorTrack(project, 'video', '补充画面', ids);
  const secondTrack = project.tracks.at(-1);
  const crossTrack = moveEditorClip(project, clip.id, secondTrack.id, 2);
  const inSecond = crossTrack.tracks.find((t) => t.id === secondTrack.id).clips;
  assert.equal(inSecond.length, 1);
  assert.equal(inSecond[0].id, clip.id, '跨轨后必须保留片段 id');
  assert.equal(inSecond[0].timelineStart, 2);
  assert.equal(crossTrack.tracks.find((t) => t.id === videoTrack.id).clips.length, 0);

  // 类型不符与锁定轨道都拒绝，返回原工程。
  const textTrack = addEditorTrack(project, 'text', '文字', ids).tracks.at(-1);
  assert.equal(moveEditorClip(project, clip.id, textTrack.id, 2), project);
  const locked = updateEditorTrack(project, secondTrack.id, { locked: true });
  assert.equal(moveEditorClip(locked, clip.id, secondTrack.id, 2), locked);
  assert.equal(moveEditorClip(project, clip.id, 'missing-track', 2), project);
});

test('空轨道可以删除，但有片段的轨道不会被误删', () => {
  let project = createVideoEditorProject({ sourceUrl: 'asset://a', duration: 5, createId: ids });
  const occupiedTrack = project.tracks.find((track) => track.type === 'video');
  project = addEditorTrack(project, 'video', '空视频轨', ids);
  const emptyTrack = project.tracks.at(-1);

  const withoutEmpty = removeEmptyEditorTrack(project, emptyTrack.id);
  assert.equal(withoutEmpty.tracks.some((track) => track.id === emptyTrack.id), false);
  assert.equal(removeEmptyEditorTrack(withoutEmpty, occupiedTrack.id), withoutEmpty);
  assert.equal(removeEmptyEditorTrack(withoutEmpty, 'missing-track'), withoutEmpty);
});

test('画布变换和文字样式保存在同一工程 JSON', () => {
  let project = createVideoEditorProject({ duration: 5, createId: ids });
  project = addEditorTrack(project, 'text', '字幕', ids);
  const track = project.tracks.at(-1);
  project = addEditorClip(
    project,
    track.id,
    { type: 'text', timelineStart: 0, duration: 2, text: '标题' },
    ids,
  );
  const clip = track.clips?.[0] || project.tracks.at(-1).clips[0];
  project = updateEditorClip(project, clip.id, {
    transform: { ...clip.transform, x: 200, angle: 8 },
    style: { ...clip.style, color: '#d6ff49' },
  });
  const updated = project.tracks.at(-1).clips[0];
  assert.equal(updated.transform.x, 200);
  assert.equal(updated.transform.angle, 8);
  assert.equal(updated.style.color, '#d6ff49');
});

test('文字片段允许清空内容且不会被默认文案重新填充', () => {
  let project = createVideoEditorProject({ duration: 5, createId: ids });
  project = addEditorTrack(project, 'text', '字幕', ids);
  project = addEditorClip(
    project,
    project.tracks.at(-1).id,
    {
      type: 'text',
      timelineStart: 0,
      duration: 2,
      text: '文字',
    },
    ids,
  );
  const clip = project.tracks.at(-1).clips[0];
  project = updateEditorClip(project, clip.id, { text: '' });
  assert.equal(project.tracks.at(-1).clips[0].text, '');
  assert.equal(normalizeVideoEditorProject(project).tracks.at(-1).clips[0].text, '');
});
