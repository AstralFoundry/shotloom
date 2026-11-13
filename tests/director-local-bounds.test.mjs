import assert from 'node:assert/strict';
import test from 'node:test';
import { localObjectBounds } from '../vendor/shotloom-director-desk/src/core/editor/object-snapping.ts';
import * as THREE from '../vendor/shotloom-director-desk/node_modules/three/build/three.module.js';

test('墙的局部边界保持在自身坐标系，旋转和缩放后仍能确定左侧轴心', () => {
  const root = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 0.2));
  wall.position.y = 1.5;
  root.add(wall);
  root.position.set(8, 0, 3);
  root.rotation.y = Math.PI / 3;
  root.scale.set(2, 1, 1);

  const bounds = localObjectBounds(root);
  assert.ok(bounds);
  assert.deepEqual(bounds.min.toArray().map(value => Number(value.toFixed(6))), [-2, 0, -0.1]);
  assert.deepEqual(bounds.max.toArray().map(value => Number(value.toFixed(6))), [2, 3, 0.1]);
  assert.deepEqual(bounds.getSize(new THREE.Vector3()).toArray().map(value => Number(value.toFixed(6))), [4, 3, 0.2]);
});
