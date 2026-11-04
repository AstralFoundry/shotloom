/**
 * 剪辑台、文本编辑器与 3D 导演台共用 section.content 里的一个挂载点。
 * 这里固定住三件事：挂载点只有一处、浮层定位相对内容区、层级不再靠应用级 z-index 逃逸。
 */
import assert from 'node:assert/strict';

import test from 'node:test';
import { readSource } from './helpers/sourceContract.mjs';

const read = (relative) => readSource(relative);

/** 取一条不含嵌套的 CSS 规则原文，避免懒匹配跨规则。 */
const rule = (styles, selector) => styles.match(new RegExp(`^${selector} \\{[^}]*\\}`, 'm'))?.[0] || '';

const shell = read('../renderer/src/app/AppShell.tsx');
const store = read('../renderer/src/app/layout/workbenchSurface.ts');
const shellStyles = read('../renderer/styles/app-shell.css');
const editorSource = read('../renderer/src/app/editor/VideoEditorWorkspace.tsx');
const editorLayout = read('../renderer/src/app/editor/OpenReelWorkspace.css');
const viewerSource = read('../renderer/src/app/components/MediaViewer.tsx');
const viewerStyles = read('../renderer/styles/media-overlays.css');
const directorSource = read('../renderer/src/app/canvas/ThreeDDirectorNode.tsx');
const directorStyles = read('../renderer/src/app/canvas/ThreeDDirectorNode.css');

const surfaces = [
  ['文本与媒体预览', viewerSource],
  ['3D 导演台', directorSource],
];

