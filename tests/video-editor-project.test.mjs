import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addEditorClip,
  addEditorTrack,
  activeEditorClip,
  appendEditorMediaAsset,
  createVideoEditorProject,
  editorProjectToOpenVideo,
  normalizeVideoEditorProject,
  snapEditorClipStart,
  updateEditorClip,
  videoEditorDuration,
} from '../renderer/src/utils/videoEditorProject.mjs';

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

test('多轨工程支持字幕、贴图并转换成 OpenVideo Core 项目', () => {
  let project = createVideoEditorProject({
    sourceFile: '/tmp/a.mp4',
    sourceUrl: 'asset://a',
    duration: 8,
    createId: ids,
  });
  project = addEditorTrack(project, 'text', '字幕', ids);
  const textTrack = project.tracks.find((track) => track.type === 'text');
  project = addEditorClip(
    project,
    textTrack.id,
    { type: 'text', timelineStart: 1, duration: 3, text: '雨夜街头' },
    ids,
  );
  project = addEditorTrack(project, 'overlay', '贴图', ids);
  const overlayTrack = project.tracks.find((track) => track.type === 'overlay');
  project.assets.push({
    id: 'sticker',
    type: 'image',
    name: '贴图',
    sourceUrl: 'asset://sticker.png',
    duration: 0,
    width: 320,
    height: 320,
  });
  project = addEditorClip(
    project,
    overlayTrack.id,
    { type: 'image', assetId: 'sticker', timelineStart: 2, duration: 4 },
    ids,
  );
  const openVideo = editorProjectToOpenVideo(project);
  assert.equal(openVideo.tracks.length, 4);
  assert.equal(Object.values(openVideo.clips).filter((clip) => clip.type === 'Text').length, 1);
  assert.equal(Object.values(openVideo.clips).filter((clip) => clip.type === 'Image').length, 1);
  assert.equal(openVideo.settings.duration, 8_000_000);
  const video = Object.values(openVideo.clips).find((clip) => clip.type === 'Video');
  assert.equal(video.audio, true);
  assert.equal(video.volume, 1);
  assert.ok(
    openVideo.tracks.findIndex((track) => track.type === 'Text') <
      openVideo.tracks.findIndex((track) => track.type === 'Video'),
  );
  assert.ok(
    openVideo.tracks.findIndex((track) => track.type === 'Image') <
      openVideo.tracks.findIndex((track) => track.type === 'Video'),
  );
});

test('视频静音只归零预览音量，不移除可重新开启的内嵌音轨', () => {
  let project = createVideoEditorProject({ sourceUrl: 'asset://a', duration: 4, createId: ids });
  const video = project.tracks[0].clips[0];
  project = updateEditorClip(project, video.id, { muted: true });
  const converted = Object.values(editorProjectToOpenVideo(project).clips).find(
    (clip) => clip.type === 'Video',
  );
  assert.equal(converted.audio, true);
  assert.equal(converted.volume, 0);
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
  assert.equal(
    Object.values(editorProjectToOpenVideo(project).clips).find((item) => item.type === 'Text')
      .text,
    '',
  );
});

test('文字协议关闭会吞掉字面颜色的 OpenVideo 默认描边', () => {
  let project = createVideoEditorProject({ duration: 3, width: 1280, height: 720 });
  project = addEditorTrack(project, 'text', '字幕');
  project = addEditorClip(project, project.tracks.at(-1).id, {
    type: 'text',
    text: '黄色文字',
    duration: 2,
    style: { color: '#ffff00', stroke: { color: '#000', width: 9 } },
  });
  const clip = project.tracks.at(-1).clips[0];
  assert.equal(clip.style.color, '#ffff00');
  assert.deepEqual(clip.style.stroke, { color: '#000000', width: 0 });
});

test('OpenVideo 转场和特效保留引擎需要的微秒时长', () => {
  let project = createVideoEditorProject({ sourceUrl: 'asset://a', duration: 8, createId: ids });
  const videoTrack = project.tracks.find((track) => track.type === 'video');
  const firstVideo = videoTrack.clips[0];
  project = updateEditorClip(project, firstVideo.id, { trimEnd: 4 });
  project = addEditorClip(
    project,
    videoTrack.id,
    { ...firstVideo, id: 'video-second', timelineStart: 4, trimStart: 4, trimEnd: 8 },
    ids,
  );
  project = addEditorTrack(project, 'effect', '特效', ids);
  project = addEditorClip(
    project,
    project.tracks.at(-1).id,
    { type: 'effect', timelineStart: 1, duration: 2, effectKey: 'vignette' },
    ids,
  );
  project = addEditorTrack(project, 'transition', '转场', ids);
  project = addEditorClip(
    project,
    project.tracks.at(-1).id,
    {
      type: 'transition',
      timelineStart: 3.7,
      duration: 0.6,
      transitionKey: 'fade',
      fromClipId: firstVideo.id,
      toClipId: 'video-second',
    },
    ids,
  );
  const converted = editorProjectToOpenVideo(project);
  const transition = Object.values(converted.clips).find((clip) => clip.type === 'Transition');
  assert.equal(
    Object.values(converted.clips).find((clip) => clip.type === 'Effect').duration,
    2_000_000,
  );
  assert.equal(transition.duration, 600_000);
  assert.equal(converted.tracks[0].type, 'Effect');
  assert.ok(
    converted.tracks.findIndex((track) => track.type === 'Effect') <
      converted.tracks.findIndex((track) => track.type === 'Video'),
  );
  assert.equal(
    converted.tracks.some((track) => track.type === 'Transition'),
    false,
  );
  assert.ok(
    converted.tracks.find((track) => track.type === 'Video').clipIds.includes(transition.id),
  );
});
