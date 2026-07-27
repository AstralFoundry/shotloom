import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const sidebar = readFileSync(new URL('../renderer/src/app/layout/SideBar.tsx', import.meta.url), 'utf8');
const interactiveLogo = readFileSync(new URL('../renderer/src/app/components/InteractiveLogo.tsx', import.meta.url), 'utf8');
const appShell = readFileSync(new URL('../renderer/src/app/AppShell.tsx', import.meta.url), 'utf8');
const topbar = readFileSync(new URL('../renderer/src/app/layout/TopBar.tsx', import.meta.url), 'utf8');
const projectLibrary = readFileSync(new URL('../renderer/src/app/adapters/projectLibraryAdapter.ts', import.meta.url), 'utf8');
const taskStore = readFileSync(new URL('../renderer/src/store/taskStore.js', import.meta.url), 'utf8');
const providerDialog = readFileSync(new URL('../renderer/src/app/views/ProviderConnectionDialog.tsx', import.meta.url), 'utf8');
const modelGuide = readFileSync(new URL('../renderer/src/app/views/ModelProtocolGuideDialog.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../renderer/styles.css', import.meta.url), 'utf8');
const settingsStyles = readFileSync(new URL('../renderer/styles/settings.css', import.meta.url), 'utf8');
const reactMigrationStyles = readFileSync(new URL('../renderer/styles/react-migration.css', import.meta.url), 'utf8');

test('项目侧栏提供返回项目库入口', () => {
  assert.match(sidebar, /className="side-item sidebar-back-item"/);
  assert.match(sidebar, /navigate\("projects"\)/);
  assert.match(sidebar, /返回项目库/);
});

test('悬停抽屉只改变宽度和文字，不改变工具图标几何尺寸', () => {
  assert.match(styles, /width 220ms cubic-bezier\(\.22, 1, \.36, 1\)/);
  assert.match(styles, /\.side-item svg \{[\s\S]*?flex:\s*0 0 17px/);
  assert.match(styles, /\.sidebar-shell\.collapsed \.side-title \{ visibility: hidden; opacity: 0; \}/);
  assert.match(styles, /\.side-title \{[\s\S]*?white-space:\s*nowrap/);
  assert.match(styles, /\.sidebar-shell\.collapsed \.sidebar \{[\s\S]*?padding:\s*46px 7px 8px/);
  assert.match(styles, /\.sidebar-shell\.collapsed \.sidebar-footer button \{ width: 40px; height: 36px/);
  assert.match(styles, /\.sidebar-brand \{[^}]*min-height:\s*54px[^}]*margin:\s*0 2\.5px 12px[^}]*padding:\s*3px 0 11px/);
  assert.match(styles, /\.sidebar-shell\.collapsed \.sidebar-brand \{[^}]*min-height:\s*54px[^}]*margin:\s*0 0 12px 3\.5px[^}]*padding:\s*3px 0 11px/);
  assert.match(styles, /\.sidebar-shell\.collapsed \.side-list \+ \.side-title \+ \.side-list \{\s*border-color:\s*transparent;\s*\}/);
  assert.doesNotMatch(styles, /\.sidebar-shell\.collapsed \.side-list \+ \.side-title \+ \.side-list \{[^}]*(?:margin-top|padding-top):/);
});

test('侧栏关闭时保留详情直到抽屉和淡出动画完成', () => {
  assert.match(appShell, /sidebarPreviewClosing/);
  assert.match(appShell, /}, 220\)/);
  assert.match(appShell, /function toggleSidebarWithTransition\(\)/);
  assert.match(appShell, /setSidebarPreviewOpen\(true\);\s*setSidebarPreviewClosing\(true\);\s*toggleSidebar\(\)/);
  assert.match(appShell, /onToggleSidebar=\{toggleSidebarWithTransition\}/);
  assert.match(sidebar, /onClick=\{\(\) => \{\s*onToggleSidebar\(\);\s*\}\}/);
  assert.match(sidebar, /\{\(!collapsed \|\| previewOpen\) && \(/);
  assert.match(styles, /\.sidebar-toggle \{[^}]*right:\s*6px/);
  assert.match(styles, /\.sidebar-shell\.preview-closing \.sidebar-toggle \{[^}]*opacity:\s*0;[^}]*pointer-events:\s*none/);
  assert.match(sidebar, /preview-closing/);
  assert.match(styles, /@keyframes sidebar-preview-detail-out/);
  assert.match(styles, /\.sidebar-shell\.preview-closing/);
});

