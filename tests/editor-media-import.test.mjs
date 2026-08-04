import assert from 'node:assert/strict';
import test from 'node:test';

import {
  editorMediaMimeType,
  inferEditorMediaType,
  probeEditorMedia,
} from '../renderer/src/utils/editorMediaImport.mjs';

test('剪辑素材按文件类型选择媒体元素和 MIME', () => {
  assert.equal(inferEditorMediaType('/tmp/clip.MOV'), 'video');
  assert.equal(inferEditorMediaType('/tmp/music.m4a'), 'audio');
  assert.equal(inferEditorMediaType('/tmp/frame.webp'), 'image');
  assert.equal(editorMediaMimeType('/tmp/clip.mov'), 'video/quicktime');
  assert.equal(editorMediaMimeType('/tmp/clip.webm'), 'video/webm');
});

test('本地资源协议失败后使用一次性 Blob 读取视频元数据', async () => {
  const urls = [];
  const revoked = [];
  const createElement = () => {
    const listeners = new Map();
    return {
      duration: 9.5,
      videoWidth: 1920,
      videoHeight: 1080,
      addEventListener(name, callback) { listeners.set(name, callback); },
      removeEventListener(name) { listeners.delete(name); },
      set src(value) {
        queueMicrotask(() => listeners.get(value.startsWith('blob:') ? 'loadedmetadata' : 'error')?.());
      },
      load() {},
    };
  };
  const facts = await probeEditorMedia({
    type: 'video',
    sourceFile: '/tmp/clip.mp4',
    sourceUrl: 'asset://clip.mp4',
    createElement,
    readArrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    probeNative: async () => ({ duration: null, width: null, height: null }),
    createObjectUrl: () => {
      urls.push('blob:clip');
      return 'blob:clip';
    },
    revokeObjectUrl: (url) => revoked.push(url),
    timeoutMs: 100,
  });
  assert.deepEqual(facts, { duration: 9.5, width: 1920, height: 1080 });
  assert.deepEqual(urls, ['blob:clip']);
  assert.deepEqual(revoked, ['blob:clip']);
});
