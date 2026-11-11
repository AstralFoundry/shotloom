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

test('导演台助手栏可拉伸，整页工作区和节点详情都能收缩', () => {
  const pane = fs.readFileSync(path.join(root, 'renderer/src/app/agent-chat/DirectorAgentPane.tsx'), 'utf8');
  const view = fs.readFileSync(path.join(root, 'renderer/src/app/views/CreationView.tsx'), 'utf8');
  const node = fs.readFileSync(path.join(root, 'renderer/src/app/canvas/ThreeDDirectorNode.tsx'), 'utf8');

  // Width must be adjustable and remembered; a fixed column was the original complaint.
  assert.match(pane, /role="separator"/, '助手栏缺少拖动分隔条');
  assert.match(pane, /localStorage\.setItem\(WIDTH_KEY/, '助手栏宽度必须持久化');
  assert.match(pane, /ArrowLeft/, '分隔条必须支持键盘调整');

  // Both entry points use the chat header's collapse button; the desk toolbar restores it.
  assert.match(pane, /onClose=\{\(\) => onCollapsedChange\(true\)\}/, '助手栏标题应能收起 Agent');
  assert.match(view, /className="director-workspace-agent" collapsed=\{agentCollapsed\}/, '整页工作区应传入收缩状态');
  assert.match(node, /className="director-detail-agent"[^>]*collapsed=\{agentCollapsed\}/, '节点详情应传入收缩状态');
});

test('导演台退出入口在顶部工具栏，详情底部没有额外退出按钮', () => {
  const topBar = fs.readFileSync(path.join(root, 'vendor/shotloom-director-desk/src/features/top-bar/top-bar.tsx'), 'utf8');
  const node = fs.readFileSync(path.join(root, 'renderer/src/app/canvas/ThreeDDirectorNode.tsx'), 'utf8');
  const workspace = fs.readFileSync(path.join(root, 'renderer/src/app/views/DirectorWorkspace.tsx'), 'utf8');
  const view = fs.readFileSync(path.join(root, 'renderer/src/app/views/CreationView.tsx'), 'utf8');
  const pane = fs.readFileSync(path.join(root, 'renderer/src/app/agent-chat/DirectorAgentPane.tsx'), 'utf8');
  const bridgeAdapter = fs.readFileSync(path.join(root, 'renderer/src/app/adapters/directorDeskBridge.ts'), 'utf8');
  assert.match(topBar, /onClick=\{requestHostClose\}/, '顶部工具栏应提供返回画布入口');
  assert.match(topBar, /onClick=\{requestHostAgentOpen\}/, '顶部工具栏应提供 Agent 恢复入口');
  assert.match(bridgeAdapter, /messageType\.openAgent.*onOpenAgent/, '顶部工具栏的消息应传到宿主 Agent 面板');
  assert.doesNotMatch(topBar, /topbar__brand/, '顶部不应显示导演台与未命名场景标识');
  assert.doesNotMatch(pane, /director-agent-reopen/, '收起的 Agent 不应悬浮在属性面板标题上');
  assert.doesNotMatch(node, /director-detail-close/, '详情底部不应保留退出按钮');
  assert.doesNotMatch(view, /director-workspace-back/, '整页工作区不应保留底部退出按钮');
  assert.match(workspace, /onExitInteraction: \(\) => onExit\?\.\(\)/, '整页退出消息必须返回画布');
});

test('助手栏分隔条的样式在全局层，两个调用方都能加载到', () => {
  // 真实缺陷：.director-agent-resize 只写在画布节点的局部样式表里，
  // 而整页工作区（CreationView）从不 import 那份文件。DOM 在、样式不在，
  // 分隔条宽度为 auto、cursor 不生效，用户看到的就是"拉不动"。
  const global = fs.readFileSync(path.join(root, 'renderer/styles/creation-view.css'), 'utf8');
  const local = fs.readFileSync(path.join(root, 'renderer/src/app/canvas/ThreeDDirectorNode.css'), 'utf8');

  assert.match(global, /\.director-agent-resize\s*\{/, '分隔条样式必须在全局样式层');
  assert.match(global, /cursor:\s*col-resize/, '分隔条必须声明 col-resize');
  assert.ok(!/\.director-agent-resize\s*\{/.test(local), '不应在局部样式表重复定义，否则两处会漂移');

  // 面板 overflow: hidden 会裁掉负偏移，命中区必须完全落在面板内。
  const rule = global.slice(global.indexOf('.director-agent-resize {'), global.indexOf('}', global.indexOf('.director-agent-resize {')));
  assert.match(rule, /left:\s*0;/, '分隔条不得用负偏移，否则命中区被 overflow 裁掉');
});

test('助手栏宽度按面板父级计算，不能拿分隔条的父级当可用空间', () => {
  // 真实缺陷：resize() 用 container.parentElement 量可用宽度，而 container 是分隔条本身，
  // 它的 parentElement 就是助手栏自己。于是 available = 宽度 - 480 恒为负，
  // 每次拖动都被钳到最小值 280，表现就是"拖了没反应"。
  const pane = fs.readFileSync(path.join(root, 'renderer/src/app/agent-chat/DirectorAgentPane.tsx'), 'utf8');

  assert.ok(!/container\?\.parentElement/.test(pane),
    '不能从分隔条取 parentElement 量可用宽度');
  assert.match(pane, /asideRef/, '必须通过 ref 引用助手栏自身');
  assert.match(pane, /asideRef\.current\?\.parentElement/, '可用宽度必须取自助手栏的父级');
});
