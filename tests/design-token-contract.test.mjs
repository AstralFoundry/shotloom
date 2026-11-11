import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readSource } from './helpers/sourceContract.mjs';

const root = new URL('..', import.meta.url).pathname;

// 第三方导演台、OpenReel 与官方 Harness 的隔离 UI 自带样式；public 下是构建产物。
const EXCLUDED = ['/vendor/', '/public/openreel/', '/public/harness/', '/public/director-desk-app/'];

function collectCss(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (EXCLUDED.some((x) => p.replaceAll('\\', '/').includes(x))) continue;
    if (statSync(p).isDirectory()) out.push(...collectCss(p));
    else if (p.endsWith('.css')) out.push(p);
  }
  return out;
}

const read = (rel) => readSource(rel);
const lines = [];
for (const file of collectCss(join(root, 'renderer'))) {
  const rel = relative(root, file).replaceAll('\\', '/');
  readFileSync(file, 'utf8').split('\n').forEach((text, i) => lines.push({ rel, text, no: i + 1 }));
}

// 变量定义表：字号/圆角别名允许引用阶梯，但阶梯本体只能有一个来源。
const definitions = new Map();
for (const l of lines) {
  const m = l.text.match(/^\s*(--[\w-]+)\s*:\s*([^;]+)/);
  if (m) definitions.set(m[1], m[2].trim());
}

const valueOf = (text, prop) => (text.split(prop)[1] ?? '').split(';')[0].trim();

