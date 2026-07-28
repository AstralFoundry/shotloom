import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const grid = readFileSync(
  new URL('../renderer/src/app/components/MaterialGrid.tsx', import.meta.url),
  'utf8',
);
const styles = readFileSync(
  new URL('../renderer/styles/react-migration.css', import.meta.url),
  'utf8',
);

test('素材图片接近可视区域后才读取缓存缩略图', () => {
  assert.match(grid, /sharedPreviewObserver = new IntersectionObserver/);
  assert.match(grid, /rootMargin: "360px 0px"/);
  assert.match(grid, /schedulePreviewLoad/);
  assert.match(grid, /readImagePreview\(path, 640\)/);
  assert.match(grid, /loading="lazy"/);
  assert.match(grid, /decoding="async"/);
  assert.doesNotMatch(grid, /for \(const file of materials\)/);
  assert.doesNotMatch(grid, /readArrayBuffer\(file\.path\)/);
});

test('素材视频优先流式展示，失败时使用正确 MIME 缓冲回退', () => {
  assert.match(grid, /convertFileSrc\(path\)/);
  assert.match(grid, /bufferedPath === path/);
  assert.match(grid, /mp4: "video\/mp4"/);
  assert.match(grid, /preload="metadata"/);
  assert.match(grid, /video\.currentTime = Math\.min\(1 \/ 30/);
});

test('素材卡片跳过视口外绘制且每张卡片独立维护预览状态', () => {
  assert.match(grid, /const MaterialPreview = memo/);
  assert.match(styles, /\.material-node-wrap \{[^}]*content-visibility: auto/);
  assert.match(styles, /contain-intrinsic-size: 280px 240px/);
});

test('竖图和长截图按真实方向使用更高的完整预览卡片', () => {
  assert.match(grid, /ratio < 0\.62 \? "tall" : ratio < 0\.9 \? "portrait"/);
  assert.match(grid, /updateLayout\(image\.naturalWidth, image\.naturalHeight\)/);
  assert.match(grid, /updateLayout\(video\.videoWidth, video\.videoHeight\)/);
  assert.match(styles, /layout-portrait\)[^}]*height: 360px/);
  assert.match(styles, /layout-tall\)[^}]*height: 420px/);
  assert.match(styles, /\.material-node-preview \{[^}]*width: 100%;[^}]*height: 100%/);
  assert.match(styles, /object-position: center top/);
});
