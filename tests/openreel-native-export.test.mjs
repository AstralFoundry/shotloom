import assert from 'node:assert/strict';
import test from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

test('native editor export scopes opaque jobs and cancels unfinished jobs on dispose', async () => {
  const env = await createRendererEnv({ withWindow: true });
  try {
    const calls = [];
    let valid = true, nextId = 0;
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      calls.push({ command, args });
      if (command === 'openreel_export_start') return `job-${++nextId}`;
      if (command === 'openreel_export_finish') return { filePath: '/project/assets/actual.webm', filename: 'actual.webm', size: 50, codec: 'vp9', format: 'webm' };
    } };
    const { createNativeEditorExport } = await env.load('services/openReelNativeExport');
    const owner = createNativeEditorExport('/project', () => { if (!valid) throw new Error('stale project'); });
    const id = await owner.bridge.start({ width: 2, height: 2, totalFrames: 1, frameRate: 1, codec: 'vp9', format: 'webm', audioSampleRate: 48000, audioChannels: 2 });
    await assert.rejects(owner.bridge.write('another-node-job', 'frame', new ArrayBuffer(16), 0), /不属于/);
    await owner.bridge.write(id, 'audio', Uint8Array.from([1, 2, 255]).buffer, 0);
    assert.equal(calls.at(-1).args.data, 'AQL/');
    valid = false;
    const count = calls.length;
    await assert.rejects(owner.bridge.finish(id), /stale project/);
    assert.equal(calls.length, count);
    await owner.dispose();
    assert.equal(calls.at(-1).command, 'openreel_export_cancel');
    assert.equal(calls.at(-1).args.jobId, id);
    await owner.dispose();
    assert.equal(calls.length, count + 1);
  } finally { await env.dispose(); }
});

test('native export cancels a job when ownership changes while start is pending', async () => {
  const env = await createRendererEnv({ withWindow: true });
  try {
    let valid = true;
    const cancelled = [];
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      if (command === 'openreel_export_start') { valid = false; return 'pending-job'; }
      if (command === 'openreel_export_cancel') cancelled.push(args.jobId);
    } };
    const { createNativeEditorExport } = await env.load('services/openReelNativeExport');
    const owner = createNativeEditorExport('/project', () => { if (!valid) throw new Error('switched node'); });
    await assert.rejects(owner.bridge.start({}), /switched node/);
    assert.deepEqual(cancelled, ['pending-job']);
    await owner.dispose();
    assert.deepEqual(cancelled, ['pending-job']);
  } finally { await env.dispose(); }
});

test('native export bridge localizes explicit IPC errors in both languages and preserves upstream errors', async () => {
  for (const [locale, expected] of [
    ['zh-CN', '未找到原生导出会话'],
    ['en-US', 'Native export session not found'],
  ]) {
    const env = await createRendererEnv({ withWindow: true, storage: new Map([['shotloom:locale', locale]]) });
    try {
      let failure = JSON.stringify({ type: 'shotloom:localized-error', key: 'native.error.cf621a4f6c', params: {}, fallback: 'fallback' });
      window.__TAURI_INTERNALS__ = { invoke: async () => { throw failure; } };
      const { createNativeEditorExport } = await env.load('services/openReelNativeExport');
      const owner = createNativeEditorExport('/project', () => {});
      await assert.rejects(owner.bridge.start({}), { message: expected });
      failure = 'upstream raw {detail}';
      await assert.rejects(owner.bridge.start({}), error => error === failure);
      await owner.dispose();
    } finally { await env.dispose(); }
  }
});
