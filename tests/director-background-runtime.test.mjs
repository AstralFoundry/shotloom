import assert from 'node:assert/strict';
import test from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

test('后台导演按会话操作指定场景，拒绝其他 iframe 回执且不回退到工作台', async () => {
  const env = await createRendererEnv({ withWindow: true });
  try {
    const listeners = [];
    window.location = { origin: 'http://localhost' };
    window.addEventListener = (type, callback) => { if (type === 'message') listeners.push(callback); };
    const runtime = await env.load('services/directorDeskAgentRuntime');
    const { store } = await env.load('store/projectStore');
    const { registerDirectorTools } = await env.load('agent/tools/directorTools');
    const { allAgentTools } = await env.load('agent/core/toolRegistry');
    store.project.harnessSessions = [{ id: 'director-session', agentId: 'director-primary', directorNodeId: 'scene-a' }];
    const commands = [];
    const source = { postMessage(message) {
      commands.push(message.payload.operation);
      const payload = { requestId: message.payload.requestId, success: true, result: { scene: 'scene-a' } };
      listeners.forEach(fn => fn({ origin: window.location.origin, source: {}, data: { type: 'result', payload: { ...payload, result: { scene: 'spoof' } } } }));
      queueMicrotask(() => listeners.forEach(fn => fn({ origin: window.location.origin, source, data: { type: 'result', payload } })));
    } };
    const stopWorkspace = runtime.registerDirectorDeskFrame({ contentWindow: { postMessage() { throw new Error('Wrong scene'); } } }, { request: 'request', result: 'result' });
    const frame = { contentWindow: source };
    const stop = runtime.registerDirectorDeskFrame(frame, { request: 'request', result: 'result' }, 'scene-a', { background: true, ready: false });
    assert.equal(runtime.directorDeskAvailable('scene-a'), false);
    const launch = runtime.registerDirectorDeskLauncher(nodeId => {
      assert.equal(nodeId, 'scene-a');
      runtime.markDirectorDeskReady(frame);
    });
    await runtime.prepareDirectorDesk('scene-a', { signal: new AbortController().signal });
    assert.equal(runtime.directorDeskHasVisibleFrame('scene-a'), false);
    registerDirectorTools();
    const snapshot = allAgentTools().find(tool => tool.id === 'director_desk_snapshot');
    assert.equal((await snapshot.execute({}, { conversationId: 'director-session' })).scene, 'scene-a');
    assert.deepEqual(commands, ['snapshot']);
    await assert.rejects(runtime.runDirectorDeskCommand('snapshot', {}, 'missing-scene'), /尚未就绪/);
    stop(); stopWorkspace(); launch();
    assert.equal(runtime.directorDeskAvailable('scene-a'), false);
  } finally { await env.dispose(); }
});

test('后台场景准备响应取消和工程切换', async () => {
  const env = await createRendererEnv({ withWindow: true });
  try {
    const runtime = await env.load('services/directorDeskAgentRuntime');
    const { getAgentProjectIdentity } = await env.load('services/agentProjectIdentity');
    const identity = getAgentProjectIdentity();
    const { store } = await env.load('store/projectStore');
    const disposeFrame = runtime.registerDirectorDeskFrame({ contentWindow: {} }, { request: 'request', result: 'result' }, 'old-scene');
    assert.equal(runtime.directorDeskAvailable('old-scene'), true);
    store.project = { ...store.project, id: 'another-project' };
    assert.equal(runtime.directorDeskAvailable('old-scene'), false);
    disposeFrame();
    const stop = runtime.registerDirectorDeskLauncher(() => {});
    const controller = new AbortController();
    const preparation = runtime.prepareDirectorDesk('scene-a', { signal: controller.signal });
    controller.abort();
    await assert.rejects(preparation, /取消/);
    await assert.rejects(runtime.prepareDirectorDesk('scene-a', { projectKey: `${identity.projectKey}-stale`, signal: controller.signal }), /./);
    stop();
  } finally { await env.dispose(); }
});
