import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { readSource } from './helpers/sourceContract.mjs';

const repoRoot = new URL('..', import.meta.url).pathname;
const read = (path) => readSource(path);

test('分层门禁把 Agent 引擎内部实现挡在声明入口之后', () => {
  const script = read('scripts/verify-module-discipline.mjs');
  assert.match(script, /'agent\/core\/visibility'/);
  execFileSync(process.execPath, ['scripts/verify-module-discipline.mjs'], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
});

test('状态引擎按职责分流且例外必须登记', () => {
  const script = read('scripts/verify-module-discipline.mjs');
  assert.ok(script.includes("ZUSTAND_ALLOWED_LAYERS = new Set(['app', 'vendor'])"));
  assert.ok(script.includes("ZUSTAND_STORE_EXCEPTIONS = new Set(['store/notificationStore.ts'])"));
  assert.ok(script.includes("=== 'store/domainReactivity'"));
  execFileSync(process.execPath, ['scripts/verify-module-discipline.mjs'], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
  // 领域 store 不得改用界面引擎；唯一登记例外是提示条。
  const zustandStores = readdirSync(new URL('../renderer/src/store', import.meta.url))
    .filter((name) => name.endsWith('.ts') && /from 'zustand/.test(read(`renderer/src/store/${name}`)));
  assert.deepEqual(zustandStores, ['notificationStore.ts']);
  // 界面 store 不得另起领域引擎。
  const uiStores = readdirSync(new URL('../renderer/src/app/store', import.meta.url))
    .filter((name) => name.endsWith('.ts'));
  assert.deepEqual(uiStores.filter((name) =>
    /domainReactivity/.test(read(`renderer/src/app/store/${name}`))), []);
});

test('vendored 导演台的契约只属于宿主适配层', () => {
  const script = read('scripts/verify-module-discipline.mjs');
  // 产品层不再允许 import vendor：第三方源码只能经自己的 HTML 入口以 iframe 运行。
  assert.doesNotMatch(script, /^ {2}app: \[.*'vendor'.*\],/m);
  assert.ok(script.includes("source === 'vendor' ? ['vendor', 'i18n'] : LAYERS[source]"));
  // 私有协议名与入口地址只允许出现在一个产品文件里，否则上游改协议时不会有地方提醒。
  assert.match(script, /DIRECTOR_DESK_HOST = 'app\/adapters\/directorDeskBridge\.ts'/);
  assert.match(script, /'storyai:director-desk-'/);
  assert.match(script, /'director-desk-app\/index\.html'/);
  assert.match(script, /vendored 导演台契约只允许写在/);
  execFileSync(process.execPath, ['scripts/verify-module-discipline.mjs'], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
  const bridge = read('renderer/src/app/adapters/directorDeskBridge.ts');
  assert.ok(bridge.includes('storyai:director-desk-session'));
  assert.match(read('renderer/src/app/canvas/ThreeDDirectorNode.tsx'), /from "\.\.\/adapters\/directorDeskBridge"/);
});

test('目录清单由分层表登记，不再有按语法形态分装的杂物层', () => {
  const script = read('scripts/verify-module-discipline.mjs');
  assert.match(script, /是未登记的顶层目录/);
  assert.match(script, /直接放在源根目录/);
  assert.match(script, /ROOT_SOURCE_ENTRIES = new Set\(\['main\.tsx', 'env\.d\.ts'\]\)/);
  assert.doesNotMatch(script, /'composables'/);
  execFileSync(process.execPath, ['scripts/verify-module-discipline.mjs'], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
  const topEntries = readdirSync(new URL('../renderer/src', import.meta.url), { withFileTypes: true });
  assert.deepEqual(topEntries.filter((entry) => entry.isDirectory() && ['composables', 'types'].includes(entry.name)), []);
  // 环境声明集中在一份文件里。
  assert.match(read('renderer/src/env.d.ts'), /declare module "\*\.module\.css"/);
  // 关闭确认属于应用生命周期，并且不再是伪装成 Hook 的注册函数。
  const guard = read('renderer/src/app/windowCloseGuard.ts');
  assert.match(guard, /export function registerWindowCloseGuard\(\)/);
  assert.doesNotMatch(guard, /export function (useWindowClose|markProjectCleanForClose|hasUnsavedProjectChanges)/);
  assert.match(read('renderer/src/app/ReactWorkbench.tsx'), /disposeClose = registerWindowCloseGuard\(\)/);
});

test('内部 import 说明符必须解析到真实源文件', () => {  const script = read('scripts/verify-module-discipline.mjs');
  // JS→TS 迁移后残留的 `./x.js` 说明符能被 tsc 解析，却会在 Vite/Tauri 运行时 404。
  assert.match(script, /function resolvesInternalSpecifier/);
  assert.match(script, /说明符没有对应的源文件/);
  // 构建工具的资产导入（?raw、?no-inline）只按磁盘文件确认。
  assert.match(script, /specifier\.split\('\?'\)/);
  execFileSync(process.execPath, ['scripts/verify-module-discipline.mjs'], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
});

test('渲染进程源码只允许有类型模块，tsc 不再接受无类型 JS', () => {
  const script = read('scripts/verify-module-discipline.mjs');
  assert.match(script, /UNTYPED_SOURCE_EXTENSIONS = new Set\(\['\.js', '\.jsx', '\.mjs'\]\)/);
  assert.match(script, /是无类型 JS/);
  // tsconfig 的 include 只覆盖 ts/tsx：allowJs 打开时混进来的 .js 能构建却永远不会被检查。
  assert.match(read('tsconfig.json'), /"allowJs": false/);
  assert.doesNotMatch(read('tsconfig.json'), /"checkJs"/);
  execFileSync(process.execPath, ['scripts/verify-module-discipline.mjs'], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
  const untyped = readdirSync(new URL('../renderer/src', import.meta.url), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(js|jsx|mjs)$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name).replace(repoRoot, ''));
  assert.deepEqual(untyped, []);
});

test('互相引用的模块只能在调用时读取对方的绑定', () => {
  const script = read('scripts/verify-module-discipline.mjs');
  assert.match(script, /function stronglyConnectedComponents/);
  assert.match(script, /function importedBindings/);
  assert.match(script, /在模块作用域读取了环内绑定/);
  execFileSync(process.execPath, ['scripts/verify-module-discipline.mjs'], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
  // 环上的两个存储直接用活绑定，不快照一份带 cast 的副本：快照会在入口顺序不利时抛
  // `Cannot access '…' before initialization`，表现是界面白屏，而单测从别的入口进来看不见。
  for (const name of ['nodeStore.ts', 'canvasHistoryStore.ts']) {
    const source = read(`renderer/src/store/${name}`);
    assert.match(source, /import \{ store, touchProject \} from '@\/store\/projectStore'/);
    assert.doesNotMatch(source, /const store = /);
  }
});


