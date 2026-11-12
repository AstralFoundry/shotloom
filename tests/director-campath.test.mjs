import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 运镜 DSL。用语义动词描述机位运动（推、拉、摇、升降、环绕），由编译器展开成关键帧，
 * 而不是让调用方逐点计算坐标——逐点计算正是"相机卡在墙里"那类错误的来源。
 */

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cache = join(root, 'node_modules', '.cache');
mkdirSync(cache, { recursive: true });
const temporary = mkdtempSync(join(cache, 'director-campath-test-'));
const output = join(temporary, 'entry.mjs');
let campath;
try {
  const bundle = await build({
    stdin: {
      contents: `export { compileCampath } from './vendor/shotloom-director-desk/src/core/cinematography/campath.ts';`,
      resolveDir: root,
      sourcefile: 'director-campath-test-entry.ts',
    },
    bundle: true, platform: 'node', format: 'esm', write: false, outfile: output,
  });
  writeFileSync(output, bundle.outputFiles[0].contents);
  campath = await import(new URL(`file://${output}`).href);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

const compile = (source) => campath.compileCampath(source);

test('dolly / hold 编译成递增的关键帧，总时长等于各段之和', () => {
  const result = compile(`
campath "推近"
  look at 0 1 0
  from 0 1.2 7 fov 40
  dolly in 3.5 3s
  hold 0.5s
`);
  assert.equal(result.name, '推近');
  assert.equal(result.duration, 3.5);
  assert.deepEqual(result.points.map((point) => point.time), [0, 3, 3.5]);
  // look at 4 米外的点：dolly in 把机位朝它推 3.5 米（含 0.35 的吊臂分量）。
  for (let index = 1; index < result.points.length; index += 1)
    assert.ok(result.points[index].time > result.points[index - 1].time, '关键帧时间必须严格递增');
  assert.equal(result.look.mode, 'at');
  assert.deepEqual(result.focalKeys.map((key) => key.value), [40, 40, 40]);
});

test('orbit 生成圆弧，机位到中心的水平距离保持不变，方向按相机自身的左右', () => {
  const result = compile(`
campath "环绕"
  look at 0 1 0
  from 4 1.5 0 fov 35
  orbit right 90 4s
`);
  const radii = result.points.slice(1).map((point) => Math.hypot(point.position[0], point.position[2]));
  for (const radius of radii) assert.ok(Math.abs(radius - 4) < 1e-6, `半径应保持 4，实际 ${radius}`);
  // orbit right 是"相机朝它自己的右手边转"。相机在 +x 看向原点时屏幕右方是 −z，所以终点在 (0,−4)。
  const last = result.points[result.points.length - 1].position;
  assert.ok(Math.abs(last[0]) < 1e-6 && Math.abs(last[2] + 4) < 1e-6, `终点应在 (0,-4)，实际 ${last}`);
  const mirrored = compile('campath "左环绕"\n  look at 0 1 0\n  from 4 1.5 0\n  orbit left 90 4s\n');
  const mirroredEnd = mirrored.points[mirrored.points.length - 1].position;
  assert.ok(Math.abs(mirroredEnd[0]) < 1e-6 && Math.abs(mirroredEnd[2] - 4) < 1e-6, 'orbit left 与 right 互为反方向');
});

test('crane 只改变高度，move to 直接落到目标点', () => {
  const result = compile(`
campath "升降"
  look at 0 1 0
  from 2 1 5
  crane up 2 2s
  move to 2 3 2 1s
`);
  const [, afterCrane, afterMove] = result.points;
  assert.deepEqual(afterCrane.position, [2, 3, 5]);
  assert.deepEqual(afterMove.position, [2, 3, 2]);
});

test('语法错误带行号，并说明可用的写法', () => {
  assert.throws(() => compile('campath "x"\n  look at 0 1 0\n  from 0 1 5\n  fly 2s'), /第 4 行：不认识的动作「fly」/);
  assert.throws(() => compile('look at 0 1 0'), /第 1 行：第一行必须是 campath/);
  assert.throws(() => compile('campath "x"\n  from 0 1 5\n  hold 1s'), /缺少 look/);
  assert.throws(() => compile('campath "x"\n  look at 0 1 0\n  from 0 1 5\n  hold 65'), /时长要写成「3s」/);
  // look ahead 没有主体，相对运动（dolly）无从计算，必须明确拒绝而不是猜一个方向。
  assert.throws(() => compile('campath "x"\n  look ahead\n  from 0 1 5\n  dolly in 3 2s'), /dolly 是相对主体的运动/);
});

test('钳制与不支持的行为变成警告，而不是悄悄换一种运镜', () => {
  const result = compile(`
campath "警告"
  look target "abcdef12"
  from 0 1 5
  hold 1s fov 300
`);
  assert.equal(result.focalKeys[0].value, 120, 'fov 上限是 120');
  assert.ok(result.warnings.some((text) => /fov 300 超出/.test(text)));
  const looped = compile('campath "x"\n  look ahead\n  from 0 1 5\n  hold 1s\n  loop');
  assert.equal(looped.loop, 'loop');
  assert.ok(looped.warnings.some((text) => /没有循环标记/.test(text)));
  assert.ok(looped.warnings.some((text) => /不会随路径自动转向/.test(text)));
});
