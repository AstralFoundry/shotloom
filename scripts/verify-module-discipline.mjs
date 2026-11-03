#!/usr/bin/env node
// 分层依赖门禁：AGENTS.md 的分层约定只有在这里被机器检查才不会随时间漂移。
// 类型导入（import type）不产生运行时依赖，因此不参与检查。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '../renderer/src');
const directorVendorRoot = path.resolve(import.meta.dirname, '../vendor/storyai-3d-director-desk/src');

const LAYERS = {
  app: ['app', 'agent', 'services', 'store', 'domain', 'config', 'utils', 'i18n', 'assets'],
  agent: ['agent', 'services', 'store', 'domain', 'config', 'utils', 'i18n', 'assets'],
  services: ['services', 'agent', 'store', 'domain', 'config', 'utils', 'i18n', 'assets'],
  store: ['store', 'services', 'domain', 'config', 'utils', 'i18n', 'assets'],
  domain: ['domain', 'config', 'utils', 'i18n', 'assets'],
  config: ['config', 'utils', 'i18n', 'assets'],
  utils: ['utils', 'i18n', 'assets'],
  // 纯文案字典与插值函数，不依赖状态、服务或 UI，可供各层输出产品提示。
  i18n: ['i18n'],
  // 静态资产目录：只有 svg，不产生依赖，登记在此只为让目录清单完整。
  assets: ['assets'],
};

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);

// JS→TS 迁移完成后 tsconfig 的 include 只覆盖 .ts/.tsx：混进来的 .js 能构建、能运行，
// 却永远不会被 tsc 看过一眼，等于重新开一个没有类型的死角。这里把它挡在门禁，
// 让"源码全类型"成为契约而不是某次重构的临时状态。
const UNTYPED_SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs']);

// 分层表就是目录清单：未登记的顶层目录不会有任何规则检查它，于是变成新的杂物层。
// 源根目录只允许声明过的入口文件（main.tsx 是构建入口，env.d.ts 是没有归属模块的环境声明）。
const ROOT_SOURCE_ENTRIES = new Set(['main.tsx', 'env.d.ts']);

// Product authorization helpers stay behind tool definitions; Harness runtime is
// isolated in harness/host and must never be imported into renderer state stores.
const AGENT_INTERNAL_PREFIXES = ['agent/core/visibility', 'agent/core/toolIdentity'];
const AGENT_INTERNAL_EXCEPTIONS = new Set([]);

// 状态引擎按数据职责分两类，不再出现第三种：
// - 领域与持久状态：store/ 下的 domainReactivity（就地可变 + 合并通知）。
// - 界面状态：zustand，只在 app/ 的界面 store 里使用。
// store/notificationStore 是唯一登记例外：提示条必须能被数据层触发，所以它留在 store 层。
const ZUSTAND_ALLOWED_LAYERS = new Set(['app', 'vendor']);
const ZUSTAND_STORE_EXCEPTIONS = new Set(['store/notificationStore.ts']);

// AGENTS.md 把厂商协议连同提交/轮询交给 domain/provider/adapters，因此适配器必须能调用原生
// IPC 边界。这里只放行这两个传输模块，domain 仍然不能依赖 services 里的其它任何模块。
const TRANSPORT_BOUNDARY = new Set(['desktopApi', 'tauriApi']);
const TRANSPORT_ALLOWED_FROM = new Set(['domain']);

// vendored 3D 导演台保留上游源码，只能通过自己的 HTML 入口以 iframe 运行，产品侧唯一的
// 通道是那份私有 postMessage 协议。协议名或入口地址散落到界面代码里，等于每个消费者
// 各自维护一份上游契约，上游更新时不会有任何地方提醒；所以两者只允许出现在宿主适配层。
const DIRECTOR_DESK_HOST = 'app/adapters/directorDeskBridge.ts';
const DIRECTOR_DESK_CONTRACT = ['storyai:director-desk-', 'director-desk.html'];

