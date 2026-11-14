import assert from 'node:assert/strict';
import test from 'node:test';
import { sendDirectorDeskSession, subscribeDirectorDesk } from '../renderer/src/app/adapters/directorDeskBridge.ts';

test('导演台会话携带宿主语言，不创建独立语言设置', () => {
  const previousWindow = globalThis.window;
  const messages = [];
  globalThis.window = { location: { origin: 'https://shotloom.test' } };
  try {
    sendDirectorDeskSession({ contentWindow: { postMessage(message) { messages.push(message); } } }, {
      instanceId: 'director-1', theme: 'light', locale: 'en-US', project: null,
    });
    assert.deepEqual(messages, [{ type: 'storyai:director-desk-session', payload: {
      instanceId: 'director-1', theme: 'light', locale: 'en-US', project: null,
    } }]);
  } finally {
    globalThis.window = previousWindow;
  }
});

test('导演台内部删除消息不能删除画布节点，其他同源消息仍可处理', () => {
  const previousWindow = globalThis.window;
  const listeners = new Map();
  const frameWindow = {};
  const received = [];
  globalThis.window = {
    location: { origin: 'https://shotloom.test' },
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
  };

  try {
    const unsubscribe = subscribeDirectorDesk(() => ({ contentWindow: frameWindow }), {
      onReady() { received.push('ready'); },
      onInteraction() {},
      onExitInteraction() {},
      onOpenAgent(entityId) { received.push(['open-agent', entityId]); },
      onPanoramaRemoved() {},
      onProjectChanged(project) { received.push(project); },
      onCaptures() {},
    });
    const dispatch = (type, payload) => listeners.get('message')({
      origin: 'https://shotloom.test',
      source: frameWindow,
      data: { type, payload },
    });

    assert.doesNotThrow(() => dispatch('storyai:director-desk-delete-node'));
    assert.deepEqual(received, []);
    dispatch('storyai:director-desk-project-changed', { project: { format: 'director-desk' } });
    assert.deepEqual(received, [{ format: 'director-desk' }]);
    dispatch('storyai:director-desk-open-agent');
    dispatch('storyai:director-desk-open-agent', { entityId: 'building-1' });
    assert.deepEqual(received, [{ format: 'director-desk' }, ['open-agent', undefined], ['open-agent', 'building-1']]);
    unsubscribe();
    assert.equal(listeners.has('message'), false);
  } finally {
    globalThis.window = previousWindow;
  }
});

test('导演台导出消息区分截图和视频，并在画布保存后回执', async () => {
  const previousWindow = globalThis.window;
  const listeners = new Map();
  const replies = [];
  const frameWindow = { postMessage(message) { replies.push(message); } };
  const captures = [];
  globalThis.window = {
    location: { origin: 'https://shotloom.test' },
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type) { listeners.delete(type); },
  };
  try {
    const unsubscribe = subscribeDirectorDesk(() => ({ contentWindow: frameWindow }), {
      onReady() {}, onInteraction() {}, onExitInteraction() {}, onPanoramaRemoved() {},
      onProjectChanged() {}, onCaptures(value) { captures.push(...value); },
    });
    const message = (source, kind) => listeners.get('message')({
      origin: 'https://shotloom.test', source,
      data: { type: 'storyai:director-desk-captures-sent', payload: { requestId: 'export-1', captures: [{ dataUrl: 'data:video/webm;base64,AA==', fileName: 'shot.webm', kind }] } },
    });
    message({}, 'video');
    assert.equal(captures.length, 0);
    message(frameWindow, 'video');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(captures, [{ dataUrl: 'data:video/webm;base64,AA==', fileName: 'shot.webm', kind: 'video' }]);
    assert.deepEqual(replies, [{ type: 'storyai:director-desk-captures-saved', payload: { requestId: 'export-1', success: true, outputs: undefined } }]);
    unsubscribe();
  } finally {
    globalThis.window = previousWindow;
  }
});