function derivesFromLadder(value, depth = 0) {
  // 文字走 --text 阶梯，图标字形走 --icon 刻度；两者都只在 tokens.css 里定义。
  if (/var\(--(?:text|icon)-|inherit|^0$/.test(value)) return true;
  if (depth > 2) return false;
  const refs = [...value.matchAll(/var\((--[\w-]+)/g)];
  if (!refs.length) return false;
  return refs.every((ref) => {
    const def = definitions.get(ref[1]);
    // 运行时由 TSX 注入的倍率变量没有磁盘定义，它不引入新字号。
    return !def || derivesFromLadder(def, depth + 1);
  });
}

test('字体栈只有一个入口：产品样式不写具体字体名', () => {
  const bad = lines
    .filter((l) => /font-family\s*:/.test(l.text))
    .filter((l) => !/var\(--font-|inherit|unset|initial/.test(valueOf(l.text, 'font-family:')))
    .map((l) => `${l.rel}:${l.no} ${l.text.trim()}`);
  assert.deepEqual(bad, []);

  const tokens = read('renderer/styles/tokens.css');
  assert.match(tokens, /--font-ui:/);
  assert.match(tokens, /--font-mono:/);
  assert.match(tokens, /--font-serif:/);
});

test('字号只走 tokens.css 阶梯，角色别名必须回指阶梯', () => {
  const bad = lines
    .filter((l) => /font-size\s*:/.test(l.text))
    .filter((l) => !derivesFromLadder(valueOf(l.text, 'font-size:')))
    .map((l) => `${l.rel}:${l.no} ${l.text.trim()}`);
  assert.deepEqual(bad, []);

  const fontShorthand = lines
    .filter((l) => /(^|[;\s])font:\s*/.test(l.text))
    .filter((l) => {
      const value = valueOf(l.text, 'font:');
      return value !== 'inherit' && (!/var\(--text-/.test(value) || /"(?:SF|PingFang|Helvetica|Arial|Georgia|Consolas)/.test(value));
    })
    .map((l) => `${l.rel}:${l.no} ${l.text.trim()}`);
  assert.deepEqual(fontShorthand, []);
});

test('圆角只有一个刻度：要么用 --radius 派生令牌，要么是纯形状或语义缩放几何', () => {
  const shapePart = (part) => /^(?:999|99)px$|^50%$|^inherit$|^0(?:px)?$/.test(part);
  const radiusToken = (part) => /var\(--[\w-]*radius[\w-]*\)/.test(part);
  const allowed = (value) => {
    const v = value.replace(/!important/g, '').trim();
    // 名称锚点一类的几何随语义缩放计算，圆角必须跟尺寸一起缩放。
    if (/var\(--(?:node-label-zoom|canvas-node-zoom)/.test(v)) return true;
    const parts = v.includes('calc(') ? [v] : v.split(/\s+/);
    return parts.every((part) => shapePart(part) || radiusToken(part));
  };

  const bad = lines
    .filter((l) => /border-radius\s*:/.test(l.text))
    .filter((l) => !allowed(valueOf(l.text, 'border-radius:')))
    .map((l) => `${l.rel}:${l.no} ${l.text.trim()}`);
  assert.deepEqual(bad, []);

  // 面板/工作台刻度也只能从 --radius 推导，不再各写一套数字。
  const tokens = read('renderer/styles/tokens.css');
  assert.match(tokens, /--radius: 12px/);
  assert.match(tokens, /--workbench-radius: var\(--radius-xl\)/);
  assert.doesNotMatch(tokens, /--radius-\w+:\s*\d+(?:\.\d+)?px/);

  const chatTheme = read('renderer/styles/agent-theme.css');
  assert.match(chatTheme, /--slk-radius-panel: var\(--radius-2xl\)/);
  assert.doesNotMatch(chatTheme, /--slk-radius-\w+:\s*\d/);
});

test('抬升只有 tokens.css 的阴影档：产品样式不往 box-shadow 里写颜色字面量', () => {
  const literal = /rgba?\(|#[0-9a-fA-F]{3,8}/;
  // 只看落影自己的值：同行的 background/color 里允许 α 字面量（媒体层白墨填充）。
  const shadowValues = (text) => [
    ...[...text.matchAll(/box-shadow\s*:\s*([^;]+)/g)].map((m) => m[1]),
    ...[...text.matchAll(/drop-shadow\(([^)]*)\)/g)].map((m) => m[1]),
  ];
  const bad = lines
    .filter((l) => l.rel !== 'renderer/styles/tokens.css')
    .filter((l) => !/^\s*(?:\/\*|\*)/.test(l.text))
    .filter((l) => shadowValues(l.text).some((v) => literal.test(v)))
    .map((l) => `${l.rel}:${l.no} ${l.text.trim()}`);
  assert.deepEqual(bad, []);

  // 抬升档位与几何只在这一处定义：card 静止、lift 抬起、panel/dropdown/menu 浮层、
  // prompt 输入卡、float 画布浮层、cast-* 停靠面板的方向性投影、modal 遮罩之上的层。
  const tokens = read('renderer/styles/tokens.css');
  for (const tier of ['--shadow-card', '--shadow-lift', '--canvas-shadow-panel', '--canvas-shadow-dropdown',
    '--canvas-shadow-menu', '--canvas-prompt-shadow', '--drop-shadow-sm', '--shadow-float',
    '--shadow-cast-right', '--shadow-cast-up', '--shadow-modal', '--overlay-cast', '--overlay-hairline']) {
    assert.ok(definitions.has(tier), `${tier} 未在 tokens.css 定义`);
    assert.match(tokens, new RegExp(`${tier}:`));
  }

  // 对话面板的发丝描边语言保留，但落影只能借产品档位，不再自带 α 数字。
  const chatTheme = read('renderer/styles/agent-theme.css');
  assert.match(chatTheme, /--slk-elevation-panel: var\(--slk-elevation-stroke\), var\(--shadow-card\)/);
  assert.match(chatTheme, /--slk-elevation-prominent: var\(--slk-elevation-stroke\), var\(--shadow-lift\)/);
  assert.doesNotMatch(chatTheme, /--slk-elevation-\w+:[^;]*rgba?\(/);
});

test('动效只有 tokens.css 的时长与曲线档：过渡与一次性动画不写裸毫秒、裸 ease 或私有贝塞尔', () => {
  // 按声明扫描，跨行写法也要覆盖。var() 里的令牌名可能叫 --ease-std，先剥离引用再看剩余字面量。
  const byFile = new Map();
  for (const l of lines) {
    if (!byFile.has(l.rel)) byFile.set(l.rel, []);
    byFile.get(l.rel).push(l);
  }
  const offLadder = (value) => {
    const v = value.replace(/var\([^)]*\)/g, '');
    return /[0-9.]+(?:ms|s)\b/.test(v) || /\bease(-in|-out|-in-out)?\b|\blinear\b|cubic-bezier\(/.test(v);
  };

  const bad = [];
  for (const [rel, group] of byFile) {
    if (rel === 'renderer/styles/tokens.css') continue;
    const text = group.map((l) => l.text).join('\n');
    for (const m of text.matchAll(/(?:^|[{;\s])(transition|animation)\s*:\s*([^;]*)/gm)) {
      const value = m[2];
      // 循环动画的周期与 linear 属于动画本身（shimmer、脉冲、spinner），不在档位契约内。
      if (/\binfinite\b/.test(value) || /^\s*none\b/.test(value)) continue;
      if (!offLadder(value)) continue;
      const idx = text.slice(0, m.index + m[0].indexOf(m[1])).split('\n').length - 1;
      bad.push(`${rel}:${group[idx].no} ${group[idx].text.trim()}`);
    }
  }
  assert.deepEqual(bad, []);

  // 曲线也只在这一个文件里出现。
  const bezier = lines.filter((l) => /cubic-bezier\(/.test(l.text) && l.rel !== 'renderer/styles/tokens.css')
    .map((l) => `${l.rel}:${l.no}`);
  assert.deepEqual(bezier, []);

  const tokens = read('renderer/styles/tokens.css');
  for (const tier of ['--duration-fast', '--duration-base', '--duration-enter', '--duration-slow',
    '--duration-stagger', '--ease-out', '--ease-std', '--ease-sheet', '--ease-pop']) {
    assert.ok(definitions.has(tier), `${tier} 未在 tokens.css 定义`);
  }

  // 对话面板的动效别名只指向产品档位，不自带第二套时长。
  const chatTheme = read('renderer/styles/agent-theme.css');
  assert.match(chatTheme, /--slk-dur-fast: var\(--duration-fast\)/);
  assert.match(chatTheme, /--slk-dur: var\(--duration-base\)/);
  assert.match(chatTheme, /--slk-dur-slow: var\(--duration-slow\)/);
  assert.doesNotMatch(chatTheme, /--slk-dur[\w-]*:\s*[0-9.]+m?s/);
});

test('色阶只有一个来源：产品样式不写十六进制颜色', () => {
  const bad = lines
    .filter((l) => l.rel !== 'renderer/styles/tokens.css')
    .filter((l) => !/^\s*(?:\/\*|\*)/.test(l.text))
    .filter((l) => /#[0-9a-fA-F]{3,8}\b/.test(l.text))
    .map((l) => `${l.rel}:${l.no} ${l.text.trim()}`);
  assert.deepEqual(bad, []);
});

test('画布浮层的动作高度只由条高派生，不在各条里各写一个数字', () => {
  const tokens = read('renderer/styles/tokens.css');
  assert.match(tokens, /--canvas-toolbar-action: calc\(var\(--canvas-toolbar-height\) - 6px\)/);
  assert.match(tokens, /--canvas-toolbar-action-compact: calc\(var\(--canvas-toolbar-height-compact\) - 6px\)/);
  assert.match(tokens, /--toolbar-divider-width: \.5px/);

  const canvas = read('renderer/styles/canvas.css');
  for (const selector of [
    '\\.canvas-node-selection-toolbar button \\{',
    '\\.canvas-node-selection-toolbar--subtle button \\{',
    '\\.canvas-zoom-group button \\{',
  ]) {
    const block = canvas.match(new RegExp(`${selector}[\\s\\S]*?\\}`));
    assert.ok(block, `${selector} 规则缺失`);
    assert.match(block[0], /height: var\(--canvas-toolbar-action(-compact)?\)/);
    assert.doesNotMatch(block[0], /height: [0-9.]+px/, `${selector} 又写回了裸高度`);
  }

  // 同一套浮层语言里的分隔线只有一种厚度。
  for (const selector of [
    '\\.canvas-node-toolbar-divider',
    '\\.canvas-zoom-group > span',
    '\\.canvas-image-annotation-editor \\.screenshots-operations-divider',
  ]) {
    const decl = canvas.match(new RegExp(`${selector}[^}]*?\\}`));
    assert.ok(decl, `${selector} 规则缺失`);
    assert.match(decl[0], /width: var\(--toolbar-divider-width\)/, `${selector} 的分隔线厚度没走档位`);
  }
});

test('字距只走 tokens.css 的 tracking 档：产品样式不写裸 letter-spacing', () => {
  const bad = lines
    .filter((l) => l.rel !== 'renderer/styles/tokens.css')
    .filter((l) => !/^\s*(?:\/\*|\*)/.test(l.text))
    .filter((l) => /letter-spacing\s*:/.test(l.text))
    .filter((l) => !/var\(--tracking-|inherit|unset|initial/.test(valueOf(l.text, 'letter-spacing:')))
    .map((l) => `${l.rel}:${l.no} ${l.text.trim()}`);
  assert.deepEqual(bad, []);

  // 档位一律用 em，同一档在不同字号上的视觉密度才一致；数值只在这一个文件里出现。
  const tokens = read('renderer/styles/tokens.css');
  for (const tier of ['--tracking-tight', '--tracking-normal', '--tracking-wide', '--tracking-widest']) {
    const value = definitions.get(tier);
    assert.ok(value, `${tier} 未在 tokens.css 定义`);
    assert.match(value, /em$/, `${tier} 必须是 em 档位：${value}`);
  }
  assert.doesNotMatch(tokens, /--tracking-\w+:\s*-?\d+(?:\.\d+)?px/);
});



test('tokens.css 里不许出现"定义了却没人用"的档位', () => {
  const tokens = read('renderer/styles/tokens.css');
  const names = [...new Set([...tokens.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]))];

  const sources = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (EXCLUDED.some((x) => p.replaceAll('\\', '/').includes(x))) continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(css|ts|tsx)$/.test(p)) sources.push(readFileSync(p, 'utf8'));
    }
  };
  walk(join(root, 'renderer'));
  const all = sources.join('\n');

  // 成对行高是字号标尺的一部分，阶梯本体保留完整配对，不为了"有消费者"删掉量尺。
  const ALLOWED = new Set(['--text-display-24--line-height']);
  const unconsumed = names.filter(
    (n) => !new RegExp(`var\\(\\s*${n}\\s*[,)]`).test(all) && !ALLOWED.has(n),
  );
  assert.deepEqual(unconsumed, [], `这些档位没有任何消费者：${unconsumed.join(', ')}`);
});
