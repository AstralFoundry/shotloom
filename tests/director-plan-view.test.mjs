import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 俯视平面图的取景数学。
 *
 * 布局参考图是俯视的，模型只有拿到同样视角、标着米制坐标的平面图，才能逐区域对照、按差异修改；
 * 否则只能对着参考图重新换算坐标，每次换算出的坐标系不同，已经建好的墙就会被整片推倒重建。
 * 这里守住方向（上方 −z、右方 +x）、比例和网格，模型从图上读出的坐标才可信。
 */

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cache = join(root, 'node_modules', '.cache');
mkdirSync(cache, { recursive: true });
const temporary = mkdtempSync(join(cache, 'director-plan-test-'));
const output = join(temporary, 'entry.mjs');
let plan;
try {
  const bundle = await build({
    stdin: {
      contents: `export { planFraming, planToPixel, planGridLines, planGridStep } from './vendor/shotloom-director-desk/src/core/editor/plan-view.ts';`,
      resolveDir: root,
      sourcefile: 'director-plan-test-entry.ts',
    },
    bundle: true, platform: 'node', format: 'esm', write: false, outfile: output,
  });
  writeFileSync(output, bundle.outputFiles[0].contents);
  plan = await import(new URL(`file://${output}`).href);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

test('平面图取景留出边距并保持长宽比，长边对齐指定像素', () => {
  const framing = plan.planFraming({ minX: 0, maxX: 4, minZ: 0, maxZ: 16 }, 1024);
  assert.equal(framing.pixels.height, 1024);
  assert.equal(framing.pixels.width, Math.round(framing.width / framing.metersPerPixel));
  assert.ok(Math.abs(framing.width / framing.height - framing.pixels.width / framing.pixels.height) < 0.01);
  assert.ok(framing.shown.minX < 0 && framing.shown.maxX > 4 && framing.shown.minZ < 0 && framing.shown.maxZ > 16, '布景边缘不能贴着图框');
});

test('世界坐标落到图上：上方是 −z（北），右方是 +x', () => {
  const framing = plan.planFraming({ minX: -5, maxX: 5, minZ: -8, maxZ: 2 }, 1024);
  assert.deepEqual(plan.planToPixel(framing, framing.shown.minX, framing.shown.minZ), [0, 0]);
  const [right, bottom] = plan.planToPixel(framing, framing.shown.maxX, framing.shown.maxZ);
  assert.ok(Math.abs(right - framing.pixels.width) < 1e-6 && Math.abs(bottom - framing.pixels.height) < 1e-6);
  const [, north] = plan.planToPixel(framing, 0, -6);
  const [, south] = plan.planToPixel(framing, 0, 1);
  assert.ok(north < south, '更靠北（z 更小）的点在图上更靠上');
  const [west] = plan.planToPixel(framing, -4, 0);
  const [east] = plan.planToPixel(framing, 4, 0);
  assert.ok(west < east, '+x 在图上向右');
});

test('网格线落在整步长上、覆盖整幅图，数量保持可读', () => {
  const framing = plan.planFraming({ minX: -5, maxX: 5, minZ: -8, maxZ: 2 }, 1024);
  const grid = plan.planGridLines(framing);
  for (const value of [...grid.x, ...grid.z]) {
    assert.ok(Math.abs(value / framing.gridStep - Math.round(value / framing.gridStep)) < 1e-9, `${value} 不在步长 ${framing.gridStep} 上`);
  }
  assert.ok(grid.x.includes(0) && grid.z.includes(0), '跨过原点时必须有 0 刻度');
  assert.ok(grid.x.length <= 15 && grid.z.length <= 15);
  assert.ok(grid.x.every((x) => x >= framing.shown.minX && x <= framing.shown.maxX));
});

test('网格步长随范围取整：1 米一格到 100 米一格', () => {
  assert.equal(plan.planGridStep(6), 0.5);
  assert.equal(plan.planGridStep(12), 1);
  assert.equal(plan.planGridStep(30), 5);
  assert.equal(plan.planGridStep(5000), 100);
});
