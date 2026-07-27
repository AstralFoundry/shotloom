import assert from 'node:assert/strict';
import test from 'node:test';

import {
  captureCanvasDigest,
  evaluateCanvasMutation,
} from '../renderer/src/agent/runtime/runtimeVerification.ts';

function generationNode(patch = {}) {
  return {
    id: 'node-1',
    type: 'imageGeneration',
    title: '角色关键帧',
    prompt: '一名红衣剑客站在雨夜街道中央，正拔剑迎敌',
    model: 'image-model',
    recipeId: 'image-general',
    config: { ratio: '16:9' },
    x: 0,
    y: 0,
    ...patch,
  };
}

test('画布增量评估接受单一顶层生成契约', () => {
  const before = captureCanvasDigest({ nodes: [], edges: [] });
  const project = { nodes: [generationNode()], edges: [] };
  const result = evaluateCanvasMutation(before, project);
  assert.equal(result.success, true);
  assert.deepEqual(result.delta.addedNodeIds, ['node-1']);
  assert.equal(result.changed, true);
});

test('画布增量评估允许可选 recipeId 但拒绝 config 内重复真值', () => {
  const before = captureCanvasDigest({ nodes: [], edges: [] });
  const project = {
    nodes: [generationNode({ recipeId: '', config: { prompt: 'legacy prompt', model: 'legacy model' } })],
    edges: [],
  };
  const result = evaluateCanvasMutation(before, project);
  assert.equal(result.success, false);
  assert.equal(result.issues.some((issue) => issue.includes('缺少 recipeId')), false);
  assert.ok(result.issues.some((issue) => issue.includes('config 含重复 prompt/model')));
});

test('画布增量评估会识别仅 outputSpec 发生的更新', () => {
  const project = {
    nodes: [{
      id: 'image-1', type: 'imageGeneration', title: '图片', prompt: '夜景', model: 'gpt-image-2',
      outputSpec: { aspectRatio: '1:1' }, config: { size: '1024x1024' },
    }],
    edges: [],
  };
  const before = captureCanvasDigest(project);
  project.nodes[0].outputSpec = { aspectRatio: '16:9' };
  const result = evaluateCanvasMutation(before, project);
  assert.equal(result.changed, true);
  assert.deepEqual(result.delta.changedNodeIds, ['image-1']);
});
