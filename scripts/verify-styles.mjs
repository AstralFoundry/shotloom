#!/usr/bin/env node
// 样式层门禁：AGENTS.md 的“全局样式按区域分文件、颜色只来自 tokens”只有被机器检查才不会漂移。
// 这里检查四件事：层叠入口唯一、styles.css 只留基础层、颜色字面量只允许写在自定义属性上、
// 每个 var() 引用都能找到真实定义。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = path.resolve(import.meta.dirname, '..');
const rendererRoot = path.join(repoRoot, 'renderer');
const stylesRoot = path.join(rendererRoot, 'styles');
const entryFile = path.join(rendererRoot, 'src', 'main.tsx');

const read = (file) => readFileSync(file, 'utf8');
const relative = (file) => path.relative(repoRoot, file).replace(/\\/g, '/');

// 上游 vendor 样式属于第三方实现，改动它等于分叉厂商代码；隔离边界见 Stage 5.3。
const VENDOR_EXEMPT = `${path.join(repoRoot, 'vendor')}${path.sep}`;

// styles.css 是全局基础层：reset、滚动条、焦点环。类选择器只允许这两条登记例外——
// `.hidden` 是被界面代码直接写在元素上的通用工具类，`label.button` 是“把链接呈现成按钮”的元素规则，
// 它们都不属于任何组件。
const BASE_LAYER_CLASS_EXCEPTIONS = new Set(['hidden', 'button']);

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

function cssFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const entry = path.join(directory, name);
    if (statSync(entry).isDirectory()) return cssFiles(entry);
    return name.endsWith('.css') && !entry.startsWith(VENDOR_EXEMPT) ? [entry] : [];
  });
}

// 注释按等长空白抹掉：既不参与检查，也保留原始行号。
const maskComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));

/**
 * 把样式表拆成片段，并记住每段起始行号和结束它的分隔符：
 * `{` 结尾的片段是选择器，`;` 或 `}` 结尾的片段是一条声明。
 * 以 `--name:` 开头的声明是令牌定义，允许出现颜色字面量；其余属于组件规则。
 */
function declarations(text) {
  const segments = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char !== ';' && char !== '{' && char !== '}') continue;
    const chunk = text.slice(start, index);
    if (chunk.trim()) segments.push({ chunk, line: text.slice(0, start).split('\n').length, end: char });
    start = index + 1;
  }
  const tail = text.slice(start);
  if (tail.trim()) segments.push({ chunk: tail, line: text.slice(0, start).split('\n').length, end: ';' });
  return segments;
}

const violations = [];

// 1) 层叠入口：renderer/styles/ 下每个样式表都必须且只能被 main.tsx 导入一次。
const mainSource = maskComments(read(entryFile));
const importedStylesheets = [...mainSource.matchAll(/^\s*import\s+'([^']+\.css)';\s*$/gm)]
  .map((match) => path.resolve(path.dirname(entryFile), match[1]));
const globalStylesheets = [path.join(rendererRoot, 'styles.css'), ...cssFiles(stylesRoot)];
const importedSet = new Set(importedStylesheets);
for (const file of globalStylesheets) {
  if (!importedSet.has(file)) {
    violations.push(`${relative(file)} 没有被 main.tsx 导入（写了却不加载的样式表就是死样式）`);
  }
}
for (const file of importedStylesheets) {
  if (!globalStylesheets.includes(file)) {
    violations.push(`${relative(entryFile)} → ${relative(file)}（全局入口只允许导入 styles.css 与 renderer/styles/ 下的区域样式）`);
  }
}
const duplicates = importedStylesheets.filter((file, index) => importedStylesheets.indexOf(file) !== index);
for (const file of duplicates) {
  violations.push(`${relative(file)} 被重复导入（同一份层叠规则被排两次）`);
}
if (importedStylesheets[0] !== path.join(stylesRoot, 'tokens.css')) {
  violations.push(`${relative(entryFile)} → tokens.css 必须是第一个全局样式导入，色阶要先于消费它的规则落地`);
}

