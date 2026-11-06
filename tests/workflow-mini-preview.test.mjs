/**
 * 管理页的微型画布：节点按真实位置等比缩放进盒子，连线端点对齐节点边缘。
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from './helpers/sourceContract.mjs';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env;
let preview;

before(async () => {
  env = await createRendererEnv({ storage: new Map(), withWindow: true });
  preview = await env.load('domain/workflow/miniPreview');
});

after(async () => {
  await env?.dispose();
});

function nodes() {
  return [
    { id: 'ref', title: '参考图', type: 'resource', x: 0, y: 0, canvasWidth: 320, canvasHeight: 180 },
    { id: 'shot', title: '首帧', type: 'imageGeneration', x: 520, y: 100, canvasWidth: 320, canvasHeight: 180 },
  ];
}

test('布局：等比缩放并留边距，所有节点落在盒子内', () => {
  const layout = preview.layoutWorkflowPreview(nodes(), [{ source: 'ref', target: 'shot' }], { width: 320, height: 170 });
  assert.equal(layout.nodes.length, 2);
  assert.ok(layout.scale > 0 && layout.scale <= 1);
  for (const node of layout.nodes) {
    assert.ok(node.x >= 0 && node.y >= 0);
    assert.ok(node.x + node.width <= 320);
    assert.ok(node.y + node.height <= 170);
    assert.ok(node.width >= 8 && node.height >= 8);
  }
});

test('连线端点：从源节点右缘中点到目标节点左缘中点', () => {
  const layout = preview.layoutWorkflowPreview(nodes(), [{ source: 'ref', target: 'shot' }], { width: 320, height: 170 });
  const ref = layout.nodes.find((node) => node.id === 'ref');
  const shot = layout.nodes.find((node) => node.id === 'shot');
  const edge = layout.edges[0];
  assert.equal(edge.x1, ref.x + ref.width);
  assert.equal(edge.y1, ref.y + Math.round(ref.height / 2));
  assert.equal(edge.x2, shot.x);
  assert.equal(edge.y2, shot.y + Math.round(shot.height / 2));
});

test('空模板与缺失端点连线都不产生错误布局', () => {
  assert.deepEqual(preview.layoutWorkflowPreview([], [], { width: 200, height: 100 }), { nodes: [], edges: [], scale: 1 });
  const layout = preview.layoutWorkflowPreview(nodes(), [{ source: 'ref', target: 'missing' }], { width: 200, height: 100 });
  assert.equal(layout.edges.length, 0);
});

test('管理页使用微型画布并可点击放大', () => {
  const view = readSource('renderer/src/app/views/WorkflowsView.tsx');
  const component = readSource('renderer/src/app/components/WorkflowMiniPreview.tsx');
  assert.match(view, /<WorkflowMiniPreview/);
  assert.match(view, /onExpand=\{\(\) => setPreviewing\(template\)\}/);
  assert.match(view, /width=\{760\}/);
  assert.match(component, /layoutWorkflowPreview\(nodes, edges/);
  assert.match(component, /workflow-mini-edges/);
});
