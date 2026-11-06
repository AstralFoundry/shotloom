/**
 * 流程快照：不要求节点运行过，节点/连线/素材引用一起保存。
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env;
let snapshot;

before(async () => {
  env = await createRendererEnv({ storage: new Map(), withWindow: true });
  snapshot = await env.load('domain/workflow/snapshot');
});

after(async () => {
  await env?.dispose();
});

function fixture() {
  return {
    nodes: [
      { id: 'ref', type: 'resource', title: '参考图', x: 100, y: 100, materialId: 'm1', resourceType: 'image', status: 'idle', previewUrl: 'blob:x', createdAt: 'old' },
      { id: 'shot', type: 'imageGeneration', title: '首帧', x: 500, y: 100, prompt: '雨夜', model: 'gpt-image-2.6-sunburst', status: 'running', taskId: 't1', error: 'boom' },
      { id: 'unused', type: 'imageGeneration', title: '未选中', x: 900, y: 100 },
    ],
    edges: [
      { id: 'e1', source: 'ref', target: 'shot', data: { inputSlot: 'reference', inputRole: 'referenceImage' } },
      { id: 'e2', source: 'shot', target: 'unused' },
    ],
    materials: [
      { id: 'm1', name: '参考图', path: 'browser/a.png', resourceType: 'image', mimeType: 'image/png' },
      { id: 'm2', name: '未引用', path: 'browser/b.png', resourceType: 'image' },
    ],
  };
}

test('未运行过的节点也能保存；只保留选区内部连线与引用到的素材', () => {
  const result = snapshot.snapshotWorkflowSelection({
    ...fixture(),
    selection: ['ref', 'shot'],
    previews: { ref: { kind: 'image', dataUrl: 'data:image/jpeg;base64,AAA', label: '参考图' } },
  });

  assert.equal(result.nodes.length, 2);
  assert.equal(result.edges.length, 1);
  assert.equal(result.edges[0].data.inputSlot, 'reference');
  assert.equal(result.materials.length, 1);
  assert.equal(result.materials[0].id, 'm1');
  assert.equal(result.nodes[0].preview.dataUrl, 'data:image/jpeg;base64,AAA');

  // 运行时字段不进入快照。
  const shot = result.nodes.find((node) => node.id === 'shot');
  assert.equal(shot.taskId, undefined);
  assert.equal(shot.error, undefined);
  assert.equal(shot.status, 'idle');
  assert.equal(result.nodes.find((node) => node.id === 'ref').previewUrl, undefined);
});

test('空选区直接拒绝', () => {
  assert.throws(
    () => snapshot.snapshotWorkflowSelection({ ...fixture(), selection: [] }),
    (error) => String(error.message).includes('workflow.emptySelection'),
  );
});

test('展示顺序按位置（先上后下、先左后右），节点类型映射缩略图种类', () => {
  const result = snapshot.snapshotWorkflowSelection({ ...fixture(), selection: ['ref', 'shot'] });
  const ordered = snapshot.workflowDisplayOrder(result.nodes).map((node) => node.id);
  assert.deepEqual(ordered, ['ref', 'shot']);
  assert.equal(snapshot.snapshotNodeKind(result.nodes[0]), 'image');
});
