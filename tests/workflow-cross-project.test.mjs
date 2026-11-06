/**
 * 模板是全局的、素材是项目局的：跨项目应用时必须重新绑定输入，不能沿用旧素材 id。
 */
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env;
let templateService;
let instanceService;
let instancePlanner;
let store;
let settingsStore;
let normalization;

before(async () => {
  env = await createRendererEnv({ storage: new Map(), withWindow: true });
  templateService = await env.load('services/workflowTemplateService');
  instanceService = await env.load('services/workflowInstanceService');
  instancePlanner = await env.load('domain/workflow/instance');
  ({ store } = await env.load('store/projectStore'));
  ({ settingsStore } = await env.load('store/settingsStore'));
  normalization = await env.load('store/projectNormalization');
});

beforeEach(() => {
  settingsStore.providerConfigs = {};
  // 项目 A：模板在这里创建，绑定素材 m1。
  store.project = {
    ...normalization.createProject(),
    id: 'project-a',
    name: '项目 A',
    materials: [{ id: 'm1', name: '参考图', path: '/a/m1.png', resourceType: 'image' }],
    nodes: [
      { id: 'ref', type: 'resource', title: '参考', materialId: 'm1', resourceType: 'image' },
      { id: 'shot', type: 'imageGeneration', title: '首帧', status: 'completed', prompt: '雨夜', model: 'gpt-image-2.6-sunburst' },
    ],
    edges: [{ source: 'ref', target: 'shot' }],
    tasks: [{ id: 't1', nodeId: 'shot', status: 'completed', completedAt: '2026-11-06T10:00:00Z' }],
  };
});

after(async () => {
  await env?.dispose();
});

function buildTemplate() {
  return templateService.buildWorkflowTemplate({
    name: '跨项目模板',
    nodes: store.project.nodes,
    edges: store.project.edges,
    selection: ['ref', 'shot'],
    tasks: store.project.tasks,
  });
}

test('跨项目应用：旧项目素材 id 视为未绑定，写画布前拒绝', () => {
  const template = buildTemplate();

  // 项目 B：只有 m2，没有 m1。
  store.project = {
    ...normalization.createProject(),
    id: 'project-b',
    name: '项目 B',
    materials: [{ id: 'm2', name: '新参考图', path: '/b/m2.png', resourceType: 'image' }],
    nodes: [],
    edges: [],
    tasks: [],
  };

  const before = store.project.nodes.length;
  assert.throws(
    () => instanceService.instantiateWorkflowTemplate(template),
    (error) => String(error.message).includes('missing-input'),
  );
  assert.equal(store.project.nodes.length, before, '失败时不应留下半成品');
  assert.equal((store.project.workflowInstances || []).length, 0);
});

test('跨项目应用：显式绑定本项目素材后成功，且节点引用的是新素材', () => {
  const template = buildTemplate();
  store.project = {
    ...normalization.createProject(),
    id: 'project-b',
    name: '项目 B',
    materials: [{ id: 'm2', name: '新参考图', path: '/b/m2.png', resourceType: 'image' }],
    nodes: [],
    edges: [],
    tasks: [],
  };

  const { instance } = instanceService.instantiateWorkflowTemplate(template, { bindings: { ref: 'm2' } });
  const resource = store.project.nodes.find((node) => node.id === instance.nodeIds.ref);
  assert.equal(resource.materialId, 'm2');
  assert.equal(resource.filePath, '/b/m2.png');
});

test('显式空绑定覆盖模板里保存的旧素材 id', () => {
  const template = buildTemplate();
  const plan = instancePlanner.planWorkflowInstance({
    definition: template.definition,
    recipe: template.recipe,
    bindings: { ref: '' },
  });
  assert.ok(plan.issues.includes('missing-input:ref'));
});

test('跨项目应用：配方模型没有凭据时换成本项目可用模型', () => {
  const template = buildTemplate();
  // 模板里的模型是 gpt-image（OpenAI）；项目 B 只配置了 StarRouter。
  settingsStore.providerConfigs = {
    starrouter: { apiKey: 'k', baseUrl: 'https://api.starrouter.ai' },
  };
  store.project = {
    ...normalization.createProject(),
    id: 'project-b',
    name: '项目 B',
    materials: [{ id: 'm2', name: '新参考图', path: '/b/m2.png', resourceType: 'image' }],
    nodes: [],
    edges: [],
    tasks: [],
  };

  const { instance } = instanceService.instantiateWorkflowTemplate(template, { bindings: { ref: 'm2' } });
  const node = store.project.nodes.find((item) => item.id === instance.nodeIds.shot);
  assert.ok(String(node.model).startsWith('starrouter-'), `实际：${node.model}`);
});
