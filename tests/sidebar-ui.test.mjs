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
  assert.doesNotMatch(sidebar, /className="side-title"/);
  assert.match(styles, /\.sidebar-shell\.collapsed \.sidebar \{[\s\S]*?padding:\s*46px 7px 8px/);
  assert.match(styles, /\.sidebar-shell\.collapsed \.sidebar-footer button \{ width: 40px; height: 36px/);
  assert.match(styles, /\.sidebar-brand \{[^}]*min-height:\s*54px[^}]*margin:\s*0 2\.5px 12px[^}]*padding:\s*3px 0 11px/);
  assert.match(styles, /\.sidebar-shell\.collapsed \.sidebar-brand \{[^}]*min-height:\s*54px[^}]*margin:\s*0 0 12px 3\.5px[^}]*padding:\s*3px 0 11px/);
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

test('侧栏开合不因分组标题改变按钮纵向位置', () => {
  assert.doesNotMatch(sidebar, /className="side-title"/);
  assert.doesNotMatch(styles, /\.sidebar-shell\.collapsed \.side-title/);
});

test('顶部栏不占布局高度并提供窄窗口拖拽区域', () => {
  assert.match(styles, /\.app-shell \{[\s\S]*?display:\s*block/);
  assert.match(styles, /\.topbar \{[\s\S]*?position:\s*absolute/);
  assert.match(topbar, /className="window-drag-strip" data-tauri-drag-region/);
  assert.match(styles, /\.window-drag-strip \{[^}]*height:\s*5px;[^}]*pointer-events:\s*auto;[^}]*-webkit-app-region:\s*drag/);
  assert.match(styles, /\.workspace \{[\s\S]*?height:\s*100%/);
  assert.match(styles, /padding:\s*4px 4px 4px 0/);
  assert.doesNotMatch(appShell, /projects-shell/);
});

test('创作画布保留窄窗口操作边界且不恢复厚标题栏', () => {
  assert.match(appShell, /className=\{`app-shell route-\$\{route\}/);
  assert.match(styles, /\.app-shell\.route-creation \.workspace \{[^}]*padding-top:\s*5px[^}]*padding-right:\s*5px[^}]*padding-bottom:\s*5px/);
  assert.match(styles, /\.app-shell\.route-creation \.content \{[^}]*border:\s*\.5px solid[^}]*border-radius:\s*var\(--workbench-radius\)[^}]*padding:\s*0/);
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

test('自定义厂商复用内置模型 ID 时明确保存并展示覆盖关系', () => {
  assert.match(providerDialog, /globalBuiltInModels\.has\(model\.id\)/);
  assert.match(providerDialog, /overridesBuiltIn: true/);
  assert.match(providerDialog, /覆盖内置 \$\{replacedBuiltIn\.provider\}/);
  assert.match(settingsStyles, /\.provider-model-origin\.override/);
});

test('自定义厂商隔离内置 ID 和切换前的敏感状态', () => {
  assert.match(providerDialog, /initialConfig\?\.custom === true \|\| !editingDefinition/);
  assert.match(providerDialog, /definitions\.some\(\(definition\) => definition\.id === providerId\)/);
  assert.match(providerDialog, /厂商 ID .*已被内置厂商保留/);
  assert.match(providerDialog, /if \(id === CUSTOM_PROVIDER_ID[\s\S]*?setApiKey\(""\);[\s\S]*?setDisabledIds\(new Set\(\)\)/);
});

test('自定义模型保存和试跑复用运行时协议校验', () => {
  assert.match(providerDialog, /catalogModelValidationErrors\(model, \{ requireProvider: true \}\)/);
  assert.match(providerDialog, /catalogModelValidationErrors\(added, \{ requireProvider: true \}\)/);
  assert.match(providerDialog, /<option value="audioGeneration">音频生成<\/option>/);
});

test('自定义文本模型明确展示并可编辑 Agent 工具调用能力', () => {
  assert.match(providerDialog, /supportsAgentTools/);
  assert.match(providerDialog, /可用于 Agent/);
  assert.match(providerDialog, /不会出现在 Agent 模型列表/);
  assert.match(settingsStyles, /\.provider-model-agent-status\.unavailable/);
});
