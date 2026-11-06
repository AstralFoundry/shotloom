/**
 * 工作流实例规划：节点映射、槽位绑定、拓扑顺序与问题清单。
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env;
let instance;
let compile;

before(async () => {
  env = await createRendererEnv({ storage: new Map(), withWindow: true });
  instance = await env.load('domain/workflow/instance');
  compile = await env.load('domain/workflow/compile');
});

after(async () => {
  await env?.dispose();
});

function definition() {
  return {
    version: 1,
    nodes: [
      { id: 'ref', title: '图片输入', role: 'input', mediaType: 'image' },
      { id: 'text', title: '固定文本', role: 'constant', mediaType: 'text', text: '雨夜' },
      { id: 'shot', title: '生成图片', role: 'generation', mediaType: 'image' },
      { id: 'clip', title: '生成视频', role: 'generation', mediaType: 'video' },
    ],
    edges: [
      { fromNodeId: 'ref', toNodeId: 'shot', toPort: 'referenceImage' },
      { fromNodeId: 'text', toNodeId: 'shot' },
      { fromNodeId: 'shot', toNodeId: 'clip' },
    ],
    outputNodeIds: ['clip'],
  };
}

test('规划：节点类型映射、绑定生效、生成步骤按拓扑排序', () => {
  const plan = instance.planWorkflowInstance({
    definition: definition(),
    recipe: { shot: { prompt: '雨夜街道', model: 'img-1' }, clip: { prompt: '推镜', model: 'vid-1' } },
    bindings: { ref: 'm1' },
  });

  assert.deepEqual(plan.issues, []);
  assert.deepEqual(plan.executionOrder, ['shot', 'clip']);
  const byId = Object.fromEntries(plan.nodes.map((node) => [node.sourceId, node]));
  assert.equal(byId.ref.type, 'resource');
  assert.equal(byId.ref.resourceId, 'm1');
  assert.equal(byId.text.type, 'textGeneration');
  assert.equal(byId.text.content, '雨夜');
  assert.equal(byId.shot.type, 'imageGeneration');
  assert.equal(byId.shot.prompt, '雨夜街道');
  assert.equal(byId.clip.type, 'videoGeneration');
  assert.equal(byId.clip.model, 'vid-1');

  assert.deepEqual(plan.edges.find((edge) => edge.to === 'shot' && edge.from === 'ref'), {
    from: 'ref', to: 'shot', toPort: 'referenceImage',
  });
});

test('规划：缺绑定与缺配方进入问题清单，模板绑定可回落', () => {
  const missing = instance.planWorkflowInstance({
    definition: definition(),
    recipe: { shot: { prompt: 'x' } },
  });
  assert.ok(missing.issues.includes('missing-input:ref'));
  assert.ok(missing.issues.includes('missing-recipe:clip'));

  const fallback = instance.planWorkflowInstance({
    definition: { ...definition(), nodes: definition().nodes.map((node) => node.id === 'ref' ? { ...node, resourceId: 'm-saved' } : node) },
    recipe: { shot: {}, clip: {} },
  });
  assert.equal(fallback.issues.includes('missing-input:ref'), false);
  assert.equal(fallback.nodes.find((node) => node.sourceId === 'ref').resourceId, 'm-saved');
});

test('规划：有环时报告 cycle 而不是静默给出错误顺序', () => {
  const cyclic = definition();
  cyclic.edges.push({ fromNodeId: 'clip', toNodeId: 'shot' });
  const plan = instance.planWorkflowInstance({ definition: cyclic, recipe: { shot: {}, clip: {} }, bindings: { ref: 'm1' } });
  assert.ok(plan.issues.some((issue) => issue.startsWith('cycle:')));
  assert.deepEqual(plan.executionOrder, []);
});

test('规划：与编译器串起来，选区封装后可规划', () => {
  const compiled = compile.compileWorkflowTemplate({
    nodes: [
      { id: 'ref', type: 'resource', title: '参考', materialId: 'm1', resourceType: 'image' },
      { id: 'shot', type: 'imageGeneration', title: '首帧', status: 'completed', prompt: '雨夜街道', model: 'gpt-image-2.6-sunburst' },
    ],
    edges: [{ source: 'ref', target: 'shot', targetHandle: 'referenceImage' }],
    selection: ['ref', 'shot'],
    tasks: [{ id: 't1', nodeId: 'shot', status: 'completed', completedAt: '2026-11-06T10:00:00Z' }],
    genericTitle: ({ role }) => role,
  });
  const plan = instance.planWorkflowInstance({
    definition: compiled.definition,
    recipe: compiled.recipe,
    bindings: {},
  });
  assert.deepEqual(plan.issues, []);
  assert.deepEqual(plan.executionOrder, ['shot']);
  assert.equal(plan.nodes.find((node) => node.sourceId === 'shot').title, 'generation');
});
