import assert from 'node:assert/strict';
import test from 'node:test';
import { canvasMutationFingerprint } from '../renderer/src/utils/canvasMutationFingerprint.mjs';

test('画布内容变化会改变待确认写入使用的指纹', () => {
  const project = { nodes: [{ id: 'node-1', title: '初稿' }], edges: [], agentSteps: [] };
  const fingerprint = canvasMutationFingerprint(project);

  project.nodes[0].title = '用户已修改';
  assert.notEqual(fingerprint, canvasMutationFingerprint(project));
});

test('会话和步骤记录变化不改变画布指纹', () => {
  const project = { nodes: [{ id: 'node-1' }], edges: [], agentSteps: [], updatedAt: 'before' };
  const before = canvasMutationFingerprint(project);

  project.agentSteps.push({ id: 'step-1' });
  project.updatedAt = 'after';
  assert.equal(canvasMutationFingerprint(project), before);
});
