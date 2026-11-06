/**
 * 模板实例化：创建真实画布节点与连线，并记录固定版本的实例。
 */
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env;
let instanceService;
let templateService;
let store;
let normalization;

before(async () => {
  env = await createRendererEnv({ storage: new Map(), withWindow: true });
  instanceService = await env.load('services/workflowInstanceService');
  templateService = await env.load('services/workflowTemplateService');
  ({ store } = await env.load('store/projectStore'));
  normalization = await env.load('store/projectNormalization');
});

beforeEach(() => {
  store.project = {
    ...normalization.createProject(),
    id: 'project-instance',
    name: '实例测试',
    materials: [{ id: 'm1', name: '参考图', path: '/tmp/a.png', resourceType: 'image', mimeType: 'image/png' }],
    nodes: [],
    edges: [],
    tasks: [],
  };
});

after(async () => {
  await env?.dispose();
});

function buildTemplate() {
  return templateService.buildWorkflowTemplate({
    name: '雨夜镜头',
    nodes: [
      { id: 'shot', type: 'imageGeneration', title: '首帧', status: 'completed', prompt: '雨夜街道', model: 'gpt-image-2.6-sunburst', config: {} },
    ],
    edges: [],
    selection: ['shot'],
    tasks: [{ id: 't1', nodeId: 'shot', status: 'completed', completedAt: '2026-11-06T10:00:00Z' }],
  });
}

test('实例化：按计划创建节点与连线并记录实例版本', () => {
  const template = buildTemplate();
  const before = store.project.nodes.length;
  const { instance, plan } = instanceService.instantiateWorkflowTemplate(template);

  assert.equal(plan.issues.length, 0);
  assert.equal(store.project.nodes.length, before + 1);
  const created = store.project.nodes.at(-1);
  assert.equal(created.type, 'imageGeneration');
  assert.equal(created.prompt, '雨夜街道');
  assert.equal(created.workflowTemplateId, template.id);
  assert.equal(created.workflowTemplateRevision, 1);

  assert.equal(store.project.workflowInstances.length, 1);
  assert.equal(instance.templateRevision, 1);
  assert.equal(instance.status, 'planned');
  assert.equal(instance.nodeIds.shot, created.id);
});

test('实例化：输入槽位绑定素材后创建资源节点并连线', () => {
  const template = templateService.buildWorkflowTemplate({
    name: '带参考',
    nodes: [
      { id: 'ref', type: 'resource', title: '参考', materialId: 'm1', resourceType: 'image' },
      { id: 'shot', type: 'imageGeneration', title: '首帧', status: 'completed', prompt: '雨夜街道', model: 'gpt-image-2.6-sunburst' },
    ],
    edges: [{ source: 'ref', target: 'shot' }],
    selection: ['ref', 'shot'],
    tasks: [{ id: 't1', nodeId: 'shot', status: 'completed', completedAt: '2026-11-06T10:00:00Z' }],
  });

  const { instance } = instanceService.instantiateWorkflowTemplate(template, { bindings: { ref: 'm1' } });
  const resource = store.project.nodes.find((node) => node.id === instance.nodeIds.ref);
  assert.equal(resource.type, 'resource');
  assert.equal(resource.materialId, 'm1');
  assert.equal(resource.filePath, '/tmp/a.png');

  const edge = store.project.edges.find((item) => item.source === instance.nodeIds.ref && item.target === instance.nodeIds.shot);
  assert.ok(edge, '资源节点应连到生成节点');
  assert.equal(edge.kind, 'workflow');
});

test('实例化：缺绑定在写画布前失败，节点数量不变', () => {
  const template = templateService.buildWorkflowTemplate({
    name: '缺绑定',
    nodes: [
      { id: 'ref', type: 'resource', title: '参考', materialId: 'm1', resourceType: 'image' },
      { id: 'shot', type: 'imageGeneration', title: '首帧', status: 'completed', prompt: '雨夜街道', model: 'gpt-image-2.6-sunburst' },
    ],
    edges: [{ source: 'ref', target: 'shot' }],
    selection: ['ref', 'shot'],
    tasks: [{ id: 't1', nodeId: 'shot', status: 'completed' }],
  });
  // 清掉模板里保存的绑定，模拟用户尚未选择素材。
  template.definition.nodes = template.definition.nodes.map((node) => {
    const clone = { ...node };
    delete clone.resourceId;
    return clone;
  });

  const before = store.project.nodes.length;
  assert.throws(
    () => instanceService.instantiateWorkflowTemplate(template),
    (error) => String(error.message).includes('missing-input:ref'),
  );
  assert.equal(store.project.nodes.length, before);
  assert.equal(store.project.workflowInstances?.length || 0, 0);
});

test('实例化：两次创建产生两个独立实例，互不共享节点', () => {
  const template = buildTemplate();
  const first = instanceService.instantiateWorkflowTemplate(template);
  const second = instanceService.instantiateWorkflowTemplate(template);
  assert.notEqual(first.instance.id, second.instance.id);
  assert.notEqual(first.instance.nodeIds.shot, second.instance.nodeIds.shot);
  assert.equal(store.project.workflowInstances.length, 2);
});
