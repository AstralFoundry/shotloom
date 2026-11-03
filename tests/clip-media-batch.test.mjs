import test from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';
const env = await createRendererEnv();
test.after(() => env.dispose());
const { importMediaBatch } = await env.load('app/editor/openReel/mediaBatchImport');

const inputs = ['first', 'broken', 'last'].map(key => ({ key, name: `${key}.mp4`, value: key }));

test('批量导入单项失败不丢成功项，按选择顺序一次落轨，重试只含失败项', async () => {
  const library = new Map();
  const placed = [];
  let fail = true;
  let writes = 0;
  const operations = {
    isLive: () => true,
    async import(key) {
      if (key === 'broken' && fail) throw new Error('decode failed');
      if (!library.has(key)) { library.set(key, { id: key }); writes++; }
      return library.get(key);
    },
    async place(items) { placed.push(items.map(item => item.id)); },
  };
  const result = await importMediaBatch(inputs, operations);
  assert.equal(result.imported, 2);
  assert.deepEqual(result.failures, [{ key: 'broken', name: 'broken.mp4', error: 'decode failed' }]);
  assert.deepEqual(placed, [['first', 'last']]);
  fail = false;
  const retry = await importMediaBatch(inputs.filter(input => result.failures.some(f => f.key === input.key)), operations);
  assert.equal(retry.imported, 1);
  assert.deepEqual(retry.failures, []);
  assert.deepEqual(placed, [['first', 'last'], ['broken']]);
  assert.equal(writes, 3);
});

test('落轨事务失败保留媒体身份，全部待落轨项可重试且不报已添加', async () => {
  let fail = true;
  const library = new Map();
  const batches = [];
  const operations = {
    isLive: () => true,
    async import(key) {
      if (!library.has(key)) library.set(key, { id: key });
      return library.get(key);
    },
    async place(items) {
      if (fail) throw new Error('track locked');
      batches.push(items);
    },
  };
  const result = await importMediaBatch(inputs, operations);
  assert.equal(result.imported, 0);
  assert.deepEqual(result.failures.map(f => f.key), ['first', 'broken', 'last']);
  assert.ok(result.failures.every(f => f.error.includes('媒体已入库，尚未放入时间线')));
  const original = [...library.values()];
  fail = false;
  assert.equal((await importMediaBatch(inputs, operations)).imported, 3);
  assert.deepEqual(batches[0], original);
  assert.equal(library.size, 3);
});

test('导入中删除目标后，迟到结果不落轨且不再启动后续导入', async () => {
  let live = true;
  const imported = [];
  let placed = false;
  const result = await importMediaBatch(inputs, {
    isLive: () => live,
    async import(key) { imported.push(key); live = false; return { id: key }; },
    async place() { placed = true; },
  });
  assert.deepEqual(imported, ['first']);
  assert.equal(placed, false);
  assert.equal(result.imported, 0);
  assert.equal(result.failures.length, 3);
});
