import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import test from 'node:test';
import { readSource } from './helpers/sourceContract.mjs';

const repoRoot = new URL('..', import.meta.url).pathname;
const read = (path) => readSource(path);
const runGate = () => execFileSync(process.execPath, ['scripts/verify-styles.mjs'], {
  cwd: repoRoot,
  stdio: 'pipe',
});

test('样式门禁把色阶锁在 tokens 里并拒绝未加载的区域样式', () => {
  const script = read('scripts/verify-styles.mjs');
  // 颜色字面量只允许出现在自定义属性声明上，其余一律违规。
  assert.match(script, /if \(token\) continue;[\s\S]*COLOR_LITERAL/);
  assert.match(script, /写了颜色字面量/);
  // 写了却没被 main.tsx 导入的样式表就是死样式；导入集与磁盘集必须完全相等。
  assert.match(script, /没有被 main\.tsx 导入/);
  assert.match(script, /全局入口只允许导入 styles\.css 与 renderer\/styles\/ 下的区域样式/);
  // 未定义的 var() 引用会在界面上静默失效，门禁直接失败。
  assert.match(script, /引用了未定义的/);
  runGate();
});

test('全局入口按区域拆分样式表，导入顺序即层叠顺序', () => {
  const main = read('renderer/src/main.tsx');
  const imports = [...main.matchAll(/^import\s+'([^']+\.css)';$/gm)].map((match) => match[1]);
  assert.ok(imports.length >= 10, `区域样式必须成组导入，实际 ${imports.length} 个`);
  assert.equal(imports[0], '../styles/tokens.css');
  // styles.css 只剩基础层，组件规则一律住在 renderer/styles/<area>.css。
  const baseLines = read('renderer/styles.css').split('\n').length;
  assert.ok(baseLines < 90, `styles.css 应只保留基础层，实际 ${baseLines} 行`);
  const areas = readdirSync(new URL('../renderer/styles', import.meta.url))
    .filter((name) => name.endsWith('.css') && name !== 'tokens.css');
  for (const name of areas) {
    assert.ok(imports.some((specifier) => specifier.endsWith(`/${name}`)), `${name} 必须出现在全局导入里`);
  }
});

test('界面色阶成组且成对提供深色镜像', () => {
  const tokens = read('renderer/styles/tokens.css');
  const light = tokens.slice(0, tokens.indexOf('.dark {'));
  const dark = tokens.slice(tokens.indexOf('.dark {'));
  // 中性灰底、遮罩、可拖拽条与浮层白底各自成组，组件不再私造新档。
  for (const name of ['--wash-hover', '--wash-pressed', '--wash-inset',
    '--scrim-soft', '--scrim-modal', '--grip', '--grip-active',
    '--float-surface-wash', '--float-surface-soft', '--float-surface', '--float-surface-solid',
    '--brand-accent-wash', '--brand-accent-tint', '--brand-accent-border']) {
    assert.ok(light.includes(`${name}:`), `${name} 必须在浅色主题里定义`);
    // 界面灰底与半透明白底在深色主题下必须换向，否则暗画布上会出现脏白。
    assert.ok(dark.includes(`${name}:`), `${name} 缺少深色镜像`);
  }
  // 素材层的着色属于素材不属于界面，深色镜像同值是设计决定。
  for (const name of ['--overlay-shade', '--overlay-fill', '--overlay-chip']) {
    assert.ok(light.includes(`${name}:`), `${name} 必须在浅色主题里定义`);
    assert.ok(!dark.includes(`${name}:`), `${name} 不该有深色镜像`);
  }
});

test('产品样式表不再出现规则级颜色字面量', () => {
  const readStyles = (directory, prefix) => readdirSync(new URL(directory, import.meta.url), { withFileTypes: true })
    .flatMap((entry) => entry.isDirectory()
      ? readStyles(`${directory}${entry.name}/`, `${prefix}${entry.name}/`)
      : entry.name.endsWith('.css') ? [`${prefix}${entry.name}`] : []);
  const sheets = readStyles('../renderer/styles/', 'renderer/styles/')
    .concat(readStyles('../renderer/src/', 'renderer/src/'))
    .filter((file) => !file.includes('/vendor/'));
  for (const file of sheets) {
    const text = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
    const offending = text.split('\n')
      .filter((line) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(line) && !/--[\w-]+\s*:/.test(line));
    assert.deepEqual(offending, [], `${file} 仍有颜色字面量`);
  }
});
