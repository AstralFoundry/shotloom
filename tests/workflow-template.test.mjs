/**
 * 工作流模板编译：只封装跑通的步骤，产出可分享结构与私有配方。
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env;
let compile;

before(async () => {
  env = await createRendererEnv({ storage: new Map(), withWindow: true });
  compile = await env.load('domain/workflow/compile');
});

after(async () => {
  await env?.dispose();
});

const genericTitle = ({ role, mediaType, index }) => `${role}:${mediaType}:${index}`;

function baseNodes() {
  return [
    { id: 'script', type: 'textGeneration', title: '脚本', status: 'completed', content: '一个雨夜', prompt: '' },
    { id: 'shot', type: 'imageGeneration', title: '首帧', status: 'completed', prompt: '雨夜街道，霓虹', model: 'gpt-image-2.6-sunburst', config: { ratio: '16:9' } },
    { id: 'clip', type: 'videoGeneration', title: '镜头', status: 'completed', prompt: '雨夜街道推镜', model: 'kling-3.0' },
    { id: 'ref', type: 'resource', title: '参考图', status: 'idle', materialId: 'm1', resourceType: 'image' },
  ];
}

function baseEdges() {
  return [
    { source: 'script', target: 'shot' },
    { source: 'ref', target: 'shot' },
    { source: 'shot', target: 'clip' },
  ];
}

function baseTasks() {
  return [
    { id: 't1', nodeId: 'shot', status: 'completed', completedAt: '2026-11-06T10:00:00Z' },
    { id: 't2', nodeId: 'clip', status: 'completed', completedAt: '2026-11-06T10:05:00Z' },
  ];
}

test('编译：三个角色、输出推断、配方只保留生成步骤', () => {
  const compiled = compile.compileWorkflowTemplate({
    nodes: baseNodes(),
    edges: baseEdges(),
    selection: ['script', 'shot', 'clip', 'ref'],
    tasks: baseTasks(),
    genericTitle,
  });

  assert.deepEqual(compiled.definition.outputNodeIds, ['clip']);
  const roles = Object.fromEntries(compiled.definition.nodes.map((node) => [node.id, node.role]));
  // 已完成的文本生成保留为「重新执行的步骤」；未运行的文本节点才是固定文本。
  assert.deepEqual(roles, { script: 'generation', shot: 'generation', clip: 'generation', ref: 'input' });

  assert.deepEqual(Object.keys(compiled.recipe).sort(), ['clip', 'script', 'shot']);
  assert.equal(compiled.recipe.shot.prompt, '雨夜街道，霓虹');
  assert.equal(compiled.recipe.shot.model, 'gpt-image-2.6-sunburst');
  assert.equal(compiled.recipe.shot.sourceTaskId, 't1');
  assert.equal(compiled.recipe.clip.sourceTaskId, 't2');
  assert.equal('prompt' in compiled.definition.nodes.find((node) => node.id === 'shot'), false);

  const refNode = compiled.definition.nodes.find((node) => node.id === 'ref');
  assert.equal(refNode.resourceId, 'm1');
  assert.equal(refNode.mediaType, 'image');
});

test('编译：未成功运行的生成节点不能封装', () => {
  const nodes = baseNodes();
  nodes[1].status = 'running';
  assert.throws(
    () => compile.compileWorkflowTemplate({ nodes, edges: baseEdges(), selection: ['shot', 'clip'], tasks: baseTasks(), genericTitle }),
    (error) => error.code === 'not-run',
  );
});

test('编译：不支持的节点类型与空选区被拒绝', () => {
  assert.throws(
    () => compile.compileWorkflowTemplate({ nodes: baseNodes(), edges: [], selection: [], genericTitle }),
    (error) => error.code === 'empty-selection',
  );
  assert.throws(
    () => compile.compileWorkflowTemplate({
      nodes: [...baseNodes(), { id: 'studio', type: 'clipStudio' }],
      edges: [],
      selection: ['studio'],
      genericTitle,
    }),
    (error) => error.code === 'unsupported-node',
  );
});

test('编译：有环的选区被拒绝', () => {
  const nodes = baseNodes();
  const edges = [...baseEdges(), { source: 'clip', target: 'shot' }];
  assert.throws(
    () => compile.compileWorkflowTemplate({ nodes, edges, selection: ['script', 'shot', 'clip', 'ref'], tasks: baseTasks(), genericTitle }),
    (error) => error.code === 'cycle',
  );
});

test('编译：不在输出祖先链上的节点被丢弃并列出', () => {
  const nodes = [...baseNodes(), { id: 'orphan', type: 'resource', title: '无关参考', materialId: 'm2', resourceType: 'image' }];
  const compiled = compile.compileWorkflowTemplate({
    nodes,
    edges: baseEdges(),
    selection: ['script', 'shot', 'clip', 'ref', 'orphan'],
    tasks: baseTasks(),
    genericTitle,
  });
  assert.deepEqual(compiled.droppedNodeIds, ['orphan']);
  assert.equal(compiled.definition.nodes.some((node) => node.id === 'orphan'), false);
});

test('编译：未运行的文本节点作为固定文本输入', () => {
  const nodes = baseNodes();
  nodes[0] = { id: 'script', type: 'textGeneration', title: '脚本', status: 'idle', content: '一个雨夜' };
  const compiled = compile.compileWorkflowTemplate({
    nodes, edges: baseEdges(), selection: ['script', 'shot', 'clip'], tasks: baseTasks(), genericTitle,
  });
  const script = compiled.definition.nodes.find((node) => node.id === 'script');
  assert.equal(script.role, 'constant');
  assert.equal(script.text, '一个雨夜');
  assert.equal('script' in compiled.recipe, false);
});

test('编译：输出必须是生成步骤', () => {
  assert.throws(
    () => compile.compileWorkflowTemplate({
      nodes: baseNodes(), edges: baseEdges(), selection: ['script', 'shot', 'clip'], tasks: baseTasks(), genericTitle,
      outputNodeIds: ['ref'],
    }),
    (error) => error.code === 'unknown-output',
  );
});

test('可分享副本：去掉配方与素材绑定，结构保持不变', () => {
  const compiled = compile.compileWorkflowTemplate({
    nodes: baseNodes(), edges: baseEdges(), selection: ['script', 'shot', 'clip', 'ref'], tasks: baseTasks(), genericTitle,
  });
  const shareable = compile.shareableWorkflowTemplate({
    id: 'tpl-1', name: '雨夜镜头', description: '', revision: 3, definition: compiled.definition,
  }, '2026-11-06T12:00:00.000Z');

  assert.equal(shareable.format, 'shotloom.workflow-template');
  assert.equal(shareable.revision, 3);
  assert.equal('recipe' in shareable, false);
  assert.equal(JSON.stringify(shareable).includes('雨夜街道'), false, '导出不得带出提示词');
  assert.equal(JSON.stringify(shareable).includes('m1'), false, '导出不得带出素材 id');
  assert.deepEqual(shareable.definition.outputNodeIds, ['clip']);
});

test('模板校验：损坏的模板在运行前被拦下', () => {
  const valid = {
    version: 1,
    nodes: [
      { id: 'a', title: '输入', role: 'input', mediaType: 'image' },
      { id: 'b', title: '生成', role: 'generation', mediaType: 'image' },
    ],
    edges: [{ fromNodeId: 'a', toNodeId: 'b' }],
    outputNodeIds: ['b'],
  };
  assert.equal(compile.validateWorkflowDefinition(valid).nodes.length, 2);
  assert.throws(
    () => compile.validateWorkflowDefinition({ ...valid, outputNodeIds: ['missing'] }),
    (error) => error.code === 'unknown-output',
  );
  assert.throws(
    () => compile.validateWorkflowDefinition({ ...valid, nodes: [{ ...valid.nodes[0], role: 'magic' }, valid.nodes[1]] }),
    (error) => error.code === 'unsupported-node',
  );
  assert.throws(
    () => compile.validateWorkflowDefinition({ ...valid, edges: [...valid.edges, { fromNodeId: 'b', toNodeId: 'a' }] }),
    (error) => error.code === 'cycle',
  );
});

test('运行就绪检查：缺输入绑定或缺配方都要报出来', () => {
  const definition = {
    version: 1,
    nodes: [
      { id: 'a', title: '输入', role: 'input', mediaType: 'image' },
      { id: 'b', title: '生成', role: 'generation', mediaType: 'image' },
    ],
    edges: [{ fromNodeId: 'a', toNodeId: 'b' }],
    outputNodeIds: ['b'],
  };
  assert.deepEqual(compile.workflowReadiness(definition, { b: { prompt: 'x' } }, {}).issues, ['missing-input:a']);
  assert.deepEqual(compile.workflowReadiness(definition, {}, { a: 'm1' }).issues, ['missing-recipe:b']);
  assert.equal(compile.workflowReadiness(definition, { b: {} }, { a: 'm1' }).ready, true);
});
