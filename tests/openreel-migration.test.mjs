import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource } from './helpers/sourceContract.mjs';
import { REFERENCE_I18N } from '../vendor/openreel/apps/web/src/shotloom-i18n-data.ts';
import { SHOTLOOM_I18N_EXTRA } from '../vendor/openreel/apps/web/src/shotloom-i18n-extra.ts';
import { SHOTLOOM_I18N_EFFECTS } from '../vendor/openreel/apps/web/src/shotloom-i18n-effects.ts';
import { ActionHistory } from '../vendor/openreel/packages/core/src/actions/action-history.ts';

const read = (path) => readSource(path);

test('WebView 重建能恢复同一组撤销和重做动作', () => {
  const history = new ActionHistory();
  const remove = { id: 'a', type: 'clip/remove', timestamp: 1, params: { clipId: 'c' } };
  const restore = { id: 'b', type: 'clip/add', timestamp: 1, params: { clipId: 'c' } };
  history.push(remove, restore);
  const resumed = new ActionHistory();
  resumed.restoreEntries(history.getHistoryEntries(), history.getRedoEntries());
  assert.deepEqual(resumed.undo(), restore);
  assert.equal(resumed.canRedo(), true);
  const reloaded = new ActionHistory();
  reloaded.restoreEntries(resumed.getHistoryEntries(), resumed.getRedoEntries());
  assert.deepEqual(reloaded.redo(), remove);
  assert.equal(reloaded.canUndo(), true);
  assert.equal(history.canUndo(), true, '恢复的栈不能共享可变数组');
});

test('旧 OpenVideo 运行时、依赖与旧剪辑台源码已移除', () => {
  const exists = (path) => {
    try {
      read(path);
      return true;
    } catch {
      return false;
    }
  };
  for (const path of [
    'renderer/src/services/openVideoRuntime.ts',
    'renderer/src/app/editor/useVideoEditorRuntime.ts',
    'renderer/src/app/editor/VideoEditorMonitor.tsx',
    'renderer/src/app/editor/VideoEditorTimeline.tsx',
  ]) {
    assert.equal(exists(path), false, `${path} 不应存在`);
  }
  const packageJson = read('package.json');
  assert.doesNotMatch(packageJson, /@openvideo/);
});

test('剪辑台通过 ShadowRoot 本地运行时直接调用，不再依赖 iframe 协议', () => {
  const workspace = read('renderer/src/app/editor/VideoEditorWorkspace.tsx');
  const host = read('renderer/src/app/editor/openReel/ClipStudioRuntimeHost.tsx');
  const bridge = read('renderer/src/app/editor/openReel/useOpenReelBridge.ts');
  assert.match(workspace, /<ClipStudioRuntimeHost/);
  assert.doesNotMatch(workspace, /<iframe|iframeRef|frameLoaded/);
  assert.match(host, /attachShadow/);
  assert.match(host, /module\.createRuntime/);
  assert.match(host, /runtime\?\.dispose\(\)/);
  assert.doesNotMatch(bridge, /postMessage|MessageEvent|iframeRef/);
});

test('宿主会话把原生动作、媒体导入与导出接到桥接层', () => {
  const hook = read('renderer/src/app/editor/openReel/useOpenReelBridge.ts');
  for (const contract of ['executeActions', 'importAsset', 'refreshState', 'native:', 'actionCatalog']) {
    assert.match(hook, new RegExp(contract));
  }
  assert.match(hook, /registerActiveVideoEditor/);
  assert.match(hook, /stateRef\.current\?\.native/);
});

