import assert from 'node:assert/strict';
import test from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

test('batch 自动预览失败保留真实提交回执，预检不触发渲染', async () => {
  const env = await createRendererEnv({ withWindow: true });
  try {
    const listeners = [];
    window.location = { origin: 'http://localhost' };
    window.addEventListener = (type, callback) => { if (type === 'message') listeners.push(callback); };
    const runtime = await env.load('services/directorDeskAgentRuntime');
    const { registerDirectorTools } = await env.load('agent/tools/directorTools');
    const { allAgentTools } = await env.load('agent/core/toolRegistry');
    registerDirectorTools();
    const operations = [];
    const target = { postMessage(message) {
      const { requestId, operation, args } = message.payload;
      operations.push(operation);
      const response = operation === 'batch_edit'
        ? { success: true, result: { applied: !args.validateOnly, revision: 7 } }
        : operation === 'render_plan'
          ? { success: false, error: 'renderer busy' }
          : { success: true, result: { dataUrl: 'data:image/png;base64,cHJldmlldw==' } };
      queueMicrotask(() => listeners.forEach(callback => callback({ origin: window.location.origin, source: target, data: { type: 'test-result', payload: { requestId, ...response } } })));
    } };
    const unregister = runtime.registerDirectorDeskFrame({ contentWindow: target }, { request: 'test-request', result: 'test-result' });
    const tool = allAgentTools().find(t => t.id === 'director_desk_batch');
    const input = { expectedSessionId: 'session-a', expectedRevision: 6, edits: [{ operation: 'set_room', patch: { width: 8 } }], autoPreview: { timesSec: [0, 2], plan: true } };
    const result = await tool.execute(input, {});
    assert.equal(result.applied, true);
    assert.equal(result.success, true);
    assert.equal(result.revision, 7);
    assert.equal(result.__toolAttachments.length, 1);
    assert.deepEqual(result.previewErrors, ['renderer busy']);
    assert.deepEqual(operations, ['batch_edit', 'render_preview_sheet', 'render_plan']);
    operations.length = 0;
    const checked = await tool.execute({ ...input, validateOnly: true }, {});
    assert.equal(checked.applied, false);
    assert.deepEqual(operations, ['batch_edit']);
    unregister();
  } finally { await env.dispose(); }
});
