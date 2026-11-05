import test from 'node:test';
import assert from 'node:assert/strict';
import { readLocalizedSource as readSource, sourceExists } from './helpers/sourceContract.mjs';

const sidebar = readSource('renderer/src/app/layout/SideBar.tsx');
const interactiveLogo = readSource('renderer/src/app/components/InteractiveLogo.tsx');
const appShell = readSource('renderer/src/app/AppShell.tsx');
const topbar = readSource('renderer/src/app/layout/TopBar.tsx');
const projectLibrary = readSource('renderer/src/app/adapters/projectLibraryAdapter.ts');
const taskStore = readSource('renderer/src/store/taskStore.ts');
const settingsPanel = readSource('renderer/src/app/views/SettingsPanel.tsx');
const settingsFeature = readSource('renderer/src/app/views/SettingsFeature.tsx');
// 全局样式按界面区域分文件，导入顺序就是层叠顺序；这里按规则归属读取对应区域。
const styles = readSource('renderer/styles/app-shell.css');
const workbenchStyles = readSource('renderer/styles/workbench.css');
const settingsStyles = readSource('renderer/styles/settings.css');
const reactMigrationStyles = ['canvas.css', 'project-materials.css', 'media-overlays.css', 'creation-view.css']
  .map((name) => readSource(`../renderer/styles/${name}`))
  .join('\n');

test('项目侧栏提供返回上一层入口并恢复当前画布的父文件夹', () => {
  assert.match(sidebar, /className="side-item sidebar-back-item"/);
  assert.match(sidebar, /navigate\("projects"\)/);
  assert.match(sidebar, /返回上一层/);
  assert.match(projectLibrary, /function findProjectFolderPath\(/);
  assert.match(projectLibrary, /initialFolderPath: findProjectFolderPath\(entries, store\.filePath\)/);
});

test('悬停抽屉只改变宽度和文字，不改变工具图标几何尺寸', () => {
  assert.match(styles, /width var\(--duration-enter\) var\(--ease-sheet\)/);
  assert.match(styles, /\.side-item svg \{[\s\S]*?flex:\s*0 0 var\(--icon-md\)/);
  assert.doesNotMatch(styles, /\.sidebar-shell\.collapsed \.side-item svg/);
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
  assert.equal(sourceExists('renderer/public/shotloom-logo.png'), true);
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
  assert.match(styles, /\.sidebar-footer button \{[^}]*height:\s*36px[^}]*font-size:\s*var\(--text-body-13\)[^}]*font-weight:\s*500/);
  assert.match(styles, /\.sidebar-footer svg \{ width:\s*var\(--icon-md\); height:\s*var\(--icon-md\); flex:\s*0 0 var\(--icon-md\)/);
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

test('助手折叠按钮为画布右上角工具组预留空间', () => {
  assert.match(workbenchStyles, /--agent-reopen-width:\s*104px/);
  assert.match(workbenchStyles, /\.forge-agent-reopen \{[^}]*width:\s*var\(--agent-reopen-width\)[^}]*height:\s*40px/);
  assert.match(reactMigrationStyles, /\.forge-lite-main\.agent-collapsed \.canvas-corner-controls \{[^}]*right:\s*calc\(22px \+ var\(--agent-reopen-width\)\)/);
  assert.doesNotMatch(`${styles}${workbenchStyles}${reactMigrationStyles}${settingsStyles}`, /copilot/i);
});





// 引用素材按真实媒体呈现；输入区和用户气泡共用同一张卡，发送前后看到的必须是同一个素材。


// 图片要能悬停放大，视频要能在原地播出去，不能只是"看起来像"。


test('API 厂商页先展示内置厂商列表，点击后进入详情', () => {
  assert.match(settingsFeature, /const providers = getProviderAdapters\(\)\.map/);
  assert.match(settingsPanel, /data\.providers\.map\(\(item\) => \(\n\s+<button className="provider-list-row"/);
  assert.match(settingsPanel, /setSelectedProviderId\(item\.id\)/);
  assert.match(settingsPanel, /返回厂商列表/);
  assert.match(settingsPanel, /<ProviderCard item=\{selectedProvider\}/);
  assert.doesNotMatch(settingsPanel, /controller\.(add|edit|delete)Provider/);
  assert.doesNotMatch(settingsFeature, /addProvider|editProvider|deleteProvider|ProviderConnectionDialog|getConfiguredProviders|getProviderDefinition/);
  assert.equal(sourceExists('renderer/src/app/views/ProviderConnectionDialog.tsx'), false);
});

test('厂商卡片只提交 API Key 与接口地址，其余配置属于代码声明', () => {
  assert.match(settingsPanel, /onChange=\{controller\.setProviderConfig\}/);
  assert.match(settingsPanel, /onChange\(item\.id, \{ \[field\]: next \}\)/);
  assert.match(settingsPanel, /interface ProviderConfigPatch \{[\s\S]*?apiKey\?: string;[\s\S]*?baseUrl\?: string;[\s\S]*?\}/);
  assert.doesNotMatch(settingsPanel, /disabledModelIds|customModels|protocol|apiKeyValid/);
  // 地址可覆盖但必填的厂商（Qwen 百炼）要在卡片上说明缺失。
  assert.match(settingsPanel, /item\.baseUrlRequired && !item\.baseUrl\.trim\(\)/);
  assert.match(settingsPanel, /该厂商必须填写接口地址/);
  assert.match(settingsFeature, /saveAppSettings\(\{[\s\S]*?providerConfigs[\s\S]*?\}\)/);
});

test('厂商卡片用配置状态说明模型可见性而不是承诺连通性', () => {
  assert.match(settingsPanel, /item\.configured \? "已配置" : "未配置"/);
  assert.match(settingsPanel, /填写 API Key 后该厂商的模型才会进入目录/);
  assert.match(settingsPanel, /实际连通性在调用模型时验证/);
  assert.match(settingsStyles, /\.provider-incomplete i \{ background: var\(--line-strong\)/);
});

test('厂商卡片按生成类型展示该厂商的全部内置模型', () => {
  assert.match(settingsFeature, /models: getProviderModelRows\(adapter\.id\)/);
  assert.match(settingsPanel, /interface ProviderItem \{[\s\S]*?models: ProviderModelRow\[\];/);
  assert.doesNotMatch(settingsPanel, /modelCount/);
  // 分组与徽标全部消费目录派生的行，界面不另写一份模型清单。
  assert.match(settingsPanel, /groupProviderModels\(item\.models\)\.map/);
  assert.match(settingsPanel, /\{label\}[\s\S]*?\{models\.length\}/);
  assert.match(settingsPanel, /MODEL_INPUT_LABELS\[kind\]/);
  assert.match(settingsPanel, /model\.agentReady \? "可用于 Agent" : "仅画布"/);
  assert.match(settingsStyles, /\.provider-model-list \{ display: grid; gap: 8px; \}/);
});
