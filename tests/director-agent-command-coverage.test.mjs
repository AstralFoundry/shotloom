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
  // 条目之间允许写注释：注释里出现 `xxx:` 不该被当成命令，反过来也不该让一条真实命令漏掉。
  const block = bridge.slice(start, bridge.indexOf('\nfunction editScenes')).replace(/^\s*\/\/.*$/gm, '');
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

test('导演台只在载入宿主文档之后才写回，未载入时拒绝 Agent 操作', () => {
  // 真实缺陷：会话消息没有送达时，导演台显示自带的默认场景；Agent 的编辑照常发出
  // project-changed，把节点里保存的整套场景替换成「默认场景 + 这次编辑」。
  const sessionHandler = bridge.slice(
    bridge.indexOf("message.type === 'storyai:director-desk-session'"),
    bridge.indexOf("message.type === 'storyai:director-desk-panorama'"),
  );
  assert.ok(sessionHandler.includes('loadProject(payload.project)'), '会话消息必须载入宿主文档');
  assert.ok(
    sessionHandler.indexOf('connected = true') > sessionHandler.indexOf('loadProject(payload.project)'),
    'connected 只能在 loadProject 成功之后置位，载入失败时不得写回',
  );
  const agent = bridge.slice(bridge.indexOf("message.type === 'storyai:director-desk-agent-request'"));
  assert.match(agent.slice(0, 900), /parent !== window && !connected/, '嵌入模式下尚未绑定宿主文档时必须拒绝 Agent 请求');
});