test('悬停抽屉固定时直接转为常驻侧栏而不经过关闭动画', () => {
  assert.match(appShell, /if \(collapsed\) \{\s*setSidebarPreviewOpen\(false\);\s*setSidebarPreviewClosing\(false\);\s*toggleSidebar\(\);\s*return;/);
  assert.match(sidebar, /pinnedOpen \? " pinned-open"/);
  assert.match(appShell, /className="workspace sidebar-collapsed"/);
  assert.match(styles, /\.sidebar-shell\.pinned-open/);
  assert.match(appShell, /sidebar-is-pinned/);
  assert.match(styles, /\.app-shell:not\(\.sidebar-overlay-shell\)\.sidebar-is-pinned \.content/);
  assert.match(styles, /margin-left:\s*calc\([\s\S]*?var\(--workspace-sidebar-width\) - var\(--workspace-sidebar-rail-width\) - 8px[\s\S]*?\)/);
  assert.match(styles, /\.app-shell:not\(\.sidebar-overlay-shell\) :is\([\s\S]*?\.sidebar-shell\.preview-open,[\s\S]*?\.sidebar-shell\.pinned-open[\s\S]*?\) \{[^}]*border-radius:\s*0;[^}]*box-shadow:\s*none/);
  assert.doesNotMatch(appShell, /sidebarPinning|pinSidebarPreview/);
  assert.match(sidebar, /title=\{collapsed \? "固定左侧栏" : "收起左侧栏"\}/);
});

