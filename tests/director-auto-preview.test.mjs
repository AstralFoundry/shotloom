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
    const { allAgentTools, validateToolInput } = await env.load('agent/core/toolRegistry');
    registerDirectorTools();
    const operations = [];
    let failure;
    const target = { postMessage(message) {
      const { requestId, operation, args } = message.payload;
      operations.push(operation);
      const response = failure ?? (operation === 'batch_edit'
        ? { success: true, result: { applied: !args.validateOnly, revision: 7 } }
        : operation === 'render_plan'
          ? { success: false, error: 'renderer busy' }
          : { success: true, result: { dataUrl: 'data:image/png;base64,cHJldmlldw==' } });
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
    for (const scale of [2, [1, 2, 3]]) {
      validateToolInput(tool.inputSchema, { ...input, edits: [{ operation: 'set_entity', entityId: 'actor', patch: { scale } }] });
      validateToolInput(tool.inputSchema, { ...input, edits: [{ operation: 'add_asset', assetId: 'person', scale, color: '#446688' }] });
    }
    assert.throws(() => validateToolInput(tool.inputSchema, { ...input, edits: [{ operation: 'set_entity', entityId: 'actor', patch: { scale: [1, 2] } }] }));
    failure = { success: false, code: 'INVALID_PARAMS', error: '太阳光强度需要 0 至 100 的数值或 keys 关键帧',
      hint: '用 validateOnly:true 预检', facts: { editIndex: 1, receivedEdit: { operation: 'set_lighting', patch: { sunIntensity: '1' } }, patchFields: { sunIntensity: { minimum: 0, maximum: 100 } } } };
    const rejected = await tool.execute(input, {});
    assert.equal(rejected.success, false);
    assert.equal(rejected.applied, false);
    assert.equal(rejected.code, 'INVALID_PARAMS');
    assert.equal(rejected.editIndex, 1);
    assert.equal(rejected.patchFields.sunIntensity.maximum, 100);
    assert.deepEqual(rejected.receivedEdit, failure.facts.receivedEdit);
    assert.equal(rejected.hint, failure.hint);
    unregister();
  } finally { await env.dispose(); }
});

test('导演台 patch 在工具入口区分数值、关键帧与向量，不放行字符串或嵌套数组', async () => {
  const env = await createRendererEnv({ withWindow: true });
  try {
    const { registerDirectorTools } = await env.load('agent/tools/directorTools');
    const { allAgentTools, validateToolInput } = await env.load('agent/core/toolRegistry');
    registerDirectorTools();
    const schema = allAgentTools().find(tool => tool.id === 'director_desk_batch').inputSchema;
    const patchSchema = schema.properties.edits.items.properties.patch;
    const { patchFieldCatalog } = await env.loadVendor('shotloom-director-desk/src/core/editor/patch-fields.ts');
    for (const command of ['set_camera_field', 'set_light_field', 'set_lighting_field', 'update_room', 'update_project_settings']) {
      for (const field of Object.keys(patchFieldCatalog[command])) assert.ok(patchSchema.properties[field], `${command}.${field}`);
    }
    const input = patch => ({ expectedSessionId: 'scene', expectedRevision: 0, validateOnly: true, edits: [{ operation: 'set_lighting', patch }] });
    for (const patch of [
      { ambient: 0.85, exposure: 1, sunIntensity: 1.4, sunDirection: [-4, 8, -6] },
      { ambient: { keys: [{ time: 0, value: 1, easing: 'linear' }, { time: 2, value: 2 }] } },
      { fog: { color: '#8899aa', density: { keys: [{ time: 0, value: 0.1 }] } } },
    ]) assert.doesNotThrow(() => validateToolInput(schema, input(patch)));
    for (const patch of [
      { ambient: '0.85' }, { exposure: '1' }, { sunIntensity: { value: 1 } },
      { ambient: { keys: [{ time: 0, value: '1' }] } }, { sunDirection: [[-4, 8, -6]] },
      { fog: { color: '#8899aa', density: '0.1' } }, { defaultLights: 'false' },
      { ambient: 21 }, { exposure: 0 }, { sunIntensity: -1 },
      { intensity: '100' }, { temperature: { keys: [{ time: 0, value: '3000' }] } },
      { target: [[0, 1, 2]] }, { focalKeys: { keys: [{ time: 0, value: 35 }] } },
      { targetPath: { smooth: false, points: [{ time: 0, position: ['0', 1, 2] }] } },
      { flicker: { strength: 0.2, frequency: '2', seed: 1 } }, { parameters: { width: '2' } },
    ]) assert.throws(() => validateToolInput(schema, input(patch)), undefined, JSON.stringify(patch));
  } finally { await env.dispose(); }
});
