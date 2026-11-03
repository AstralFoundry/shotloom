import assert from 'node:assert/strict';
import test from 'node:test';
import { canvasMutationFingerprint } from '../renderer/src/utils/canvasMutationFingerprint.ts';

test('画布内容变化会改变写入围栏使用的指纹', () => {
  const project = { nodes: [{ id: 'node-1', title: '初稿' }], edges: [] };
  const fingerprint = canvasMutationFingerprint(project);

  project.nodes[0].title = '用户已修改';
  assert.notEqual(fingerprint, canvasMutationFingerprint(project));
});

test('会话记录变化不改变画布指纹', () => {
  const project = { nodes: [{ id: 'node-1' }], edges: [], updatedAt: 'before' };
  const before = canvasMutationFingerprint(project);

  project.harnessSessions = [{ id: 'chat-1' }];
  project.updatedAt = 'after';
  assert.equal(canvasMutationFingerprint(project), before);
});

test('拖动、缩放与选中节点不改变画布指纹', () => {
  const project = {
    nodes: [{
      id: 'node-1',
      title: '角色参考',
      x: 0,
      y: 0,
      canvasWidth: 300,
      canvasHeight: 200,
      selected: false,
      updatedAt: 'before',
    }],
    edges: [{ id: 'edge-1', source: 'node-1', target: 'node-2', selected: false, animated: false }],
  };
  const before = canvasMutationFingerprint(project);

  Object.assign(project.nodes[0], {
    x: 420,
    y: 90,
    canvasWidth: 360,
    canvasHeight: 240,
    selected: true,
    updatedAt: 'after',
  });
  Object.assign(project.edges[0], { selected: true, animated: true });

  assert.equal(canvasMutationFingerprint(project), before);
});

test('节点内容、连接与增删仍然改变画布指纹', () => {
  const project = {
    nodes: [
      { id: 'node-1', title: '角色参考', config: { ratio: '1:1' } },
      { id: 'node-2', title: '视频生成' },
    ],
    edges: [{ id: 'edge-1', source: 'node-1', target: 'node-2', data: { inputSlot: 'reference' } }],
  };
  const before = canvasMutationFingerprint(project);

  project.nodes[0].config.ratio = '16:9';
  assert.notEqual(canvasMutationFingerprint(project), before);

  project.nodes[0].config.ratio = '1:1';
  project.edges[0].data.inputSlot = 'firstFrame';
  assert.notEqual(canvasMutationFingerprint(project), before);

  project.edges[0].data.inputSlot = 'reference';
  project.nodes.push({ id: 'node-3', title: '图片生成' });
  assert.notEqual(canvasMutationFingerprint(project), before);

  const withThird = canvasMutationFingerprint(project);
  project.nodes.pop();
  assert.notEqual(canvasMutationFingerprint(project), withThird);
});

