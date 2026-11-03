import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCanvasContext,
  omitModelBinaryPayloads,
} from '../renderer/src/services/agentCanvasContext.ts';

function snapshot() {
  const selected = {
    id: 'selected',
    alias: 'N-SELECTED',
    type: 'imageGeneration',
    title: '选中节点',
    prompt: '需要完整保留的生成提示词',
    preview: `data:image/png;base64,${'a'.repeat(20_000)}`,
  };
  const neighbor = {
    id: 'neighbor', alias: 'N-NEIGHBOR', type: 'videoGeneration', title: '下游节点', prompt: '下游提示词',
  };
  const unrelated = {
    id: 'unrelated', alias: 'N-UNRELATED', type: 'textGeneration', title: '无关节点', prompt: '无关提示词',
  };
  return {
    project: { updatedAt: '2026-07-23T00:00:00.000Z' },
    nodes: [selected, neighbor, unrelated],
    edges: [{ id: 'edge-1', source: 'selected', target: 'neighbor' }],
    tasks: [],
    assets: [],
    materials: [],
    selectedNodeIds: ['selected'],
    aliasMap: { 'N-SELECTED': 'selected', 'N-NEIGHBOR': 'neighbor', 'N-UNRELATED': 'unrelated' },
    agentSettings: {},
  };
}

test('selection 画布视图只返回选中节点及一跳邻居，不回退为 full', () => {
  const project = {};
  const result = buildCanvasContext(project, snapshot(), { view: 'selection' });
  assert.equal(result.contextMode, 'selection');
  assert.deepEqual(result.nodes.map((node) => node.id), ['selected', 'neighbor']);
  assert.equal(result.nodes.some((node) => node.id === 'unrelated'), false);
  assert.equal(result.nodes[0].prompt, '需要完整保留的生成提示词');
  assert.match(result.nodes[0].preview, /媒体正文已省略/);
});

test('模型画布视图只省略二进制正文，不截断普通长文本', () => {
  const longPrompt = '镜头语言与角色连续性。'.repeat(2_000);
  const result = omitModelBinaryPayloads({
    prompt: longPrompt,
    image: `data:image/jpeg;base64,${'b'.repeat(30_000)}`,
    b64_json: 'c'.repeat(30_000),
  });
  assert.equal(result.prompt, longPrompt);
  assert.match(result.image, /媒体正文已省略/);
  assert.match(result.b64_json, /媒体正文已省略/);
});