test('内容区提供唯一的大工作区挂载点', () => {
  assert.match(shell, /<section className="content">\s*\{view\}\s*<div className="workbench-surface-root" ref=\{setWorkbenchSurfaceRoot\} \/>/);
  assert.match(shell, /import \{ setWorkbenchSurfaceRoot \} from "\.\/layout\/workbenchSurface"/);
  assert.match(shellStyles, /\.content \{[\s\S]*?position: relative;[\s\S]*?isolation: isolate;/);
  assert.match(shellStyles, /\.workbench-surface-root \{[\s\S]*?position: absolute;[\s\S]*?inset: 0;[\s\S]*?z-index: 130;[\s\S]*?pointer-events: none;/);
  assert.match(shellStyles, /\.workbench-surface-root > \* \{[\s\S]*?pointer-events: auto;/);
});

test('挂载点为空时浮层不渲染，取到挂载点后重新渲染', () => {
  assert.match(store, /export function setWorkbenchSurfaceRoot\(next: HTMLElement \| null\): void/);
  assert.match(store, /if \(root === next\) return;/);
  assert.match(store, /useSyncExternalStore\(/);
  assert.match(editorSource, /if \(!surface\) return null;\n  return createPortal\(/);
  assert.match(viewerSource, /if \(!media\.open \|\| !surface\) return null;/);
  assert.match(directorSource, /\{detailOpen && surface && createPortal\(/);
});

test('三个大工作区都挂进内容区挂载点而不是 document.body', () => {
  for (const [name, source] of surfaces) {
    assert.match(source, /useWorkbenchSurfaceRoot/, `${name} 必须使用共享挂载点`);
    assert.match(source, /\n\s*surface,\n/, `${name} 必须 portal 进挂载点`);
    assert.doesNotMatch(source, /document\.body/, `${name} 不得再挂到 document.body`);
  }
  const mount = read('renderer/src/app/editor/openReel/useEditorMount.ts');
  assert.match(editorSource, /useEditorMount\(surface, canvasNode/);
  assert.match(mount, /const parent = expanded \? surface : nodeRoot/);
  assert.match(mount, /const nodeRoot = anchor\?\.closest<HTMLElement>\("\.react-flow__node"\)/);
  assert.doesNotMatch(mount, /document\.body/);
  // 导演台的节点标题仍属于画布内部层叠，只有详情面板进内容区。
  assert.match(directorSource, /\{labelRoot && createPortal\(/);
});

test('浮层用内容区绝对定位，尺寸不再按整个窗口计算', () => {
  const positioning = [
    [editorLayout, '\\.ov-openreel', '10'],
    [directorStyles, '\\.director-detail-backdrop', '20'],
    [viewerStyles, '\\.media-viewer-backdrop', '30'],
  ];
  for (const [styles, selector, zIndex] of positioning) {
    const text = rule(styles, selector);
    assert.ok(text, `缺少 ${selector} 规则`);
    assert.match(text, new RegExp(`position: absolute;\n  inset: 0;\n  z-index: ${zIndex};`));
    assert.doesNotMatch(text, /position: fixed/);
  }
  assert.doesNotMatch(directorStyles, /\.director-detail-window \{[\s\S]*?calc\(100v[wh]/);
});

test('文本界面与导演台详情铺满内容区，不是压暗背景上的悬浮卡片', () => {
  const textSurface = rule(viewerStyles, '\\.media-viewer-backdrop\\.is-text');
  assert.match(textSurface, /grid-template-rows: 46px minmax\(0, 1fr\);/);
  assert.doesNotMatch(textSurface, /backdrop-filter|padding: 32px|align-content: center|--viewer-card-width/);
  assert.doesNotMatch(rule(viewerStyles, '\\.media-viewer-backdrop\\.is-text \\.media-viewer-stage'), /box-shadow|border-radius/);
  assert.doesNotMatch(rule(viewerStyles, '\\.media-viewer-backdrop\\.is-text \\.media-viewer-toolbar'), /border-radius|justify-self: center/);
  assert.doesNotMatch(rule(directorStyles, '\\.director-detail-backdrop'), /backdrop-filter|place-items: center|padding/);
  assert.doesNotMatch(rule(directorStyles, '\\.director-detail-window'), /box-shadow|border-radius|min\(1600px/);
  // 图片与视频预览仍是真正的灯箱：压暗背景保留。
  assert.match(viewerStyles, /\.media-viewer-backdrop:not\(\.is-text\) \{[\s\S]*?background: var\(--overlay-media\)/);
});

test('应用级巨层级只留给真正的窗口浮层', () => {
  assert.doesNotMatch(editorLayout, /z-index:\s*(1[0-9]{3,}|[2-9][0-9]{3,})/);
  assert.doesNotMatch(viewerStyles, /\.media-viewer-backdrop \{[\s\S]*?z-index:\s*240/);
  assert.match(viewerStyles, /\.project-search-backdrop \{[\s\S]*?position: fixed;\n  inset: 0;\n  z-index: var\(--layer-modal\);/);
});

// 文本界面把编辑器和 Agent 面板放在同一个舞台里：舞台的媒体规则一旦写成后代选择器，
// 面板里的产品标识会被 calc(100% - 44px) 压成 0 尺寸，只剩眼睛浮层。
test('舞台的媒体尺寸规则只作用于舞台直接展示的图与视频', () => {
  const selectors = [...viewerStyles.matchAll(/^([^{}]*\.media-viewer-stage[^{}]*)\{/gm)].map((match) => match[1]);
  assert.ok(selectors.length >= 4, '没有找到舞台规则，检查选择器是否被改写');
  for (const selector of selectors) {
    if (!/\b(img|video)\b/.test(selector)) continue;
    assert.match(selector, />\s*(img|video)\b/, `舞台媒体规则泄漏到后代：${selector.trim()}`);
  }
});

// 空文本节点必须给出占位提示；富文本编辑器空下来时里面仍有 <p><br></p>，:empty 永远不成立。
test('空文本编辑器由草稿驱动占位提示而不是 :empty', () => {
  assert.match(viewerStyles, /\.media-viewer-text\[data-empty\]::before \{ content: attr\(data-placeholder\)/);
  assert.doesNotMatch(viewerStyles, /\.media-viewer-text:empty::before/);
  assert.match(viewerSource, /data-empty=\{textDraft\.trim\(\) \? undefined : ""\}/);
});

// 编辑器与助手列的宽度是用户决定，不是固定表格：列宽只经一个变量下发，
// 拖动条、grid 轨道和浮层偏好共用同一个值。
test('文本助手列宽由拖动条决定并统一经变量下发', () => {
  assert.match(viewerStyles, /\.media-viewer-backdrop\.is-text\.is-agent-open \{[\s\S]*?--viewer-columns: minmax\(0, 1fr\) var\(--text-agent-panel-width\);/);
  assert.match(viewerStyles, /\.is-history-open\.is-agent-open \{[\s\S]*?286px var\(--text-agent-panel-width\);/);
  assert.match(viewerSource, /"--text-agent-panel-width": `\$\{agentPanelWidth\}px`/);
  assert.match(viewerSource, /className="text-agent-divider"[\s\S]*?style=\{\{ right: agentPanelWidth \}\}/);
  assert.match(viewerSource, /role="separator"[\s\S]*?onPointerDown=\{startTextAgentResize\}[\s\S]*?onKeyDown=\{resizeTextAgentWithKeyboard\}/);
});

// 共享助手面板根节点默认 z-index 100（画布停靠用）。在文本浮层里不降回普通层级，
// 它会盖住拖动条，鼠标点不到就等于拖动条不存在。
test('助手面板不得盖住列宽拖动条', () => {
  assert.match(viewerStyles, /\.text-agent-panel \{ --agent-chat-z: 1;/);
  assert.match(rule(viewerStyles, '\\.text-agent-divider'), /z-index: 2;/);
  assert.match(rule(viewerStyles, '\\.text-agent-divider'), /cursor: col-resize;/);
  assert.match(rule(viewerStyles, '\\.text-agent-divider'), /touch-action: none;/);
});

// 拖出来的宽度是偏好；版本历史列一开或浮层变窄，只能收窄渲染值，
// 不能把一时的窄空间写回偏好，否则关掉历史列后宽度就回不来了。
test('助手列偏好与可用空间分离且留出编辑器最小宽度', () => {
  assert.match(viewerSource, /const agentSpace = \(stageWidth \|\| window\.innerWidth\) - \(historyOpen \? 286 : 0\) - TEXT_EDITOR_MIN_WIDTH;/);
  assert.match(viewerSource, /const agentPanelWidth = Math\.min\(textAgentWidth, Math\.max\(TEXT_AGENT_MIN_WIDTH, Math\.min\(TEXT_AGENT_MAX_WIDTH, agentSpace\)\)\);/);
  assert.match(viewerSource, /localStorage\.setItem\(TEXT_AGENT_WIDTH_KEY, String\(width\)\)/);
  assert.doesNotMatch(viewerSource, /localStorage\.setItem\(TEXT_AGENT_WIDTH_KEY, String\(agentPanelWidth\)\)/);
  assert.match(viewerSource, /new ResizeObserver\(measure\)/);
});
