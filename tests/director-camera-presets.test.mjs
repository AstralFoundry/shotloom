import assert from 'node:assert/strict';
import test from 'node:test';
import { CAMERA_PRESETS, cameraPresetPath } from '../vendor/shotloom-director-desk/src/core/cinematography/camera-presets.ts';
import { assertCameraLookPath } from '../vendor/shotloom-director-desk/src/core/animation/camera-look.ts';
const start = [3, 2, 6], target = [0, 1, 0];
const move = (id, context = {}) => cameraPresetPath(id, start, target, 3, 4, 50, context);
const near = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-8, `${a} ≠ ${b}`));
const delta = (a, b) => a.map((v, i) => v - b[i]);

test('all available moves start at the current camera, persist finite keys and valid look paths', () => {
  assert.equal(new Set(CAMERA_PRESETS.map(p => p.id)).size, CAMERA_PRESETS.length);
  for (const preset of CAMERA_PRESETS.filter(p => !p.unavailable)) {
    const motion = move(preset.id, { foreground: { center: [1, 1, 3], radius: 0.5 } });
    near(motion.path.points[0].position, start);
    assert.equal(motion.path.points[0].time, 3);
    assert.equal(motion.path.points.at(-1).time, 7);
    assertCameraLookPath(motion.targetPath);
    motion.path.points.forEach((p, i, points) => {
      assert.ok(p.position.every(Number.isFinite), preset.id);
      assert.ok(!i || p.time > points[i - 1].time, preset.id);
    });
  }
});

test('pans rotate in place; basic translations preserve view direction', () => {
  for (const id of ['fixed', 'tilt-up', 'tilt-down', 'pan-left', 'pan-right', 'whip-pan', 'zoom-in', 'zoom-out']) {
    move(id).path.points.forEach(p => near(p.position, start));
  }
  for (const id of ['rise', 'fall', 'truck', 'truck-left', 'dolly-in', 'dolly-out', 'fly-through', 'fpv']) {
    const { path, targetPath } = move(id);
    path.points.forEach((p, i) => near(delta(targetPath.points[i].position, p.position), delta(target, start)));
  }
  assert.ok(move('tilt-up').targetPath.points.at(-1).position[1] > target[1]);
  assert.ok(move('tilt-down').targetPath.points.at(-1).position[1] < target[1]);
});

test('zoom changes focal length without moving; dolly zoom preserves subject projection scale', () => {
  assert.ok(move('zoom-in').focalKeys.at(-1).value > 50);
  assert.ok(move('zoom-out').focalKeys.at(-1).value < 50);
  const dolly = move('dolly-zoom');
  const dist = p => Math.hypot(...delta(p, target));
  assert.ok(Math.abs(dolly.focalKeys.at(-1).value / dist(dolly.path.points.at(-1).position) - 50 / dist(start)) < 1e-8);
  assert.equal(move('snap-zoom').focalKeys.length, 4);
});

test('follow and orbit sample the moving subject rather than a fixed world target', () => {
  const subjectAt = t => [t - 3, 1, (t - 3) * 0.5];
  for (const id of ['follow', 'orbit', 'spiral-rise', 'spiral-fall']) {
    const m = move(id, { subjectAt });
    m.targetPath.points.forEach(p => near(p.position, subjectAt(p.time)));
    if (id === 'follow' || id === 'orbit') near(delta(m.path.points.at(-1).position, subjectAt(7)), delta(start, target));
  }
});

test('handheld is deterministic, foreground requires a real object, focus stays explicitly unavailable', () => {
  assert.deepEqual(move('handheld'), move('handheld'));
  assert.throws(() => move('foreground-wipe'), /遮挡物/);
  assert.throws(() => move('rack-focus'), /景深/);
  assert.throws(() => move('invented'), /未知/);
});