// 2) + 3) 逐文件检查基础层冻结与颜色字面量。
const checkedStylesheets = [
  path.join(rendererRoot, 'styles.css'),
  ...cssFiles(stylesRoot),
  ...cssFiles(path.join(rendererRoot, 'src')),
];
for (const file of checkedStylesheets) {
  const text = maskComments(read(file));
  const isBaseLayer = file === path.join(rendererRoot, 'styles.css');
  for (const { chunk, line, end } of declarations(text)) {
    if (end === '{') {
      if (!isBaseLayer) continue;
      const className = chunk.match(/\.([A-Za-z][\w-]*)/);
      if (className && !BASE_LAYER_CLASS_EXCEPTIONS.has(className[1])) {
        violations.push(`${relative(file)}:${line} 出现组件选择器 .${className[1]}（styles.css 只保留 reset、滚动条与焦点环）`);
      }
      continue;
    }
    const token = chunk.match(/^\s*(--[\w-]+)\s*:/);
    if (isBaseLayer && token) {
      violations.push(`${relative(file)}:${line} 定义了自定义属性（色阶属于 tokens.css）`);
    }
    if (token) continue;
    const literal = chunk.match(COLOR_LITERAL);
    if (literal) {
      violations.push(`${relative(file)}:${line} 写了颜色字面量 ${literal[0]}（必须引用 tokens 里的具名色）`);
    }
  }
}

// 4) 每个 var(--x) 都要有真实定义：CSS 里的 `--x:`，以及 TS/TSX 通过内联 style 或
//    setProperty 注入的变量名。注释里的名字不算定义，所以先抹注释。
const maskCodeComments = (text) => maskComments(text)
  .replace(/^([^\n]*?)\/\/[^\n]*/gm, (match, code) => `${code}${' '.repeat(match.length - code.length)}`);

const definedTokens = new Set();
const rendererSources = [];
(function collect(directory) {
  for (const name of readdirSync(directory)) {
    const entry = path.join(directory, name);
    if (statSync(entry).isDirectory()) {
      if (!entry.startsWith(VENDOR_EXEMPT)) collect(entry);
      continue;
    }
    if (/\.(css|ts|tsx)$/.test(name)) rendererSources.push(entry);
  }
})(rendererRoot);
for (const file of rendererSources) {
  const text = file.endsWith('.css') ? maskComments(read(file)) : maskCodeComments(read(file));
  // CSS 里是 `--x: value`；TS/TSX 里内联 style 的键写成 "--x": value。
  for (const match of text.matchAll(/(--[\w-]+)\s*:/g)) definedTokens.add(match[1]);
  for (const match of text.matchAll(/['"`](--[\w-]+)['"`]\s*[,:]/g)) definedTokens.add(match[1]);
  for (const match of text.matchAll(/setProperty\(\s*['"`]([^'"`]+)/g)) definedTokens.add(match[1]);
}
for (const file of checkedStylesheets) {
  const text = maskComments(read(file));
  for (const match of text.matchAll(/var\(\s*(--[\w-]+)/g)) {
    if (definedTokens.has(match[1])) continue;
    const line = text.slice(0, match.index).split('\n').length;
    violations.push(`${relative(file)}:${line} 引用了未定义的 ${match[1]}`);
  }
}

if (violations.length) {
  console.error('样式层违规：');
  for (const violation of violations) console.error(`  ${violation}`);
  console.error(`\n共 ${violations.length} 处。全局样式按区域分文件、顺序即层叠；styles.css 只留基础层；颜色只从 renderer/styles/tokens.css 的具名令牌出发。`);
  process.exit(1);
}
console.log(`样式层检查通过：${globalStylesheets.length} 个全局样式表，${definedTokens.size} 个具名色阶。`);