test('Agent 剪辑工具通过动作目录执行，不再保留批量模型编辑入口', () => {
  const tools = read('renderer/src/agent/tools/videoEditorTools.ts');
  assert.match(tools, /video_project_actions/);
  assert.match(tools, /video_project_action_catalog/);
  assert.match(tools, /video_project_import_media/);
  assert.match(tools, /catalog\.denylist/);
  assert.match(tools, /new Set\(catalog\.actions/);
  assert.doesNotMatch(tools, /video_project_edit/);
  assert.doesNotMatch(tools, /applyVideoEditorAgentBatch/);
});

test('原生工程快照存放在项目目录，不进入节点 JSON 摘要', () => {
  const store = read('renderer/src/services/clipSnapshotStore.ts');
  const hook = read('renderer/src/app/editor/openReel/useOpenReelBridge.ts');
  assert.match(store, /project\.sqlite#editor/);
  assert.match(store, /readNativeSnapshot/);
  assert.match(store, /writeNativeSnapshot/);
  assert.match(hook, /openReelSnapshot/);
  assert.match(hook, /writerRef\.current\?\.schedule/);
});

test('OpenReel 内置 AI 入口在 shotloom 模式隐藏，避免双 Agent', () => {
  const rail = read('vendor/openreel/apps/web/src/components/editor/EditorActionRail.tsx');
  const assets = read('vendor/openreel/apps/web/src/components/editor/AssetsPanel.tsx');
  assert.match(rail, /isShotloomMode/);
  assert.match(assets, /isShotloomMode/);
  const hostHiddenTabs = assets.match(/const HOST_HIDDEN_TABS[\s\S]*?\]/)?.[0] ?? '';
  for (const tab of ['"ai"', '"recipes"', '"templates"']) {
    assert.ok(hostHiddenTabs.includes(tab), `宿主模式必须隐藏素材标签 ${tab}`);
  }
  const recovery = read('vendor/openreel/apps/web/src/hooks/useProjectRecovery.ts');
  assert.match(recovery, /if \(isShotloomMode\)/);
});

test('宿主模式没有编辑器工具栏这一列，独有的四个入口落在时间线工具条', () => {
  const iface = read('vendor/openreel/apps/web/src/components/editor/EditorInterface.tsx');
  assert.match(iface, /!isShotloomMode[\s\S]{0,200}editor-rail/);
  const timeline = read('vendor/openreel/apps/web/src/components/editor/Timeline.tsx');
  assert.match(timeline, /openModal\("search"\)/);
  assert.match(timeline, /openModal\("history"\)/);
  assert.match(timeline, /toggleKeyframeEditor/);
  assert.match(timeline, /togglePanel\("audioMixer"\)/);
  // 工具栏弹层必须留在被 CSS 收起的 header 之外，否则宿主模式点了没有反应。
  const toolbar = read('vendor/openreel/apps/web/src/components/editor/Toolbar.tsx');
  assert.ok(
    toolbar.indexOf('</header>') < toolbar.indexOf('activeModal === "history"'),
    '操作历史弹层仍在 [data-openreel-toolbar] 内部，宿主模式会被整条隐藏',
  );
});

test('打开剪辑助手不能把剪辑台压成紧凑布局：断点归属剪辑容器宽度', () => {
  // 剪辑台使用会话容器尺寸，侧栏不能把完整工作区切到紧凑版。
  // 参考在同一宽度下依然保留 [素材 | 播放器 | 时间线] 完整桌面栅格，
  // 所以宿主模式必须彻底退出紧凑版，而不是再调阈值。
  const hook = read('vendor/openreel/apps/web/src/hooks/useCompactEditor.ts');
  assert.match(hook, /if \(isShotloomMode\) return false/);
});

test('剪辑助手列宽可以左右拖动，拖动期间剪辑台不吃指针', () => {
  // 调整侧栏时禁用剪辑内容命中，避免触发媒体或时间线拖拽。
  const workspace = read('renderer/src/app/editor/VideoEditorWorkspace.tsx');
  assert.match(workspace, /className="ov-openreel-agent-divider"/);
  assert.match(workspace, /role="separator"[\s\S]{0,400}aria-orientation="vertical"/);
  assert.match(workspace, /onPointerDown=\{startAgentResize\}/);
  assert.match(workspace, /onKeyDown=\{resizeAgentWithKeyboard\}/);
  assert.match(workspace, /localStorage\.setItem\(AGENT_WIDTH_STORAGE_KEY/);
  assert.match(workspace, /width=\{agentWidth\}/);

  const css = read('renderer/src/app/editor/OpenReelWorkspace.css');
  assert.match(css, /\.ov-openreel-agent-divider \{[^}]*cursor: col-resize/);
  assert.match(css, /\.ov-openreel-stage\[data-resizing\] \.clip-studio-runtime-host \{\s*pointer-events: none;/);
  // 列宽由拖动状态给出，CSS 再钉一个 max-width 会把拖动卡在中间。
  assert.doesNotMatch(css, /\.ov-openreel-agent \{[^}]*max-width:/);
});

test('参考实现没有的控件不得自己加：播放器头部、视频轨独奏键、素材排序键', () => {
  const preview = read('vendor/openreel/apps/web/src/components/editor/Preview.tsx');
  const header = preview.match(/Panel bar header[\s\S]*?\n        <\/div>/)?.[0] ?? '';
  assert.ok(header.length > 0, '找不到播放器列头部');
  assert.doesNotMatch(header, /Live preview|rounded-full bg-accent/, '参考实现的头部右侧没有常驻指示点');

  const trackHeader = read('vendor/openreel/apps/web/src/components/editor/timeline/TrackHeader.tsx');
  assert.match(trackHeader, /isAudio && !isVisual[\s\S]{0,300}aria-label=\{track\.solo/, '独奏键必须只属于纯音频轨');
  // 视频轨被独奏后必须还能取消，否则其他轨会停在 effectivelyMuted 暗态。
  assert.match(trackHeader, /label: editorMessage\("editor\.timeline\.track\.clearSoloMenu"\)[\s\S]{0,160}onClick: \(\) => soloTrack\(track\.id, false\)/);

  // 参考素材行的这一列只有搜索框 + 三档视图，`assets.*` 词典里没有任何排序键。
  const assets = read('vendor/openreel/apps/web/src/components/editor/AssetsPanel.tsx');
  assert.match(
    assets,
    /!isShotloomMode && \(\s*<button[\s\S]{0,200}aria-label=\{editorMessage\("editor\.assets\.sort"\)\}/,
    '排序键是上游自带能力，参考没有，宿主模式必须收起',
  );
});

test('素材行与胶片带用参考实测几何，不沿用上游默认', () => {
  // 参考截图实测：媒体行 48px 高、图块 48×32（3:2）、元信息 11px；
  // 上游原来的 46×40 图块把行撑到 58px，整列比参考松一档。
  const assets = read('vendor/openreel/apps/web/src/components/editor/AssetsPanel.tsx');
  assert.match(assets, /w-\[48px\] h-\[32px\] rounded-\[8px\]/, '列表行图块必须是 48×32');
  assert.match(assets, /text-\[11px\] leading-\[14px\] text-fg-3/, '元信息行 11px');
  assert.match(assets, /flex h-\[50px\][^"]*border-dashed/, '"添加媒体"行与列表行同高');
  assert.match(assets, /grid h-\[32px\] w-\[48px\]/, '"添加媒体"图块与列表行共用同一尺寸');

  // 参考的 156px 片段铺 3 格胶片（≈52px 一格）；上游的 /60 只铺 2 格。
  const clip = read('vendor/openreel/apps/web/src/components/editor/timeline/ClipComponent.tsx');
  assert.match(clip, /Math\.floor\(width \/ 52\)/, '胶片格间距按参考取 52px');
});

test('中文词典覆盖参考词典、效果转场与宿主补漏', () => {
  assert.ok(Object.keys(REFERENCE_I18N).length > 700);
  assert.equal(REFERENCE_I18N['Player'], '播放器');
  assert.equal(SHOTLOOM_I18N_EFFECTS['Golden Hour'], '黄金时刻');
  assert.equal(SHOTLOOM_I18N_EFFECTS['Crossfade'], '交叉淡化');
  assert.equal(SHOTLOOM_I18N_EXTRA['Import'], '导入');
  assert.equal(SHOTLOOM_I18N_EXTRA['Project Media'], '项目素材');
  // 词条措辞以参考项目自己的 zh 词典为准，不要自创一套同义词。
  for (const [en, zh] of [
    ['Video Track', '视频轨道'],
    ['Chroma Key', '色键抠像'],
    ['Fade through black', '通过黑色淡化过渡'],
    ['Slide Up', '向上滑入'],
    ['Codec', '编码器'],
  ]) {
    const mine = SHOTLOOM_I18N_EXTRA[en] ?? SHOTLOOM_I18N_EFFECTS[en] ?? REFERENCE_I18N[en];
    assert.equal(mine, zh, `"${en}" 必须与参考词典同词`);
  }
  // 参考对同一个英文词在不同面板给了两个中文（时间线 Split=分割 / 文字动画 Split=分裂，
  // 预设 Subtitle=副标题 / 字幕面板 Subtitle=字幕）。扁平精确匹配词典只能取一个，
  // 这里固定取界面上更显眼的那个，改动必须是有意的。
  assert.equal(REFERENCE_I18N['Split'], '分割');
  assert.equal(REFERENCE_I18N['Subtitle'], '副标题');
  const translator = read('vendor/openreel/apps/web/src/shotloom-i18n.ts');
  assert.match(translator, /MutationObserver/);
  assert.match(translator, /translateUiText/);
  assert.match(translator, /__shotloomI18nAudit/);
  assert.match(translator, /contenteditable/);
});
