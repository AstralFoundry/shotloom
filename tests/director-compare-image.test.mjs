import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 参考图确定性比对。
 *
 * 这些数字回答的是"哪里像、哪里不像"，用来把"布局和参考图差距有点大"拆成可修改的具体区域。
 * 测试同时守住它的边界：剪影按包围盒归一，所以整体平移不会被判为形状不符——那是设计，
 * 位移要看 `gridDiff`。
 */

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cache = join(root, 'node_modules', '.cache');
mkdirSync(cache, { recursive: true });
const temporary = mkdtempSync(join(cache, 'director-compare-test-'));
const output = join(temporary, 'entry.mjs');
let compare;
try {
  const bundle = await build({
    stdin: {
      contents: `export { compareImages, foregroundMask } from './vendor/shotloom-director-desk/src/core/editor/compare-image.ts';`,
      resolveDir: root,
      sourcefile: 'director-compare-test-entry.ts',
    },
    bundle: true, platform: 'node', format: 'esm', write: false, outfile: output,
  });
  writeFileSync(output, bundle.outputFiles[0].contents);
  compare = await import(new URL(`file://${output}`).href);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

/** 纯色画布 + 一个矩形前景，模拟"浅色背景上摆了个灰模"。 */
function picture({ size = 96, rect, background = [246, 246, 244], ink = [90, 92, 96] } = {}) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inside = rect && x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
      const colour = inside ? ink : background;
      const index = (y * size + x) * 4;
      data[index] = colour[0];
      data[index + 1] = colour[1];
      data[index + 2] = colour[2];
      data[index + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

const box = (x, y, width, height) => ({ x, y, width, height });

test('完全相同的两张图：剪影重合、颜色一致、判为 strong', () => {
  const image = picture({ rect: box(20, 24, 40, 30) });
  const result = compare.compareImages(image, picture({ rect: box(20, 24, 40, 30) }));
  assert.equal(result.silhouetteIou, 1);
  assert.equal(result.colorSimilarity, 1);
  assert.equal(result.verdict, 'strong');
  assert.deepEqual(result.gridDiff.filter((value) => value !== 0), []);
});

test('同一形状整体平移：剪影仍吻合，位移由 4×4 网格差指出', () => {
  // 剪影按各自包围盒归一，所以"形状像、位置不同"正是它要分开看的两种差异。
  const left = picture({ rect: box(8, 8, 24, 24) });
  const right = picture({ rect: box(60, 60, 24, 24) });
  const result = compare.compareImages(left, right);
  assert.equal(result.silhouetteIou, 1, '形状相同，归一后剪影应当吻合');
  assert.ok(result.gridDiff.some((value) => Math.abs(value) > 0.05), '位置不同必须在网格差里体现');
  const worst = result.worstCells[0];
  assert.ok(worst.difference > 0.05);
  // 左上的图在左上角有前景，参考图在右下角。
  assert.ok(result.gridDiff[0] > 0 && result.gridDiff[15] < 0);
});

test('形状不同：剪影重合度和宽高比都下降', () => {
  const square = compare.compareImages(picture({ rect: box(24, 24, 40, 40) }), picture({ rect: box(24, 24, 40, 40) }));
  const bar = compare.compareImages(picture({ rect: box(24, 24, 40, 40) }), picture({ rect: box(16, 40, 64, 8) }));
  assert.ok(bar.silhouetteIou < square.silhouetteIou - 0.3, `细长条应当明显更差：${bar.silhouetteIou}`);
  assert.ok(bar.aspect.difference > 0.8, '宽高比差异要能被读出来');
  assert.notEqual(bar.verdict, 'strong');
});

test('两侧都是空白图时不崩、也不给满分', () => {
  const blank = picture({ rect: null });
  const result = compare.compareImages(blank, blank);
  assert.equal(result.coverage.render, 0);
  assert.equal(result.silhouetteIou, 0);
  assert.equal(result.colorSimilarity, 0);
  assert.equal(result.verdict, 'weak');
  assert.ok(Number.isFinite(result.aspect.difference));
});

test('前景按与背景色的距离判定，深色主体在浅色底上能被识别', () => {
  const mask = compare.foregroundMask(picture({ rect: box(10, 10, 20, 20) }));
  assert.ok(mask.box, '应当找到前景');
  const width = mask.box.maxX - mask.box.minX + 1;
  const height = mask.box.maxY - mask.box.minY + 1;
  assert.ok(Math.abs(width - height) <= 2, `方形主体在分析网格上仍应近似方形，实际 ${width}×${height}`);
});
