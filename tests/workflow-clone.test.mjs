/**
 * 导入工作流：整段复制节点与连线，素材文件复制并重建素材记录，不触发运行。
 */
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env;
let clone;
let snapshot;
let service;
let store;
let normalization;

before(async () => {
  env = await createRendererEnv({ storage: new Map(), withWindow: true });
  clone = await env.load('services/workflowCloneService');
  snapshot = await env.load('domain/workflow/snapshot');
  service = await env.load('services/workflowTemplateService');
  ({ store } = await env.load('store/projectStore'));
  normalization = await env.load('store/projectNormalization');
});

beforeEach(() => {
  store.projectDir = 'browser/projects/clone-demo';
  store.project = {
    ...normalization.createProject(),
    id: 'project-clone',
    name: '导入测试',
    materials: [],
    nodes: [{ id: 'existing', type: 'imageGeneration', title: '已有节点', x: 0, y: 0, canvasWidth: 320 }],
    edges: [],
    tasks: [],
  };
});

after(async () => {
  await env?.dispose();
});

function makeTemplate() {
  const snap = snapshot.snapshotWorkflowSelection({
    nodes: [
      { id: 'ref', type: 'resource', title: '参考图', x: 100, y: 100, materialId: 'm1', resourceType: 'image', filePath: 'browser/a.png' },
      { id: 'shot', type: 'imageGeneration', title: '首帧', x: 500, y: 100, prompt: '雨夜', model: 'gpt-image-2.6-sunburst' },
    ],
    edges: [{ source: 'ref', target: 'shot', data: { inputSlot: 'reference', inputRole: 'referenceImage' } }],
    selection: ['ref', 'shot'],
    materials: [{ id: 'm1', name: '参考图', path: 'browser/a.png', resourceType: 'image', mimeType: 'image/png' }],
  });
  return {
    id: 'wf-1', name: '雨夜', description: '', revision: 2, formatVersion: 2,
    ...snap, createdAt: '2026-11-06T10:00:00Z', updatedAt: '2026-11-06T10:00:00Z',
  };
}

test('导入：节点/连线用新 id，素材复制并重映射，任务不被触发', async () => {
  const template = makeTemplate();
  const result = await clone.cloneWorkflowTemplate(template);

  assert.equal(result.nodeIds.length, 2);
  assert.equal(store.project.nodes.length, 3);
  assert.equal(store.project.tasks.length, 0, '导入不应触发任何生成任务');

  const imported = store.project.nodes.filter((node) => node.workflowTemplateId === 'wf-1');
  assert.equal(imported.length, 2);
  const newRef = imported.find((node) => node.type === 'resource');
  assert.notEqual(newRef.id, 'ref');
  assert.ok(store.project.materials.some((material) => material.id === newRef.materialId), '素材记录应复制进当前项目');
  assert.equal(newRef.workflowTemplateRevision, 2);

  assert.equal(store.project.edges.length, 1);
  assert.equal(store.project.edges[0].data.inputSlot, 'reference');
  assert.ok(result.materialCount >= 1);
});

test('导入：节点整体放在已有内容右侧，不与现有节点重叠', async () => {
  await clone.cloneWorkflowTemplate(makeTemplate());
  const imported = store.project.nodes.filter((node) => node.workflowTemplateId === 'wf-1');
  const minX = Math.min(...imported.map((node) => node.x));
  assert.ok(minX >= 320 + 120 - 1, `实际最左 x=${minX}`);
});

test('模板服务：保存/读入/版本递增', async () => {
  const built = service.buildWorkflowTemplate({
    name: '测试流程',
    nodes: [{ id: 'a', type: 'imageGeneration', title: 'A', x: 0, y: 0, status: 'idle' }],
    edges: [],
    selection: ['a'],
    materials: [],
  });
  assert.equal(built.formatVersion, 2);
  assert.equal(built.revision, 1);

  const normalized = service.normalizeStoredTemplate(JSON.parse(JSON.stringify(built)));
  assert.equal(normalized.name, '测试流程');

  const bumped = service.nextTemplateRevision(built, { name: '改名' });
  assert.equal(bumped.revision, 2);
  assert.equal(service.nextTemplateRevision(bumped, { name: '改名' }), bumped, '内容没变不递增');

  assert.equal(service.normalizeStoredTemplate({ formatVersion: 1, definition: {} }), null, '旧版槽位模板需重新保存');
});
