import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canvasNodeDimensions,
  layoutAgentNodes,
  placeAgentNodesIncrementally,
} from '../renderer/src/services/agentLayoutService.ts';
import {
  mediaCanvasNodeDimensions,
  reconcileMediaNodeDimensions,
} from '../renderer/src/domain/graph/CanvasNodeDimensions.ts';
import { readSource } from './helpers/sourceContract.mjs';

function node(id, type, extra = {}) {
  return { id, type, title: id, x: -999, y: -999, ...extra };
}

function project(nodes, edges = []) {
  return { nodes, edges, tasks: [] };
}

const layoutSource = readSource('renderer/src/services/agentLayoutService.ts');

test('工作流布局不从标题、角色关键词或节点类型猜测制作语义', () => {
  assert.doesNotMatch(layoutSource, /TERMINAL_ROLE_PATTERN|sequenceNumber|semanticBaseDepth|nodeRole/);
  const original = [
    node('first', 'videoGeneration', { title: '最终成片 99', artifactRole: 'final' }),
    node('second', 'textGeneration', { title: '草稿 01', artifactRole: 'draft' }),
  ];
  const renamed = [
    node('first', 'videoGeneration', { title: 'draft', artifactRole: 'draft' }),
    node('second', 'textGeneration', { title: '最终交付 100', artifactRole: 'final' }),
  ];
  layoutAgentNodes(project(original), original.map((item) => item.id), {
    scope: 'all', x: 0, y: 0,
  });
  layoutAgentNodes(project(renamed), renamed.map((item) => item.id), {
    scope: 'all', x: 0, y: 0,
  });
  assert.deepEqual(
    original.map(({ id, x, y }) => ({ id, x, y })),
    renamed.map(({ id, x, y }) => ({ id, x, y })),
  );
});

test('布局和画布渲染共用唯一的节点尺寸契约', () => {
  assert.deepEqual(canvasNodeDimensions(node('text', 'textGeneration')), {
    width: 350,
    height: 500,
  });
  assert.deepEqual(canvasNodeDimensions(node('image', 'imageGeneration')), { width: 350, height: 350 });
  assert.deepEqual(canvasNodeDimensions(node('video', 'videoGeneration')), { width: 350, height: 280 });
  assert.deepEqual(canvasNodeDimensions(node('audio', 'audioGeneration')), { width: 350, height: 125 });
  assert.deepEqual(canvasNodeDimensions(node('resource', 'resource')), { width: 350, height: 150 });
  assert.deepEqual(canvasNodeDimensions(node('director', 'threeDDirector')), {
    width: 540,
    height: 330,
  });
  assert.deepEqual(
    canvasNodeDimensions(
      node('text-custom', 'textGeneration', { canvasWidth: 520, canvasHeight: 410 }),
    ),
    { width: 520, height: 410 },
  );
});

test('图片节点按原图比例显示，并限制极端长宽比', () => {
  assert.deepEqual(mediaCanvasNodeDimensions(1080, 1920), { width: 248, height: 440 });
  assert.deepEqual(mediaCanvasNodeDimensions(1200, 1600), { width: 330, height: 440 });
  assert.deepEqual(mediaCanvasNodeDimensions(1920, 1080), { width: 350, height: 197 });
  assert.deepEqual(mediaCanvasNodeDimensions(4000, 500), { width: 350, height: 100 });
  assert.deepEqual(mediaCanvasNodeDimensions(0, 0), { width: 350, height: 350 });
});

test('媒体按真实比例自适应，但保留用户调整过的尺寸', () => {
  assert.deepEqual(
    reconcileMediaNodeDimensions(node('video', 'videoGeneration'), 1920, 1080),
    { width: 350, height: 197 },
  );
  assert.deepEqual(
    reconcileMediaNodeDimensions(
      node('video-default', 'videoGeneration', { canvasWidth: 351, canvasHeight: 281 }),
      1920,
      1080,
    ),
    { width: 350, height: 197 },
  );
  assert.equal(
    reconcileMediaNodeDimensions(
      node('video-custom', 'videoGeneration', { canvasWidth: 520, canvasHeight: 300 }),
      1920,
      1080,
    ),
    null,
  );
});