function isTransportBoundary(source, targetPath) {
  if (!TRANSPORT_ALLOWED_FROM.has(source)) return false;
  const relative = path.relative(root, targetPath).replace(/\\/g, '/');
  return relative.startsWith('services/')
    && TRANSPORT_BOUNDARY.has(path.basename(relative).replace(/\.[a-z]+$/, ''));
}

function sources(directory) {
  return readdirSync(directory).flatMap((name) => {
    const entry = path.join(directory, name);
    if (statSync(entry).isDirectory()) return sources(entry);
    return SOURCE_EXTENSIONS.has(path.extname(name)) ? [entry] : [];
  });
}

function relativeToRoot(file) {
  return path.relative(root, file).replace(/\\/g, '/');
}

function isDirectorSource(file) {
  const relative = path.relative(directorVendorRoot, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function layerOf(file) {  const relative = path.relative(root, file);
  if (isDirectorSource(file)) return 'vendor';
  // 相对路径可以指向 node_modules 里的外部包（如 react-screenshots 的源码导入），
  // 那些文件不属于本项目的分层体系。
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.split(path.sep)[0];
}

function specifierFile(from, specifier) {
  const base = specifier.startsWith('@/')
    ? path.join(root, specifier.slice(2))
    : path.resolve(path.dirname(from), specifier);
  for (const name of ['', '.ts', '.tsx', '.js', '.jsx', '.mjs',
    `${path.sep}index.ts`, `${path.sep}index.tsx`, `${path.sep}index.js`, `${path.sep}index.mjs`]) {
    const candidate = base + name;
    try {
      if (!statSync(candidate).isDirectory()) return candidate;
    } catch {
      // 该候选路径不存在，继续尝试下一个后缀。
    }
  }
  return null;
}

// 解析 import 子句里落到本文件的局部绑定名（默认导入、命名空间、具名及其 as 别名）。
// 多行 `import {\n a,\n b as c\n} from '…'` 同样匹配：`[^}]*` 可以跨行。
function importedBindings(text) {
  const bindings = [];
  const clause = /(?:^|\n)\s*import\s+(?!type\s)(?:\s*(?:(\w+)|\*\s+as\s+(\w+)|\{([^}]*)\})?\s*from\s+)?['"]([^'"]+)['"]/g;
  for (const match of text.matchAll(clause)) {
    const [, defaultName, starName, named, specifier] = match;
    const names = [];
    if (defaultName) names.push(defaultName);
    if (starName) names.push(starName);
    for (const entry of (named || '').split(',')) {
      const piece = entry.trim();
      if (!piece || piece.startsWith('type ')) continue;
      const asName = piece.match(/\bas\s+(\w+)$/);
      names.push(asName ? asName[1] : piece);
    }
    bindings.push({ specifier: specifier.split('?')[0], names });
  }
  return bindings;
}

// Tarjan 强连通分量：环内的模块谁先求值只取决于入口顺序，浏览器与 SSR 并不相同。
function stronglyConnectedComponents(nodes, edges) {
  const index = new Map();
  const low = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];
  let counter = 0;

  const visit = (node) => {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of edges.get(node) || []) {
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node), low.get(next)));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node), index.get(next)));
      }
    }
    if (low.get(node) !== index.get(node)) return;
    const component = [];
    for (;;) {
      const member = stack.pop();
      onStack.delete(member);
      component.push(member);
      if (member === node) break;
    }
    components.push(component);
  };

  for (const node of nodes) if (!index.has(node)) visit(node);
  return components;
}

function importedSpecifiers(text) {
  const specifiers = [];
  for (const match of text.matchAll(
    /(?:^|\n)\s*import\s+(?!type\s)(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g,
  )) {
    specifiers.push({ specifier: match[1], typeOnly: false });
  }
  for (const match of text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]/g)) {
    specifiers.push({ specifier: match[1], typeOnly: false });
  }
  for (const match of text.matchAll(/(?:^|\n)\s*export\s+[^'"]*?\bfrom\s+['"]([^'"]+)['"]/g)) {
    specifiers.push({ specifier: match[1], typeOnly: false });
  }
  return specifiers;
}