test('项目库为展开侧栏让位且只有画布使用覆盖式侧栏', () => {
  assert.match(appShell, /const overlaySidebar = route === "creation"/);
  assert.doesNotMatch(appShell, /route === "creation" \|\| route === "projects"/);
  assert.match(appShell, /overlaySidebar \? " sidebar-overlay-shell"/);
  assert.match(appShell, /const effectiveCollapsed = collapsed/);
  assert.match(sidebar, /const iconRail = collapsed && !previewOpen/);
  assert.match(sidebar, /if \(collapsed\) onPreviewOpenChange\(true\)/);
  assert.match(sidebar, /\{\(!collapsed \|\| previewOpen\) && \(/);
});

test('未退出软件时项目库导航不会中断生成任务', () => {
  assert.match(taskStore, /export function hasActiveGenerationTasks\(\)/);
  assert.match(projectLibrary, /if \(filePath === store\.filePath\) \{\s*navigateToRoute\("creation"\);\s*return;/);
  assert.match(projectLibrary, /if \(hasActiveGenerationTasks\(\)\) \{/);
  assert.match(projectLibrary, /openProjectInNewWindow\(projectDir\)/);
});

test('顶部栏不再渲染产品 Logo 和名称', () => {
  assert.doesNotMatch(topbar, /BrandMark|brand-name|Shotloom/);
  assert.doesNotMatch(topbar, /topbar-leading|topbar-breadcrumb/);
});

test('侧栏使用 Shotloom 自有 Logo 和正确产品名', () => {
  assert.match(sidebar, /className="sidebar-brand"/);
  assert.match(sidebar, /shotloom-logo\.png/);
  assert.match(sidebar, /<strong>Shotloom<\/strong>/);
  assert.match(sidebar, /<small>AI 创作工作台<\/small>/);
  assert.match(styles, /\.sidebar-brand img/);
  assert.match(styles, /\.sidebar-brand img \{[^}]*width:\s*32px[^}]*height:\s*32px[^}]*flex:\s*0 0 32px/);
  assert.doesNotMatch(styles, /\.sidebar-shell\.collapsed \.sidebar-brand img/);
  assert.match(styles, /\.sidebar-shell\.collapsed \.sidebar-brand-copy \{ display: none; \}/);
  assert.equal(existsSync(new URL('../renderer/public/shotloom-logo.png', import.meta.url)), true);
  assert.doesNotMatch(sidebar, /Hoshi/);
});

test('侧栏 Logo 的瞳孔跟随鼠标并尊重减少动态效果设置', () => {
  assert.match(sidebar, /<InteractiveLogo src="\.\/shotloom-logo\.png" \/>/);
  assert.match(interactiveLogo, /window\.addEventListener\("pointermove", followPointer/);
  assert.match(interactiveLogo, /requestAnimationFrame/);
  assert.match(interactiveLogo, /prefers-reduced-motion: reduce/);
  assert.match(interactiveLogo, /Math\.min\(1, distance \/ 180\)/);
  assert.match(interactiveLogo, /document\.documentElement\.addEventListener\("pointerleave", resetPupils\)/);
});

test('侧栏底部入口与上方导航使用一致的字号和图标尺寸', () => {
  assert.match(styles, /\.sidebar-footer button \{[^}]*height:\s*36px[^}]*font-size:\s*13px[^}]*font-weight:\s*500/);
  assert.match(styles, /\.sidebar-footer svg \{ width:\s*17px; height:\s*17px; flex:\s*0 0 17px/);
  assert.doesNotMatch(styles, /sidebar-settings-icon/);
});

test('所有页面都不再为顶部栏保留独立布局高度', () => {
  assert.match(styles, /\.app-shell \{[\s\S]*?display:\s*block/);
  assert.match(styles, /\.topbar \{[\s\S]*?position:\s*absolute/);
  assert.match(styles, /\.workspace \{[\s\S]*?height:\s*100%/);
  assert.match(styles, /padding:\s*4px 4px 4px 0/);
  assert.doesNotMatch(appShell, /projects-shell/);
});

test('创作画布使用完整工作区高度且不保留上下装饰留白', () => {
  assert.match(appShell, /className=\{`app-shell route-\$\{route\}/);
  assert.match(styles, /\.app-shell\.route-creation \.workspace \{[^}]*padding-top:\s*0[^}]*padding-right:\s*0[^}]*padding-bottom:\s*0/);
  assert.match(styles, /\.app-shell\.route-creation \.content \{[^}]*border-top:\s*0[^}]*border-bottom:\s*0[^}]*border-radius:\s*0[^}]*padding:\s*0/);
  assert.doesNotMatch(styles, /\.creation-shell \.content/);
});

test('Copilot 折叠按钮为画布右上角工具组预留空间', () => {
  assert.match(styles, /--copilot-reopen-width:\s*104px/);
  assert.match(styles, /\.forge-copilot-reopen \{[^}]*width:\s*var\(--copilot-reopen-width\)[^}]*height:\s*40px/);
  assert.match(reactMigrationStyles, /\.forge-lite-main\.copilot-collapsed \.canvas-corner-controls \{[^}]*right:\s*calc\(22px \+ var\(--copilot-reopen-width\)\)/);
});

test('策略编辑弹窗由正文滚动且测试台不会被 Flex 压缩裁切', () => {
  assert.match(settingsStyles, /\.recipe-dialog-body \{[^}]*flex:\s*1 1 auto[^}]*overflow-y:\s*auto/);
  assert.match(settingsStyles, /\.recipe-dialog-body > \* \{ flex-shrink: 0; \}/);
  assert.match(settingsStyles, /\.recipe-dialog > header,[\s\S]*?\.recipe-dialog > footer \{[\s\S]*?flex:\s*0 0 auto/);
});

test('API 厂商按模型逐个编辑协议而不是暴露完整目录数组', () => {
  assert.match(providerDialog, /const \[models, setModels\] = useState<CatalogModel\[]>/);
  assert.match(providerDialog, /const \[selectedModelId, setSelectedModelId\]/);
  assert.match(providerDialog, /单模型协议/);
  assert.match(providerDialog, /value=\{modelJson\}/);
  assert.match(providerDialog, /placeholder="\{\}"/);
  assert.doesNotMatch(providerDialog, /value=\{modelsJson\}/);
});

test('新增 API 模型使用空白协议', () => {
  assert.match(providerDialog, /starterProtocolModel\(newModel\.type\)/);
  assert.match(providerDialog, /endpoint: \{ method: "POST", path: "", scope: "root" \}/);
  assert.match(providerDialog, /requestTemplate: \{\}/);
  assert.match(providerDialog, /inputConstraints: \{\}/);
  assert.match(providerDialog, /outputConstraints: \{\}/);
  assert.match(providerDialog, /requestTemplate/);
  assert.doesNotMatch(providerDialog, /const template = models\.find/);
  assert.doesNotMatch(providerDialog, /model: "\{\{model\}\}"/);
  assert.match(providerDialog, /selectedModelId && !newModel/);
  assert.match(providerDialog, /创建并编辑协议/);
});

test('模型配置提供独立指南和可复制给 AI 的完整任务说明', () => {
  assert.match(providerDialog, /ModelProtocolGuideDialog/);
  assert.match(providerDialog, /打开完整接入指南/);
  assert.match(modelGuide, /接入步骤/);
  assert.match(modelGuide, /字段与变量/);
  assert.match(modelGuide, /异步任务/);
  assert.match(modelGuide, /交给 AI/);
  assert.match(modelGuide, /AI_MODEL_PROTOCOL_PROMPT/);
  assert.match(modelGuide, /navigator\.clipboard/);
  assert.match(modelGuide, /只输出 JSON 对象，不要 Markdown/);
  assert.match(modelGuide, /不要根据经验猜测接口、字段、枚举或结果路径/);
});
