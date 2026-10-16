/**
 * 剪辑台、文本编辑器与 3D 导演台共用 section.content 里的一个挂载点。
 * 这里固定住三件事：挂载点只有一处、浮层定位相对内容区、层级不再靠应用级 z-index 逃逸。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

/** 取一条不含嵌套的 CSS 规则原文，避免懒匹配跨规则。 */
const rule = (styles, selector) => styles.match(new RegExp(`^${selector} \\{[^}]*\\}`, 'm'))?.[0] || '';

const shell = read('../renderer/src/app/AppShell.tsx');
const store = read('../renderer/src/app/layout/workbenchSurface.ts');
const shellStyles = read('../renderer/styles.css');
const editorSource = read('../renderer/src/app/editor/VideoEditorWorkspace.tsx');
const editorLayout = read('../renderer/src/app/editor/VideoEditorWorkspace.layout.css');
const editorFoundation = read('../renderer/src/app/editor/VideoEditorWorkspace.foundation.css');
const viewerSource = read('../renderer/src/app/components/MediaViewer.tsx');
const viewerStyles = read('../renderer/styles/media-overlays.css');
const directorSource = read('../renderer/src/app/canvas/ThreeDDirectorNode.tsx');
const directorStyles = read('../renderer/src/app/canvas/ThreeDDirectorNode.css');

const surfaces = [
  ['剪辑台', editorSource],
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
  // 导演台的节点标题仍属于画布内部层叠，只有详情面板进内容区。
  assert.match(directorSource, /\{labelRoot && createPortal\(/);
});

test('浮层用内容区绝对定位，尺寸不再按整个窗口计算', () => {
  const positioning = [
    [editorLayout, '\\.ov-editor', '10'],
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
  assert.match(viewerStyles, /\.media-viewer-backdrop:not\(\.is-text\) \{[\s\S]*?background: rgba\(18, 18, 18, \.88\)/);
});

test('应用级巨层级只留给真正的窗口浮层', () => {
  assert.doesNotMatch(editorFoundation, /z-index:\s*1500/);
  assert.doesNotMatch(editorFoundation, /body\.video-editor-open/);
  assert.doesNotMatch(editorLayout, /z-index:\s*(1[0-9]{3,}|[2-9][0-9]{3,})/);
  assert.doesNotMatch(viewerStyles, /\.media-viewer-backdrop \{[\s\S]*?z-index:\s*240/);
  assert.match(viewerStyles, /\.project-search-backdrop \{[\s\S]*?position: fixed;\n  inset: 0;\n  z-index: 300;/);
});