test('空媒体节点按模型配置比例自适应', () => {
  assert.deepEqual(
    canvasNodeDimensions(node('video-wide', 'videoGeneration', { config: { ratio: '16:9' } })),
    { width: 350, height: 197 },
  );
  assert.deepEqual(
    canvasNodeDimensions(node('image-portrait', 'imageGeneration', { config: { size: '1024x1536' } })),
    { width: 293, height: 440 },
  );
  assert.deepEqual(
    canvasNodeDimensions(node('video-adaptive', 'videoGeneration', { config: { ratio: 'adaptive' } })),
    { width: 350, height: 280 },
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

test('按连接排序默认收紧横向间距并明显增加纵向间距', () => {
  const imageA = node('image-a', 'imageGeneration');
  const imageB = node('image-b', 'imageGeneration');
  const videoA = node('video-a', 'videoGeneration');
  const videoB = node('video-b', 'videoGeneration');
  const graph = project(
    [imageA, imageB, videoA, videoB],
    [
      { source: imageA.id, target: videoA.id },
      { source: imageB.id, target: videoB.id },
    ],
  );

  layoutAgentNodes(
    graph,
    graph.nodes.map((item) => item.id),
    { scope: 'all', x: 0, y: 0 },
  );

  assert.equal(videoA.x - (imageA.x + canvasNodeDimensions(imageA).width), 160);
  assert.equal(imageB.y - (imageA.y + canvasNodeDimensions(imageA).height), 120);
});

test('整理选区保持原锚点并避开未选节点', () => {
  const source = node('source', 'textGeneration', { x: 600, y: 300 });
  const target = node('target', 'imageGeneration', { x: 650, y: 360 });
  const blocker = node('blocker', 'imageGeneration', { x: 970, y: 300 });
  const graph = project(
    [source, target, blocker],
    [{ source: source.id, target: target.id }],
  );
  const result = layoutAgentNodes(graph, [source.id, target.id], { scope: 'selection', gapX: 40 });

  assert.ok(result.movedCount > 0);
  assert.notEqual(source.x, 120, '选区整理不应跳回画布默认原点');
  const targetRight = target.x + canvasNodeDimensions(target).width;
  const blockerRight = blocker.x + canvasNodeDimensions(blocker).width;
  assert.ok(
    targetRight + 24 <= blocker.x || blockerRight + 24 <= source.x ||
      target.y + canvasNodeDimensions(target).height + 24 <= blocker.y ||
      blocker.y + canvasNodeDimensions(blocker).height + 24 <= target.y,
    '整理结果不能覆盖未选节点',
  );
});

test('选区可以沿连线纳入上下游但不移动不相连节点', () => {
  const source = node('source', 'textGeneration', { x: 100, y: 100 });
  const middle = node('middle', 'imageGeneration', { x: 500, y: 100 });
  const target = node('target', 'videoGeneration', { x: 900, y: 100 });
  const isolated = node('isolated', 'imageGeneration', { x: 1400, y: 100 });
  const graph = project([source, middle, target, isolated], [
    { source: source.id, target: middle.id },
    { source: middle.id, target: target.id },
  ]);
  const result = layoutAgentNodes(graph, [middle.id], {
    scope: 'selection',
    includeConnected: true,
  });

  assert.deepEqual(new Set(result.nodeIds), new Set(['source', 'middle', 'target']));
  assert.equal(isolated.x, 1400);
  assert.ok(source.x < middle.x && middle.x < target.x);
});

test('横向、纵向和网格整理使用真实节点尺寸', () => {
  const modes = ['horizontal', 'vertical', 'grid'];
  for (const mode of modes) {
    const nodes = [
      node(`${mode}-a`, 'textGeneration', { x: 400, y: 300 }),
      node(`${mode}-b`, 'imageGeneration', { x: 700, y: 500 }),
      node(`${mode}-c`, 'videoGeneration', { x: 900, y: 700 }),
      node(`${mode}-d`, 'audioGeneration', { x: 1100, y: 900 }),
    ];
    layoutAgentNodes(project(nodes), nodes.map((item) => item.id), {
      scope: 'selection',
      mode,
      avoidCollisions: false,
    });
    if (mode === 'horizontal') assert.equal(new Set(nodes.map((item) => item.y)).size, 1);
    if (mode === 'vertical') assert.equal(new Set(nodes.map((item) => item.x)).size, 1);
    if (mode === 'grid') {
      assert.equal(new Set(nodes.map((item) => item.x)).size, 2);
      assert.equal(new Set(nodes.map((item) => item.y)).size, 2);
    }
  }
});

test('单个 Agent 新节点增量放在父节点右侧并避开已有节点', () => {
  const parent = node('parent', 'imageGeneration', { x: 200, y: 180 });
  const blocker = node('blocker', 'videoGeneration', { x: 690, y: 180 });
  const created = node('created', 'videoGeneration', { x: 80, y: 80 });
  const graph = project(
    [parent, blocker, created],
    [{ source: parent.id, target: created.id }],
  );
  const result = placeAgentNodesIncrementally(graph, [created.id], { gapX: 120 });

  assert.equal(result.movedCount, 1);
  assert.ok(created.x > parent.x);
  assert.ok(
    created.x + canvasNodeDimensions(created).width + 24 <= blocker.x ||
      blocker.x + canvasNodeDimensions(blocker).width + 24 <= created.x ||
      created.y + canvasNodeDimensions(created).height + 24 <= blocker.y ||
      blocker.y + canvasNodeDimensions(blocker).height + 24 <= created.y,
  );
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
  const graph = project(
    [bible, board, shot1, shot2, unrelated],
    [
      { source: bible.id, target: board.id },
      { source: board.id, target: shot1.id },
      { source: board.id, target: shot2.id },
    ],
  );

  const result = layoutAgentNodes(graph, [shot1.id, shot2.id], { scope: 'workflow', x: 0, y: 0 });

  assert.deepEqual(new Set(result.nodeIds), new Set([bible.id, board.id, shot1.id, shot2.id]));
  assert.equal(unrelated.x, -999);
  assert.ok(board.x > bible.x);
  assert.equal(shot1.x, shot2.x, '同类产物应落在同一依赖列');
  assert.notEqual(shot1.y, shot2.y, '不同分段应使用独立纵向槽位');
  assert.ok(shot1.x > board.x, '共享资产应紧邻下游列并保持从左到右');
});

test('同列节点按父节点重心排序以减少交叉连线', () => {
  const sourceA = node('source-a', 'textGeneration', {
    title: 'A',
    segmentIds: ['seg-01', 'seg-02'],
  });
  const sourceB = node('source-b', 'textGeneration', {
    title: 'B',
    segmentIds: ['seg-01', 'seg-02'],
  });
  const targetA = node('target-a', 'imageGeneration', {
    title: 'A',
    segmentIds: ['seg-01', 'seg-02'],
  });
  const targetB = node('target-b', 'imageGeneration', {
    title: 'B',
    segmentIds: ['seg-01', 'seg-02'],
  });
  const graph = project(
    [sourceA, sourceB, targetA, targetB],
    [
      { source: sourceA.id, target: targetB.id },
      { source: sourceB.id, target: targetA.id },
      { source: sourceA.id, target: targetA.id },
    ],
  );

  layoutAgentNodes(
    graph,
    graph.nodes.map((item) => item.id),
    { scope: 'all', x: 0, y: 0 },
  );

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

  const result = layoutAgentNodes(
    graph,
    nodes.map((item) => item.id),
    { scope: 'all', x: 0, y: 0 },
  );

  assert.equal(new Set(nodes.map((item) => item.x)).size, 2, '关键帧和视频应分别共用一列');
  assert.ok(result.bounds.width > 0);
  for (let index = 0; index < nodes.length; index += 2) {
    assert.ok(nodes[index + 1].x > nodes[index].x);
    const frameCenter = nodes[index].y + canvasNodeDimensions(nodes[index]).height / 2;
    const videoCenter = nodes[index + 1].y + canvasNodeDimensions(nodes[index + 1]).height / 2;
    assert.equal(videoCenter, frameCenter, '不同高度的关键帧与视频应逐行居中对齐');
  }
});

test('互不相连的工作流各自成块，不挤进同一套依赖网格', () => {
  const long = [
    node('long-1', 'textGeneration'),
    node('long-2', 'imageGeneration'),
    node('long-3', 'videoGeneration'),
  ];
  const short = [node('short-1', 'textGeneration'), node('short-2', 'imageGeneration')];
  const graph = project([...long, ...short], [
    { source: long[0].id, target: long[1].id },
    { source: long[1].id, target: long[2].id },
    { source: short[0].id, target: short[1].id },
  ]);

  layoutAgentNodes(graph, graph.nodes.map((item) => item.id), { scope: 'all', x: 0, y: 0, gapX: 160, gapY: 120 });

  assert.equal(short[1].x, short[0].x + canvasNodeDimensions(short[0]).width + 160, '短链的层间距只由自身决定');
  assert.equal(long[2].x, long[1].x + canvasNodeDimensions(long[1]).width + 160);
  const longBottom = Math.max(...long.map((item) => item.y + canvasNodeDimensions(item).height));
  assert.ok(short[0].y >= longBottom, '深链先铺，短链整体落在下方');
});

test('扇出层超过每列上限时折成小网格并把下游右移避让', () => {
  const root = node('root', 'textGeneration');
  const frames = Array.from({ length: 8 }, (_value, index) => node(`frame-${index}`, 'imageGeneration'));
  const sink = node('sink', 'videoGeneration');
  const graph = project([root, ...frames, sink], [
    ...frames.map((frame) => ({ source: root.id, target: frame.id })),
    ...frames.map((frame) => ({ source: frame.id, target: sink.id })),
  ]);

  layoutAgentNodes(graph, graph.nodes.map((item) => item.id), { scope: 'all', x: 0, y: 0 });

  assert.equal(new Set(frames.map((frame) => frame.x)).size, 2, '八个扇出应折成两列');
  const frameRight = Math.max(...frames.map((frame) => frame.x + canvasNodeDimensions(frame).width));
  assert.ok(sink.x >= frameRight, '下游节点必须让开折叠出来的列');
  for (let left = 0; left < frames.length; left += 1) {
    for (let right = left + 1; right < frames.length; right += 1) {
      const a = frames[left];
      const b = frames[right];
      const overlap = a.x < b.x + canvasNodeDimensions(b).width &&
        b.x < a.x + canvasNodeDimensions(a).width &&
        a.y < b.y + canvasNodeDimensions(b).height &&
        b.y < a.y + canvasNodeDimensions(a).height;
      assert.ok(!overlap, '折叠后的扇出节点不得互相覆盖');
    }
  }
});

test('选区整理把结果放回原质心，不再以飘在角落的节点为起点', () => {
  const top = node('top', 'textGeneration', { x: 0, y: 0 });
  const bottom = node('bottom', 'imageGeneration', { x: 0, y: 4000 });
  const graph = project([top, bottom]);
  const oldCenterY = (0 + 4000 + canvasNodeDimensions(bottom).height) / 2;

  layoutAgentNodes(graph, [top.id, bottom.id], { scope: 'selection', gapX: 160, gapY: 120 });

  const newCenterY = (Math.min(top.y, bottom.y) + Math.max(top.y + canvasNodeDimensions(top).height, bottom.y + canvasNodeDimensions(bottom).height)) / 2;
  assert.ok(Math.abs(newCenterY - oldCenterY) <= 1, '整理结果应围绕原来的重心');
  assert.ok(top.y > 1000, '不应把整块结果钉回散点左上角');
});