test('命令表分档：模型该用的命令保留，编辑器内部命令被隐藏并指向 batch', () => {
  const specs = [...bridge.matchAll(/^\s{4}([a-z][a-z0-9_]*): \{ kind: '(\w+)'([^}]*)/gm)]
    .map(m => ({ name: m[1], kind: m[2], tail: m[3] }));
  const hidden = specs.filter(spec => /agentHidden: true/.test(spec.tail));
  const visible = specs.filter(spec => !/agentHidden: true/.test(spec.tail));

  // 模型实际会用的核验与查询必须留在可见档，否则分档会把能力藏掉。
  for (const name of ['render_preview', 'render_preview_sheet', 'render_plan', 'compare_reference',
    'inspect_model', 'spatial_check', 'scene_list', 'scene_read', 'scene_summary', 'history_status',
    'select_entity', 'seek', 'undo', 'redo', 'add_asset', 'batch_edit', 'set_entity_path', 'set_campath',
    'apply_framing', 'apply_camera_preset', 'export_video_start', 'export_video_job', 'export_scene', 'import_scene']) {
    assert.ok(visible.some(spec => spec.name === name), `${name} 应当对模型可见`);
  }

  // 逐轴、选区依赖、逐步画路径这类命令必须隐藏：它们正是返工的来源。
  for (const name of ['set_position_axis', 'set_rotation_axis', 'set_scale_axis', 'set_height',
    'select_clip', 'select_path_point', 'start_path', 'add_path_point', 'finish_path', 'append_path_point',
    'set_clip_field', 'rename_entity', 'add_camera', 'set_camera_field', 'update_room']) {
    assert.ok(hidden.some(spec => spec.name === name), `${name} 应当被隐藏`);
  }

  // 隐藏的写命令必须告诉模型该改用什么，否则拒绝之后就无处可去。
  for (const spec of hidden.filter(spec => spec.kind === 'edit')) {
    assert.match(spec.tail, /prefer: '/, `${spec.name} 被隐藏但没有给出替代路径`);
  }
  assert.ok(hidden.length > 40 && visible.length > 30, `分档比例异常：隐藏 ${hidden.length}，可见 ${visible.length}`);
});

test('命令分发会拒绝隐藏命令并给出 batch 替代写法', () => {
  const dispatch = bridge.slice(bridge.indexOf("message.type === 'storyai:director-desk-agent-request'"));
  assert.match(dispatch, /if \(spec\?\.agentHidden\)/, '分发前必须检查 agentHidden');
  assert.match(dispatch, /spec\.prefer \? `改用 \$\{spec\.prefer\}/, '拒绝时要带上替代写法');
  assert.match(dispatch, /code: 'INVALID_PARAMS'/, '拒绝要有稳定错误码');
});

test('snapshot 默认只回 Agent 档，includeAll 才给全表', () => {
  assert.match(bridge, /const agentDescriptors = Object\.keys\(commands\)\s*\n?\s*\.filter\(name => !commandSpecs\[name\]\?\.agentHidden\)/,
    '需要有过滤后的 Agent 档');
  assert.match(bridge, /const table = all \? descriptors : agentDescriptors;/, 'snapshot 依据 includeAll 选择档位');
  assert.match(bridge, /hiddenCommands: all \? 0 : descriptors\.length - agentDescriptors\.length/, '要如实报告隐藏了多少条');
});

test('batch 支持 validateOnly 预检，且预检与真实提交走同一套规则', () => {
  const sessionSource = fs.readFileSync(path.join(root, 'vendor/shotloom-director-desk/src/state/editor-session.ts'), 'utf8');
  assert.match(bridge, /session\.applyBatch\(i\.edits as BatchEdit\[\], number\(i\.expectedRevision\), i\.validateOnly === true\)/, 'batch_edit 必须把 validateOnly 传下去');
  const apply = sessionSource.slice(sessionSource.indexOf('applyBatch(edits: BatchEdit[], expectedRevision: number, validateOnly = false)'));
  const precheck = apply.indexOf('if (validateOnly)');
  assert.ok(precheck > 0, 'applyBatch 需要有 validateOnly 分支');
  const branch = apply.slice(precheck, apply.indexOf('applyBatchEdits(draft, edits);\n        assertProject(draft);\n        let receipts', precheck));
  // 预检用同一个纯函数校验，才能保证报告的问题和真正提交时一致。
  assert.ok(branch.includes('applyBatchEdits(draft, edits)'), '预检必须在副本上跑同一套 applyBatchEdits');
  assert.ok(!branch.includes('this.change('), '预检绝不能进入写入事务');
  assert.ok(branch.includes('validatedOnly: true'), '预检回执要标明这是预检、不是提交');
});

test('catalog 默认只给分组概览，素材按 group／query 筛出', () => {
  const catalog = bridge.slice(
    bridge.indexOf("message.type === 'storyai:director-desk-catalog'") > 0
      ? "message.type === 'storyai:director-desk-catalog'"
      : "payload.operation === 'catalog'",
  );
  // 全量返回会把回执撑到近 30 KB；默认必须是分组概览 + 总数。
  assert.match(bridge, /const filtered = Boolean\(query \|\| group\)/, 'catalog 必须区分"是否筛选"');
  assert.match(bridge, /assetTotal: assetGroups\(\)\.reduce/, '默认回执要给素材总数');
  assert.match(bridge, /groups: assetGroups\(\)/, '默认回执要给分组概览');
  assert.ok(
    !/assets: searchAssets\('', '全部'\)/.test(bridge),
    '不能再无条件全量返回所有素材',
  );
  assert.match(bridge, /const matches = filtered \? searchAssets\(query, group \|\| '全部'\)/, '筛选要走 searchAssets 的 query/group');
  assert.match(bridge, /CATALOG_MATCH_LIMIT/, '筛选结果要有上限');

  const catalogSource = fs.readFileSync(path.join(root, 'vendor/shotloom-director-desk/src/core/asset-catalog.ts'), 'utf8');
  assert.match(catalogSource, /export function assetGroups\(\)/, '必须导出分组概览生成函数');
  assert.match(catalogSource, /examples: members\.slice\(0, 3\)/, '分组示例 id 让"有哪些墙"能直接接上话');
});
