import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { applyEntityRotation, retimeRotationAnimation, rotationDegreesAt } from '../vendor/shotloom-director-desk/src/core/animation/entity-rotation.ts';
import { demoProject, validateProject } from '../vendor/shotloom-director-desk/src/core/model.ts';

const require = createRequire(new URL('../vendor/shotloom-director-desk/package.json', import.meta.url));
const THREE = require('three');

test('任意物体绕局部轴心旋转时轴心留在原处，并可随机跳转时间', () => {
  const entity = { rotationAnimation: {
    pivot: [-0.5, 0, 0],
    keys: [{ time: 0, degrees: [0, 0, 0] }, { time: 2, degrees: [0, 90, 0] }],
  } };
  assert.deepEqual(rotationDegreesAt(entity.rotationAnimation, 1), [0, 45, 0]);

  for (const time of [2, 0, 1]) {
    const root = new THREE.Object3D();
    root.position.set(5, 0, 0);
    root.scale.set(2, 1, 1);
    const originalPivot = new THREE.Vector3(4, 0, 0);
    applyEntityRotation(root, entity, time);
    const actualPivot = new THREE.Vector3(-0.5, 0, 0).multiply(root.scale).applyQuaternion(root.quaternion).add(root.position);
    assert.ok(actualPivot.distanceTo(originalPivot) < 1e-9, `pivot moved at ${time}s`);
  }
});

test('旋转关键帧保留超过半圈的有向角度', () => {
  const animation = { pivot: [0, 0, 0], keys: [
    { time: 0, degrees: [0, 0, 0] }, { time: 2, degrees: [0, 270, 0] },
  ] };
  assert.equal(rotationDegreesAt(animation, 1)[1], 135);
  assert.equal(rotationDegreesAt(animation, 5)[1], 270);
});

test('旋转动画随场景保存并拒绝倒序关键帧', () => {
  const project = demoProject();
  const prop = project.entities.find(entity => entity.kind === 'prop');
  prop.rotationAnimation = {
    pivot: [-0.5, 0, 0],
    keys: [{ time: 0, degrees: [0, 0, 0] }, { time: 2, degrees: [0, 90, 0] }],
  };
  assert.deepEqual(validateProject(structuredClone(project)).entities.find(entity => entity.id === prop.id).rotationAnimation, prop.rotationAnimation);
  prop.rotationAnimation.keys[1].time = 0;
  assert.throws(() => validateProject(project), /旋转关键帧需要递增时间/);
});

test('时间轴拖动旋转段和单个关键帧保留角度与顺序', () => {
  const animation = { pivot: [0, 0, 0], keys: [
    { time: 0, degrees: [0, 0, 0] },
    { time: 1, degrees: [0, 90, 0] },
    { time: 2, degrees: [0, 180, 0] },
  ] };
  const shifted = retimeRotationAnimation(animation, 0.54, 24);
  assert.deepEqual(shifted.keys.map(key => key.time), [13 / 24, 1 + 13 / 24, 2 + 13 / 24]);
  assert.deepEqual(animation.keys.map(key => key.time), [0, 1, 2]);
  assert.deepEqual(shifted.keys.map(key => key.degrees[1]), [0, 90, 180]);
  retimeRotationAnimation(shifted, -100, 24).keys.forEach((key, index) => {
    assert.ok(Math.abs(key.time - index) < 1e-9);
  });
  const firstLater = retimeRotationAnimation(animation, 0.5, 24, 0);
  assert.deepEqual(firstLater.keys.map(key => key.time), [0.5, 1, 2]);
  const middleClamped = retimeRotationAnimation(animation, 10, 24, 1);
  assert.equal(middleClamped.keys[1].time, 2 - 1 / 24);
  assert.equal(middleClamped.keys[2].time, 2);
  assert.throws(() => retimeRotationAnimation(animation, 1, 24, 3), /旋转关键帧不存在/);
});
