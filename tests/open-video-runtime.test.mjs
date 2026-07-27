import assert from 'node:assert/strict';
import test from 'node:test';

import { createOpenVideoProject, createOpenVideoStudioProject } from '../renderer/src/services/openVideoRuntime.js';
import { addEditorClip, addEditorTrack, createVideoEditorProject } from '../renderer/src/utils/videoEditorProject.mjs';

test('OpenVideo 项目桥接把剪辑片段转换成连续主轨并保留源入出点', () => {
  const project = createOpenVideoProject({
    sourceUrl: 'blob:shotloom-video',
    sourceName: 'shot.mp4',
    width: 1280,
    height: 720,
    segments: [
      { id: 'a', start: 2, end: 5 },
      { id: 'b', start: 8, end: 10.5, speed: 2, muted: true },
    ],
  });

  assert.equal(project.settings.duration, 4_250_000);
  assert.deepEqual(project.tracks[0].clipIds, ['a', 'b']);
  assert.deepEqual(project.clips.a.timing.display, { from: 0, to: 3_000_000 });
  assert.deepEqual(project.clips.a.timing.trim, { from: 2_000_000, to: 5_000_000 });
  assert.deepEqual(project.clips.b.timing.display, { from: 3_000_000, to: 4_250_000 });
  assert.deepEqual(project.clips.b.timing.trim, { from: 8_000_000, to: 10_500_000 });
  assert.equal(project.clips.b.timing.playbackRate, 2);
  assert.equal(project.clips.b.volume, 0);
});

test('Studio 预览把字幕和贴图交给可交互画布层且不改变工程数据', () => {
  let editor = createVideoEditorProject({ sourceUrl: 'asset://video', duration: 4 });
  editor = addEditorTrack(editor, 'text', '字幕');
  editor = addEditorClip(editor, editor.tracks.at(-1).id, { type: 'text', text: '标题', duration: 2 });
  editor.assets.push({ id: 'image', type: 'image', name: '贴图', sourceUrl: 'asset://image.png', width: 100, height: 100 });
  editor = addEditorTrack(editor, 'overlay', '贴图');
  editor = addEditorClip(editor, editor.tracks.at(-1).id, { type: 'image', assetId: 'image', duration: 2 });
  const preview = createOpenVideoStudioProject(editor);
  assert.equal(Object.values(preview.clips).some((clip) => clip.type === 'Text'), false);
  assert.equal(Object.values(preview.clips).some((clip) => clip.type === 'Image'), false);
  assert.equal(Object.values(preview.clips).some((clip) => clip.type === 'Video'), true);
  assert.equal(editor.tracks.some((track) => track.type === 'text'), true);
  assert.equal(editor.tracks.some((track) => track.type === 'overlay'), true);
});
