import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 导演台的能力与它对 Agent 暴露的命令表必须同步。
 *
 * 这曾经真实发生过一次：空间检查、关键帧记录、吸附等能力已经做进编辑器和 session，
 * 却没有登记进 commandSpecs，Agent 既看不见也调不到。当时没有任何测试失败——编辑器照常工作，
 * 只有 Agent 是瞎的。这里的断言是静态的，不需要浏览器，专门拦住"加了能力但没暴露"。
 */

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const bridge = fs.readFileSync(path.join(root, 'vendor/shotloom-director-desk/src/app/host-bridge.ts'), 'utf8');
const session = fs.readFileSync(path.join(root, 'vendor/shotloom-director-desk/src/state/editor-session.ts'), 'utf8');

const implementations = (() => {
  const start = bridge.indexOf('const commands: Record<string, (input: Input) => unknown> = {');
  const block = bridge.slice(start, bridge.indexOf('\nfunction editScenes'));
  return [...block.matchAll(/(?:^|[{,]\s*)([a-z][a-z0-9_]*):\s*(?:\(|i\s*=>|function)/gm)].map(m => m[1]);
})();

const specs = [...bridge.matchAll(/^\s*([a-z][a-z0-9_]*):\s*\{ kind: '([a-z]+)'/gm)].map(m => ({
  name: m[1],
  kind: m[2],
}));

test('导演台命令表：契约与实现一一对应，且 kind 只取三类', () => {
  assert.deepEqual(
    [...new Set(specs.map(s => s.name))].sort(),
    [...new Set(implementations)].sort(),
    'commandSpecs 与 commands 必须一一对应：少一条契约会让 snapshot 在运行时抛错',
  );
  assert.deepEqual(
    specs.filter(s => !['view', 'edit', 'export'].includes(s.kind)),
    [],
    'kind 只能是 view/edit/export，宿主据此决定是否收审批',
  );
});

test('编辑器里新增的能力不会悄悄对 Agent 隐身', () => {
  // 每一项都是编辑器界面能触达的 session 方法；Agent 一旦也需要，命令表必须带上它。
  // 永久只属于界面的能力，必须显式登记在这里，而不是靠"漏了没人发现"。
  const uiOnly = new Set([
    'attachEngine', 'detachEngine', 'frame',
    'beginTimelineDrag', 'updateTimelineDrag', 'endTimelineDrag', 'cancelTimelineDrag',
    'restoreRecovery', 'setBusy', 'change', 'current', 'jointState', 'requestBackdropRemoval',
  ]);
  const methods = [...session.matchAll(/^ {4}(?!private |constructor)(?:async )?([a-zA-Z][a-zA-Z0-9]*)\(/gm)].map(m => m[1]);
  const referenced = new Set([...bridge.matchAll(/session\.([a-zA-Z0-9]+)\(/g)].map(m => m[1]));
  const missing = [...new Set(methods)].filter(name => !referenced.has(name) && !uiOnly.has(name));
  assert.deepEqual(
    missing,
    [],
    `这些 session 能力既没有暴露给 Agent，也没有登记为纯界面能力：${missing.join(', ')}`,
  );
});

test('封闭枚举与 patch 字段在 catalog 中可发现', () => {
  for (const key of ['framings', 'entityOptions', 'previewQualities', 'labelModes', 'snapSteps', 'patchFields']) {
    assert.ok(bridge.includes(`${key}:`), `catalog 缺少 ${key}，对应命令只能靠猜参数`);
  }
  assert.ok(implementations.includes('render_preview'), '缺少把画面交回模型的命令');
  assert.ok(implementations.includes('spatial_check'), '空间检查必须能被 Agent 调用');
});

test('iframe 启动时会装配宿主桥，否则所有命令都会超时', () => {
  // 这同样真实发生过一次：给 vendor 同步上游源码时，main.tsx 被整体覆盖，
  // initializeHostBridge() 的调用消失。界面照常渲染、场景照常加载，只有 postMessage
  // 没有接收方，Agent 每次调用都等到 20 秒超时后报"导演台未响应"。
  // 界面上看不出任何异常，所以只能在这里静态守住。
  const main = fs.readFileSync(path.join(root, 'vendor/shotloom-director-desk/src/app/main.tsx'), 'utf8');
  assert.match(main, /import\s*{[^}]*initializeHostBridge[^}]*}\s*from\s*'\.\/host-bridge\.ts'/,
    'main.tsx 必须导入 initializeHostBridge');
  assert.match(main, /^\s*initializeHostBridge\(\);/m,
    'main.tsx 必须实际调用 initializeHostBridge()，只 import 不调用等于没接上');
});
