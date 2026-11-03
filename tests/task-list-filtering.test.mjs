import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { createRendererEnv } from './helpers/rendererSsr.mjs';

const historicalFailure = {
  id: 'a1b2c3d4e5',
  title: '三清三人组参考板',
  type: 'imageGeneration',
  status: 'error',
  model: 'gpt-image-2.5-sunburst',
  nodeId: 'node-9',
  historical: true,
  error: '模型网络请求失败：error sending request for url (https://api.openai.com/v1/images/generations)',
};

let env;
let taskSearchText;
let taskStatusFilters;
let splitTaskError;

before(async () => {
  env = await createRendererEnv({ storage: new Map(), withWindow: true });
  ({ taskSearchText, taskStatusFilters, splitTaskError } = await env.load('app/adapters/taskAdapter'));
});

after(() => env.dispose());

test('任务搜索命中界面上看得见的中文标签，而不只是原始枚举', () => {
  const haystack = taskSearchText(historicalFailure);
  // 之前只拼 type/status 的英文枚举，输入「图片生成」「历史模型」一条都搜不到。
  // 「错误」是这一行换模型之前的真实结果，状态筛选按它分桶，搜索也要按它命中。
  for (const term of ['图片生成', '历史模型', '错误', '三清三人组参考板', 'gpt-image-2.5-sunburst', 'node-9', '#b2c3d4e5']) {
    assert.ok(haystack.includes(term), `搜不到界面上的 ${term}`);
  }
  assert.ok(haystack.includes('imagegeneration'), '原始枚举也要能搜，便于直接贴日志');
});

test('上游错误拆成中文摘要与原始细节，细节不丢', () => {
  assert.deepEqual(splitTaskError(historicalFailure.error), {
    summary: '模型网络请求失败',
    detail: 'error sending request for url (https://api.openai.com/v1/images/generations)',
  });
  // URL 能看出请求实际打到了哪个厂商，必须留在界面上而不是被摘要吃掉。
  assert.deepEqual(splitTaskError('上游没有返回原因'), { summary: '上游没有返回原因', detail: '' });
});

test('状态筛选按任务真实状态分桶', () => {
  const buckets = Object.fromEntries(taskStatusFilters.map((filter) => [filter.key, filter]));
  assert.deepEqual(Object.keys(buckets), ['all', 'active', 'failed', 'completed']);
  assert.equal(buckets.active.match({ status: 'queued' }), true);
  assert.equal(buckets.active.match({ status: 'running' }), true);
  for (const status of ['failed', 'timeout', 'cancelled', 'error']) {
    assert.equal(buckets.failed.match({ status }), true, status);
  }
  assert.equal(buckets.completed.match({ status: 'completed' }), true);
  // 历史任务的底层状态仍是它当时的结果，换模型不会把它洗成已完成。
  assert.equal(buckets.failed.match(historicalFailure), true);
  assert.equal(buckets.completed.match({ status: 'error' }), false);
  assert.equal(buckets.active.match({ status: 'idle' }), false);
});
