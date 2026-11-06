/**
 * 模板持久化：只增 revision、内容不变不空转、损坏记录读入时剔除。
 */
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env;
let service;
let store;

const storage = new Map();
const STORAGE_KEY = 'shotloom:workflow-templates';

before(async () => {
  env = await createRendererEnv({ storage, withWindow: true });
  service = await env.load('services/workflowTemplateService');
  store = await env.load('store/workflowTemplateStore');
});

beforeEach(() => {
  storage.clear();
  store.resetWorkflowTemplateStore();
});

after(async () => {
  await env?.dispose();
});

function fixture() {
  return {
    nodes: [
      { id: 'ref', type: 'resource', title: '参考', materialId: 'm1', resourceType: 'image' },
      { id: 'shot', type: 'imageGeneration', title: '首帧', status: 'completed', prompt: '雨夜街道', model: 'gpt-image-2.6-sunburst', config: { ratio: '16:9' } },
    ],
    edges: [{ source: 'ref', target: 'shot' }],
    tasks: [{ id: 't1', nodeId: 'shot', status: 'completed', completedAt: '2026-11-06T10:00:00Z' }],
    selection: ['ref', 'shot'],
  };
}

test('新建模板：默认命名、槽位文案与私有配方', () => {
  const template = service.buildWorkflowTemplate({ ...fixture(), now: '2026-11-06T12:00:00.000Z' });
  assert.equal(template.name, '未命名工作流');
  assert.equal(template.revision, 1);
  assert.equal(template.definition.outputNodeIds[0], 'shot');
  assert.deepEqual(template.definition.nodes.map((node) => node.title).sort(), ['图片输入', '生成图片']);
  assert.equal(template.recipe.shot.prompt, '雨夜街道');
  assert.equal(template.recipe.shot.sourceTaskId, 't1');

  const shareable = service.templateShareableCopy(template, '2026-11-06T12:30:00.000Z');
  assert.equal(JSON.stringify(shareable).includes('雨夜街道'), false);
  assert.equal(JSON.stringify(shareable).includes('m1'), false);
});

test('保存与加载：跨会话仍在，revision 不空转', async () => {
  const template = service.buildWorkflowTemplate({ ...fixture(), now: '2026-11-06T12:00:00.000Z' });
  const saved = await store.saveWorkflowTemplate(template);
  assert.equal(saved.revision, 1);
  assert.equal(store.workflowTemplateStore.templates.length, 1);

  const again = await store.saveWorkflowTemplate(template);
  assert.equal(again.revision, 1, '内容没变不应递增 revision');

  store.resetWorkflowTemplateStore();
  const loaded = await store.loadWorkflowTemplates();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, template.id);
  assert.equal(loaded[0].name, template.name);
});

test('更新模板：内容变化才 +1，createdAt 保持不变', async () => {
  const template = service.buildWorkflowTemplate({ ...fixture(), now: '2026-11-06T12:00:00.000Z' });
  await store.saveWorkflowTemplate(template);

  const updated = await store.saveWorkflowTemplate({
    ...template,
    recipe: { shot: { ...template.recipe.shot, prompt: '雨夜街道，广角' } },
  });
  assert.equal(updated.revision, 2);
  assert.equal(updated.createdAt, template.createdAt);
  assert.notEqual(updated.updatedAt, template.updatedAt);

  store.resetWorkflowTemplateStore();
  const [reloaded] = await store.loadWorkflowTemplates();
  assert.equal(reloaded.revision, 2);
  assert.equal(reloaded.recipe.shot.prompt, '雨夜街道，广角');
});

test('删除模板：内存与存储同时清空', async () => {
  const template = service.buildWorkflowTemplate(fixture());
  await store.saveWorkflowTemplate(template);
  assert.equal(await store.deleteWorkflowTemplate(template.id), true);
  assert.equal(store.workflowTemplateStore.templates.length, 0);

  store.resetWorkflowTemplateStore();
  assert.deepEqual(await store.loadWorkflowTemplates(), []);
  assert.equal(storage.get(STORAGE_KEY).includes(template.id), false);
});

test('读入时剔除损坏模板并报告数量', async () => {
  storage.set(STORAGE_KEY, JSON.stringify({
    storageVersion: 1,
    templates: [
      { id: 'broken', name: '坏模板', definition: { version: 1, nodes: [], edges: [], outputNodeIds: [] } },
      service.buildWorkflowTemplate(fixture()),
    ],
  }));
  const loaded = await store.loadWorkflowTemplates();
  assert.equal(loaded.length, 1);
  assert.equal(store.workflowTemplateStore.error, 'invalid-templates:1');
});

test('未成功运行的步骤无法生成模板', () => {
  const input = fixture();
  input.nodes[1].status = 'running';
  assert.throws(
    () => service.buildWorkflowTemplate(input),
    (error) => error.code === 'not-run',
  );
});