// 内部说明符必须解析到真实文件：JS→TS 迁移后残留的 `./x.js` 在 TypeScript
// 的 Bundler 解析下能指向 x.ts，但 Vite 与 Tauri 运行时会直接 404。
function resolvesInternalSpecifier(from, specifier) {
  const [pathPart, query] = specifier.split('?');
  // ?raw / ?no-inline 是构建工具的资产导入，只确认磁盘上真有这个文件。
  if (query !== undefined) {
    const base = pathPart.startsWith('@/')
      ? path.join(root, pathPart.slice(2))
      : path.resolve(path.dirname(from), pathPart);
    try {
      return statSync(base).isFile();
    } catch {
      return false;
    }
  }
  return Boolean(specifierFile(from, pathPart));
}

const violations = [];
for (const name of readdirSync(root)) {
  const entry = path.join(root, name);
  if (statSync(entry).isDirectory()) {
    if (!LAYERS[name]) violations.push(`src/${name}/ 是未登记的顶层目录（分层表就是目录清单）`);
    continue;
  }
  if (!SOURCE_EXTENSIONS.has(path.extname(name)) || ROOT_SOURCE_ENTRIES.has(name)) continue;
  violations.push(`src/${name} 直接放在源根目录（只能属于某个分层目录）`);
}
const sourceFiles = [...sources(root), ...sources(directorVendorRoot)];
for (const file of sourceFiles) {
  if (!UNTYPED_SOURCE_EXTENSIONS.has(path.extname(file))) continue;
  violations.push(`${relativeToRoot(file)} 是无类型 JS（renderer/src 只允许 .ts/.tsx，tsc 不检查 JS 文件）`);
}
const texts = new Map(sourceFiles.map((file) => [file, readFileSync(file, 'utf8')]));
for (const file of sourceFiles) {
  const fromPath = relativeToRoot(file);
  if (isDirectorSource(file) || fromPath === DIRECTOR_DESK_HOST) continue;
  const text = texts.get(file);
  for (const token of DIRECTOR_DESK_CONTRACT) {
    if (!text.includes(token)) continue;
    violations.push(`${fromPath} 出现了 ${token}（vendored 导演台契约只允许写在 ${DIRECTOR_DESK_HOST}）`);
  }
}
for (const file of sourceFiles) {
  for (const { specifier } of importedSpecifiers(texts.get(file))) {
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) continue;
    if (resolvesInternalSpecifier(file, specifier)) continue;
    violations.push(`${relativeToRoot(file)} → ${specifier}（说明符没有对应的源文件）`);
  }
}
for (const file of sourceFiles) {
  const source = layerOf(file);
  const allowed = source === 'vendor' ? ['vendor', 'i18n'] : LAYERS[source];
  if (!allowed) continue;
  const text = texts.get(file);
  for (const { specifier } of importedSpecifiers(text)) {
    if (specifier === 'zustand' || specifier.startsWith('zustand/')) {
      const fromPath = relativeToRoot(file);
      if (!ZUSTAND_ALLOWED_LAYERS.has(source) && !ZUSTAND_STORE_EXCEPTIONS.has(fromPath)) {
        violations.push(`${fromPath} → ${specifier}（领域与数据层必须用 domainReactivity，界面状态才用 zustand）`);
      }
      continue;
    }
    let target = null;
    if (specifier.startsWith('@/')) {
      target = path.join(root, specifier.slice(2));
    } else if (specifier.startsWith('.')) {
      target = specifierFile(file, specifier) ?? path.resolve(path.dirname(file), specifier);
    }
    if (!target) continue;
    if (isTransportBoundary(source, target)) continue;
    const layer = layerOf(target);
    if (!layer || layer === source || layer === 'styles') continue;
    if (relativeToRoot(file).startsWith('app/store/')
      && relativeToRoot(target).replace(/\.[a-z]+$/, '') === 'store/domainReactivity') {
      violations.push(`${relativeToRoot(file)} → store/domainReactivity（界面 store 用 zustand，不得另起领域引擎）`);
      continue;
    }
    if (layer === 'agent' && source !== 'agent') {
      const targetPath = relativeToRoot(target).replace(/\.[a-z]+$/, '');
      const internal = AGENT_INTERNAL_PREFIXES.some((prefix) => targetPath.startsWith(prefix));
      if (internal) {
        const edge = `${relativeToRoot(file)} → ${targetPath}`;
        if (!AGENT_INTERNAL_EXCEPTIONS.has(edge)) {
          violations.push(`${edge}（Agent 引擎内部实现；界面必须消费声明入口）`);
        }
        continue;
      }
    }
    if (allowed.includes(layer)) continue;
    violations.push(`${relativeToRoot(file)} → ${layer} (${specifier})`);
  }
}

