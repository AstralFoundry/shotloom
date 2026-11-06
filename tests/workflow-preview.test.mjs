/**
 * 工作流预览：流程顺序与缩略图预算；保存与展示都必须走这些规则。
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from './helpers/sourceContract.mjs';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env;
let flow;

before(async () => {
  env = await createRendererEnv({ storage: new Map(), withWindow: true });
  flow = await env.load('domain/workflow/flow');
});

after(async () => {
  await env?.dispose();
});

function definition() {
  return {
    version: 1,
    nodes: [
      { id: 'ref', title: '图片输入', role: 'input', mediaType: 'image', preview: { kind: 'image', dataUrl: 'data:image/jpeg;base64,AAA' } },
      { id: 'notes', title: '固定文本', role: 'constant', mediaType: 'text' },
      { id: 'shot', title: '生成图片', role: 'generation', mediaType: 'image' },
      { id: 'clip', title: '生成视频', role: 'generation', mediaType: 'video', preview: { kind: 'video', dataUrl: 'data:image/jpeg;base64,BBB' } },
    ],
    edges: [
      { fromNodeId: 'ref', toNodeId: 'shot' },
      { fromNodeId: 'notes', toNodeId: 'shot' },
      { fromNodeId: 'shot', toNodeId: 'clip' },
    ],
    outputNodeIds: ['clip'],
  };
}

test('流程顺序：输入在前，生成按拓扑序，输出不重复成卡', () => {
  const stages = flow.workflowFlowStages(definition());
  assert.deepEqual(stages.map((stage) => stage.node.id), ['ref', 'notes', 'shot', 'clip']);
  assert.deepEqual(stages.map((stage) => stage.role), ['input', 'constant', 'generation', 'generation']);

  // 输出不重复成卡：它是生成步骤之一，由界面打「输出」标签。
  assert.equal(stages.filter((stage) => stage.role === 'output').length, 0);
});

test('缩略图预算：单张超限丢弃，总量超限后不再保留', () => {
  const big = `data:image/jpeg;base64,${'A'.repeat(200)}`;
  const small = 'data:image/jpeg;base64,BBBB';
  const trimmed = flow.trimNodePreviews({
    version: 1,
    nodes: [
      { id: 'a', title: 'A', role: 'generation', mediaType: 'image', preview: { kind: 'image', dataUrl: big } },
      { id: 'b', title: 'B', role: 'generation', mediaType: 'image', preview: { kind: 'image', dataUrl: small } },
      { id: 'c', title: 'C', role: 'generation', mediaType: 'image', preview: { kind: 'image', dataUrl: small } },
    ],
    edges: [],
    outputNodeIds: ['a'],
  }, { maxPerNode: 100, maxTotal: 30 });

  const byId = Object.fromEntries(trimmed.nodes.map((node) => [node.id, node]));
  assert.equal(byId.a.preview, undefined, '单张超限应丢弃');
  assert.ok(byId.b.preview, '预算内保留');
  assert.equal(byId.c.preview, undefined, '总量超限后丢弃');
});

test('保存与展示接线：保存时抓缩略图，管理页渲染流程条', () => {
  const library = readSource('renderer/src/app/components/WorkflowLibrary.tsx');
  const view = readSource('renderer/src/app/views/WorkflowsView.tsx');
  assert.match(library, /captureNodePreview\(/);
  assert.match(library, /previewSourceForNode\(/);
  assert.match(library, /trimNodePreviews\(/);
  assert.match(view, /workflowFlowStages\(template\.definition\)/);
  assert.match(view, /preview\?\.dataUrl/);
  assert.match(view, /workflows\.role\.output/);
});
