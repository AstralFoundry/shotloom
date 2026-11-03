import assert from 'node:assert/strict';
import test from 'node:test';
import { inferMediaType, mediaExtension } from '../renderer/src/utils/mediaType.ts';

import {
  editorMediaMimeType,
  inferEditorMediaType,
  probeEditorMedia,
} from '../renderer/src/utils/editorMediaImport.ts';

test('剪辑素材按文件类型选择媒体元素和 MIME', () => {
  assert.equal(inferEditorMediaType('/tmp/clip.MOV'), 'video');
  assert.equal(inferEditorMediaType('/tmp/music.m4a'), 'audio');
  assert.equal(inferEditorMediaType('/tmp/frame.webp'), 'image');
  assert.equal(editorMediaMimeType('/tmp/clip.mov'), 'video/quicktime');
  assert.equal(editorMediaMimeType('/tmp/clip.webm'), 'video/webm');
});

test('公共媒体判定使用真实文件路径和有效 MIME，展示名称与泛型标签不能遮住事实', () => {
  assert.equal(inferMediaType({ name: '第一个镜头', path: '/tmp/clip.MOV' }), 'video');
  assert.equal(inferMediaType({ fileName: '对白', remoteUrl: 'https://cdn.example.com/voice.m4a?token=x' }), 'audio');
  assert.equal(inferMediaType({ resourceType: 'file', mimeType: 'image/png' }), 'image');
  assert.equal(inferMediaType({ resourceType: 'image', mimeType: 'video/mp4' }), 'image');
  assert.equal(mediaExtension({ ext: '.WEBP', name: '封面' }), 'webp');
  assert.equal(mediaExtension('/tmp/folder.with.dot/无扩展名'), '');
  assert.equal(inferMediaType('/tmp/document.unknown'), 'file');
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