// 循环引用里的模块在求值期读取对方的绑定，等于赌入口顺序：浏览器、SSR 与生产构建的
// 顺序互不相同，赌输的表现是 `Cannot access 'x' before initialization` 白屏，
// 而单测各自从别的入口进入模块图，看不见它。类型层因此只能在调用时读取。
const importEdges = new Map();
const importsByFile = new Map();
for (const file of sourceFiles) {
  const targets = new Set();
  const bindings = [];
  for (const { specifier, names } of importedBindings(texts.get(file))) {
    const target = specifierFile(file, specifier);
    if (!target || !texts.has(target)) continue;
    targets.add(target);
    if (names.length) bindings.push({ target, names });
  }
  importEdges.set(file, targets);
  importsByFile.set(file, bindings);
}

const TOP_LEVEL_DECLARATION = /^(?:export\s+)?(?:const|let|var)\s+[^=;]*=/;
const TOP_LEVEL_STATEMENT = /^(?!export\s+default\b)[A-Za-z_$]/;
for (const component of stronglyConnectedComponents(sourceFiles, importEdges)) {
  if (component.length < 2) continue;
  const members = new Set(component);
  for (const file of component) {
    const cyclicNames = new Set(
      importsByFile.get(file)
        .filter((entry) => members.has(entry.target))
        .flatMap((entry) => entry.names),
    );
    if (!cyclicNames.size) continue;
    for (const line of texts.get(file).split('\n')) {
      // 只看第 0 列：函数体与回调里的读取发生在所有模块求值之后，是安全的。
      if (!line.trim() || /^\s/.test(line)) continue;
      if (/^(?:import|\/\/|\/\*|\*)/.test(line)) continue;
      if (/^(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|enum)\b/.test(line)) continue;
      if (!TOP_LEVEL_DECLARATION.test(line) && !TOP_LEVEL_STATEMENT.test(line)) continue;
      const name = [...cyclicNames].find((candidate) => new RegExp(`\\b${candidate}\\b`).test(line));
      if (!name) continue;
      violations.push(
        `${relativeToRoot(file)} 在模块作用域读取了环内绑定 ${name}（${component.length} 个模块互相引用；求值顺序只取决于入口，绑定可能还在 TDZ）`,
      );
    }
  }
}

if (violations.length) {
  console.error('模块分层违规：');
  for (const violation of violations) console.error(`  ${violation}`);
  console.error(`\n共 ${violations.length} 处。低层模块不得依赖高层模块，Agent 引擎内部实现只能由声明入口暴露给界面；把共享数据移入被依赖层。新增顶层目录必须在 LAYERS 里登记它拥有的职责。互相引用的模块只能在调用时读取对方的绑定：求值顺序取决于入口，浏览器与 SSR 不同，读早了就是白屏。`);
  process.exit(1);
}
console.log(`模块分层检查通过：${sourceFiles.length} 个源文件。`);
