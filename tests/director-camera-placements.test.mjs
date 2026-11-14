import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { CAMERA_PLACEMENTS, createPlacedCamera } from '../vendor/shotloom-director-desk/src/core/cinematography/camera-placements.ts';
import { demoProject, validateProject } from '../vendor/shotloom-director-desk/src/core/model.ts';
const require = createRequire(new URL('../vendor/shotloom-director-desk/package.json', import.meta.url));
const { PerspectiveCamera, Vector3 } = require('three');
const input = {
  name: '测试机位', target: [10, 2.2, -3],
  subject: { id: 'subject', position: [10, 1, -3], yaw: Math.PI / 2, targetHeight: 1.2 },
  currentView: { position: [7, 8, 9], rotation: [0.3, -0.6, 0.2], focal: 55 },
};
const near = (actual, expected) => actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-9));

test('构图预设随主体朝向旋转，并使用主体所在位置和目标高度', () => {
  const camera = createPlacedCamera({ ...input, presetId: 'front-medium' });
  near(camera.position, [14.5, 2.4, -3]);
  assert.equal(camera.camera.targetId, 'subject');
  assert.equal(camera.camera.targetHeight, 1.2);
  assert.equal(camera.camera.focal, 50);
  assert.equal(camera.camera.aim, 'target');
});

test('当前视角完整复制手动朝向、位置与焦距，不被目标注视覆盖', () => {
  const camera = createPlacedCamera({ ...input, presetId: 'current' });
  assert.deepEqual(camera.position, input.currentView.position);
  assert.deepEqual(camera.rotation, input.currentView.rotation);
  assert.equal(camera.camera.focal, 55);
  assert.equal(camera.camera.aim, 'manual');
  assert.equal(camera.camera.targetId, '');
  camera.position[0] = 99;
  assert.equal(input.currentView.position[0], 7);
});

test('侧面跟拍偏移相对主体基点保存，创建帧和跟随帧位置连续', () => {
  const camera = createPlacedCamera({ ...input, presetId: 'side-follow' });
  assert.equal(camera.camera.mode, 'follow');
  assert.equal(camera.camera.inheritRotation, false);
  const followed = new Vector3(...input.subject.position).add(new Vector3(...camera.camera.offset));
  near(followed.toArray(), camera.position);
  near(followed.add(new Vector3(1, 0, 2)).toArray(), camera.position.map((value, index) => value + [1, 0, 2][index]));
});

test('荷兰角保持注视方向，并围绕镜头光轴倾斜 22.5 度', () => {
  const camera = createPlacedCamera({ ...input, presetId: 'dutch' });
  const rendered = new PerspectiveCamera();
  rendered.position.set(...camera.position);
  rendered.rotation.set(...camera.rotation);
  const direction = new Vector3(...input.target).sub(rendered.position).normalize();
  near(rendered.getWorldDirection(new Vector3()).toArray(), direction.toArray());
  const level = new PerspectiveCamera();
  level.position.copy(rendered.position);
  level.lookAt(new Vector3(...input.target));
  assert.ok(Math.abs(level.quaternion.angleTo(rendered.quaternion) - Math.PI / 8) < 1e-9);
  assert.equal(camera.camera.aim, 'manual');
});

test('全部预设可随工程保存，无主体时仍可围绕视口目标布置', () => {
  const project = demoProject();
  for (const preset of CAMERA_PLACEMENTS) {
    const camera = createPlacedCamera({ ...input, subject: undefined, presetId: preset.id });
    assert.equal(camera.camera.targetId, '');
    assert.equal(camera.camera.mode, 'free');
    assert.ok(camera.position.every(Number.isFinite));
    project.entities.push(camera);
  }
  assert.doesNotThrow(() => validateProject(structuredClone(project)));
});
