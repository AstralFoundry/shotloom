import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canvasNodeDimensions,
  layoutAgentNodes,
} from '../renderer/src/services/agentLayoutService.ts';

function node(id, type, extra = {}) {
  return { id, type, title: id, x: -999, y: -999, ...extra };
}

function project(nodes, edges = []) {
  return { nodes, edges, tasks: [] };
}

test('布局和画布渲染共用唯一的节点尺寸契约', () => {
  assert.deepEqual(canvasNodeDimensions(node('text', 'textGeneration')), { width: 370, height: 270 });
  assert.deepEqual(canvasNodeDimensions(node('resource', 'resource')), { width: 240, height: 150 });
  assert.deepEqual(canvasNodeDimensions(node('board', 'board')), { width: 340, height: 360 });
  assert.deepEqual(canvasNodeDimensions(node('director', 'threeDDirector')), { width: 540, height: 330 });
  assert.deepEqual(
    canvasNodeDimensions(node('text-custom', 'textGeneration', { canvasWidth: 520, canvasHeight: 410 })),
    { width: 520, height: 410 },
  );
});

test('依赖列按节点宽度和水平间距排布且不会重叠', () => {
  const source = node('source', 'textGeneration');
  const target = node('target', 'imageGeneration');
  const graph = project([source, target], [{ source: source.id, target: target.id }]);

  layoutAgentNodes(graph, [source.id, target.id], { scope: 'selection', x: 10, y: 20, gapX: 48 });

  assert.equal(source.x, 10);
  assert.equal(target.x, 10 + canvasNodeDimensions(source).width + 48);
  assert.ok(target.x >= source.x + canvasNodeDimensions(source).width);
});

test('工作流布局沿连线纳入缺少 runId 的旧共享资产但不移动无关节点', () => {
  const bible = node('bible', 'textGeneration', { agentPlan: { source: 'assistant' } });
  const board = node('board', 'imageGeneration', { agentPlan: { source: 'assistant' } });
  const shot1 = node('shot-1', 'imageGeneration', {
    segmentIds: ['seg-01'],
    agentPlan: { source: 'assistant', runId: 'run-current', segmentIds: ['seg-01'] },
  });
  const shot2 = node('shot-2', 'imageGeneration', {
    segmentIds: ['seg-02'],
    agentPlan: { source: 'assistant', runId: 'run-current', segmentIds: ['seg-02'] },
  });
  const unrelated = node('unrelated', 'imageGeneration', { agentPlan: { source: 'assistant' } });
  const graph = project([bible, board, shot1, shot2, unrelated], [
    { source: bible.id, target: board.id },
    { source: board.id, target: shot1.id },
    { source: board.id, target: shot2.id },
  ]);

  const result = layoutAgentNodes(graph, [shot1.id, shot2.id], { scope: 'workflow', x: 0, y: 0 });

  assert.deepEqual(new Set(result.nodeIds), new Set([bible.id, board.id, shot1.id, shot2.id]));
  assert.equal(unrelated.x, -999);
  assert.ok(board.x > bible.x);
  assert.equal(shot1.x, shot2.x, '同类产物应落在同一依赖列');
  assert.notEqual(shot1.y, shot2.y, '不同分段应使用独立纵向槽位');
  assert.ok(shot1.x > board.x, '共享资产应紧邻下游列并保持从左到右');
});

test('同列节点按父节点重心排序以减少交叉连线', () => {
  const sourceA = node('source-a', 'textGeneration', { title: 'A', segmentIds: ['seg-01', 'seg-02'] });
  const sourceB = node('source-b', 'textGeneration', { title: 'B', segmentIds: ['seg-01', 'seg-02'] });
  const targetA = node('target-a', 'imageGeneration', { title: 'A', segmentIds: ['seg-01', 'seg-02'] });
  const targetB = node('target-b', 'imageGeneration', { title: 'B', segmentIds: ['seg-01', 'seg-02'] });
  const graph = project([sourceA, sourceB, targetA, targetB], [
    { source: sourceA.id, target: targetB.id },
    { source: sourceB.id, target: targetA.id },
    { source: sourceA.id, target: targetA.id },
  ]);

  layoutAgentNodes(graph, graph.nodes.map((item) => item.id), { scope: 'all', x: 0, y: 0 });

  assert.ok(sourceA.y < sourceB.y);
  assert.ok(targetB.y < targetA.y, '目标顺序应跟随父节点，而不是标题排序');
});

test('大量分段统一形成全局横向依赖列且上下游逐行对齐', () => {
  const nodes = [];
  const edges = [];
  for (let index = 1; index <= 12; index += 1) {
    const segmentId = `seg-${String(index).padStart(2, '0')}`;
    const frame = node(`${segmentId}-frame`, 'imageGeneration', { segmentIds: [segmentId] });
    const video = node(`${segmentId}-video`, 'videoGeneration', { segmentIds: [segmentId] });
    nodes.push(frame, video);
    edges.push({ source: frame.id, target: video.id });
  }
  const graph = project(nodes, edges);

  const result = layoutAgentNodes(graph, nodes.map((item) => item.id), { scope: 'all', x: 0, y: 0 });

  assert.equal(new Set(nodes.map((item) => item.x)).size, 2, '关键帧和视频应分别共用一列');
  assert.ok(result.bounds.width > 0);
  for (let index = 0; index < nodes.length; index += 2) {
    assert.ok(nodes[index + 1].x > nodes[index].x);
    assert.equal(nodes[index + 1].y, nodes[index].y, '每个分段的关键帧与视频应逐行对齐');
  }
});
