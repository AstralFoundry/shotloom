import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const sidebar = readFileSync(new URL('../renderer/src/app/layout/SideBar.tsx', import.meta.url), 'utf8');
const interactiveLogo = readFileSync(new URL('../renderer/src/app/components/InteractiveLogo.tsx', import.meta.url), 'utf8');
const appShell = readFileSync(new URL('../renderer/src/app/AppShell.tsx', import.meta.url), 'utf8');
const topbar = readFileSync(new URL('../renderer/src/app/layout/TopBar.tsx', import.meta.url), 'utf8');
const projectLibrary = readFileSync(new URL('../renderer/src/app/adapters/projectLibraryAdapter.ts', import.meta.url), 'utf8');
const taskStore = readFileSync(new URL('../renderer/src/store/taskStore.js', import.meta.url), 'utf8');
const settingsPanel = readFileSync(new URL('../renderer/src/app/views/SettingsPanel.tsx', import.meta.url), 'utf8');
const settingsFeature = readFileSync(new URL('../renderer/src/app/views/SettingsFeature.tsx', import.meta.url), 'utf8');
const agentChat = '../renderer/src/app/agent-chat/';
const transcript = readFileSync(new URL(`${agentChat}Transcript.tsx`, import.meta.url), 'utf8');
const agentPresentation = readFileSync(new URL(`${agentChat}agentPresentation.ts`, import.meta.url), 'utf8');
const composer = readFileSync(new URL(`${agentChat}Composer.tsx`, import.meta.url), 'utf8');
const transcriptStyles = readFileSync(new URL(`${agentChat}Transcript.module.css`, import.meta.url), 'utf8');
const composerStyles = readFileSync(new URL(`${agentChat}Composer.module.css`, import.meta.url), 'utf8');
const copilotAdapter = readFileSync(new URL('../renderer/src/app/adapters/copilotAdapter.ts', import.meta.url), 'utf8');
const referenceCard = readFileSync(new URL(`${agentChat}ReferenceCard.tsx`, import.meta.url), 'utf8');
const referenceModel = readFileSync(new URL(`${agentChat}mediaReference.ts`, import.meta.url), 'utf8');
const referenceStyles = readFileSync(new URL(`${agentChat}ReferenceCard.module.css`, import.meta.url), 'utf8');
const mediaThumb = readFileSync(new URL(`${agentChat}MediaThumb.tsx`, import.meta.url), 'utf8');
const mediaThumbStyles = readFileSync(new URL(`${agentChat}MediaThumb.module.css`, import.meta.url), 'utf8');
const styles = readFileSync(new URL('../renderer/styles.css', import.meta.url), 'utf8');
const settingsStyles = readFileSync(new URL('../renderer/styles/settings.css', import.meta.url), 'utf8');
const reactMigrationStyles = ['canvas.css', 'project-materials.css', 'media-overlays.css', 'creation-view.css']
  .map((name) => readFileSync(new URL(`../renderer/styles/${name}`, import.meta.url), 'utf8'))
  .join('\n');

test('项目侧栏提供返回上一层入口并恢复当前画布的父文件夹', () => {
  assert.match(sidebar, /className="side-item sidebar-back-item"/);
  assert.match(sidebar, /navigate\("projects"\)/);
  assert.match(sidebar, /返回上一层/);
  assert.match(projectLibrary, /function findProjectFolderPath\(/);
  assert.match(projectLibrary, /initialFolderPath: findProjectFolderPath\(entries, store\.filePath\)/);
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

test('助手折叠按钮为画布右上角工具组预留空间', () => {
  assert.match(styles, /--agent-reopen-width:\s*104px/);
  assert.match(styles, /\.forge-agent-reopen \{[^}]*width:\s*var\(--agent-reopen-width\)[^}]*height:\s*40px/);
  assert.match(reactMigrationStyles, /\.forge-lite-main\.agent-collapsed \.canvas-corner-controls \{[^}]*right:\s*calc\(22px \+ var\(--agent-reopen-width\)\)/);
  assert.doesNotMatch(`${styles}${reactMigrationStyles}${settingsStyles}`, /copilot/i);
});

test('助手空状态使用创作欢迎区并把模型与 Skill 收进大输入器底栏', () => {
  assert.match(transcript, /<InteractiveLogo src="\.\/shotloom-logo\.png" className=\{styles\.emptyMark\} \/>/);
  // 欢迎文案按 Agent 声明在呈现表里，面板组件不再用布尔开关猜作用域。
  assert.match(agentPresentation, /描述你想完成的内容/);
  assert.match(agentPresentation, /用 @ 引用画布节点/);
  // 窄面板里欢迎区必须退回顶部对齐并可滚动，不能用居中把两头裁掉。
  assert.match(transcriptStyles, /\.empty \{[^}]*flex-shrink:\s*0[^}]*margin:\s*auto 0/);
  assert.doesNotMatch(transcriptStyles, /\.empty \{[^}]*justify-content:\s*center/);
  assert.doesNotMatch(transcript, /Hi，准备开始创作了吗|copilotQuickStarts|SHOTLOOM AGENT|copilot-welcome-tabs/);

  assert.match(composer, /hint=\{activeModel\?\.label \|\| "选择模型"\}/);
  assert.match(composer, /<ProviderBrandIcon icon=\{item\.iconId\} \/>/);
  assert.match(composer, /icon="puzzle"/);
  assert.match(agentPresentation, /skillLabel: "技能"/);
  assert.match(composer, /aria-haspopup="menu"/);
  assert.match(composer, /role="menuitemradio" aria-checked=\{selected\}/);
  assert.doesNotMatch(composer, /@ant-design|from "antd"|ant-sender/);

  // 选择器弹层在输入卡内部向上弹出，不再依赖 antd Dropdown 的视口定位。
  assert.match(composerStyles, /\.menu \{[^}]*position:\s*absolute;[^}]*bottom:\s*calc\(100% \+ 8px\)/);
  assert.match(composerStyles, /\.toolbar \{[^}]*display:\s*flex/);
});

test('长用户输入默认折叠，消息列表用细滚动条而不是完全隐藏', () => {
  assert.match(transcript, /<UserBody html=\{messageMarkdown\(message\)\} \/>/);
  assert.match(transcript, /data-expanded=\{expanded \|\| undefined\}/);
  assert.match(transcript, /\{expanded \? "收起" : "展开"\}/);
  assert.match(transcriptStyles, /\.userBody \.markdown \{[^}]*max-height:\s*168px[^}]*overflow:\s*hidden/);
  assert.match(transcriptStyles, /\.userBody\[data-expanded\] \.markdown \{\s*max-height: none;/);
  // 渐隐只属于真正被裁掉的消息；无条件加遮罩会把短消息最后半行淡掉。
  assert.match(transcriptStyles, /\.userBody\[data-clamped\] \.markdown \{[^}]*mask-image/);
  assert.doesNotMatch(transcriptStyles, /\.userBody \.markdown \{[^}]*mask-image/);
  assert.match(transcript, /data-clamped=\{overflowing && !expanded \? "true" : undefined\}/);
  assert.match(transcriptStyles, /\.list \{[^}]*scrollbar-width:\s*thin[^}]*scrollbar-color:\s*var\(--slk-scrollbar\) transparent/);
  assert.match(transcriptStyles, /\.list::-webkit-scrollbar-thumb \{[^}]*background-clip:\s*content-box/);
});

// 引用素材按真实媒体呈现；输入区和用户气泡共用同一张卡，发送前后看到的必须是同一个素材。
test('附件引用显示为媒体卡，输入框焦点不出现双重描边', () => {
  assert.match(transcript, /className=\{styles\.references\}/);
  assert.match(transcript, /message\.references\.map/);
  assert.match(transcript, /<ReferenceCard key=\{`\$\{reference\.label\}-\$\{index\}`\} reference=\{reference\} \/>/);
  assert.match(composer, /<ReferenceCard/);
  // 旧的文本胶囊不能留着，否则同一份引用会有两种呈现。
  assert.doesNotMatch(composer, /function MentionChip|styles\.fileChip|styles\.mentionAt/);
  assert.doesNotMatch(copilotAdapter, /未命名节点|未命名文件/);
  assert.match(copilotAdapter, /references: \[\.\.\.\(payload\.references \|\| \[\]\)\]/);
  // 节点引用取用户此刻在画布上看到的那份产物，不能盲目取最后一个输出。
  assert.match(referenceModel, /String\(record\.selectedOutputNodeId \|\| ""\)\.replace/);
  // 素材名只在 title 悬浮提示和无障碍标签里，卡片本身不放文字。
  assert.doesNotMatch(referenceCard, /styles\.label|styles\.name|styles\.at/);
  assert.match(referenceCard, /className=\{styles\.card\} title=\{reference\.label\}/);
  assert.match(referenceCard, /<MediaThumb[\s\S]*?kind=\{reference\.kind\}/);
  // 卡片就是素材本身，不再套边框和底色。
  assert.doesNotMatch(referenceStyles, /\.card \{[^}]*(box-shadow|--slk-stroke-color|background:|border:)/);
  // 删除入口只在悬停或聚焦时出现，触屏保持常驻。
  assert.match(referenceStyles, /\.remove \{[^}]*opacity:\s*0/);
  assert.match(referenceStyles, /\.card:hover \.remove,[\s\S]*?\.card:focus-within \.remove \{\s*opacity:\s*1/);
  assert.match(referenceStyles, /@media \(hover: none\) \{[^}]*\.remove \{\s*opacity:\s*1/);
  // 视频流式失败要退回整段缓冲，与画布视频节点用同一套回退。
  assert.match(mediaThumb, /preview\.buffered \? setFailed\(true\) : preview\.retryBuffered\(\)/);
  // preload="metadata" 只读到时长不会解码画面，必须显式 seek 一帧才有海报。
  assert.match(mediaThumb, /element\.currentTime === 0 && element\.duration > 0/);
  assert.match(mediaThumb, /element\.currentTime = Math\.min\(1 \/ 30, Math\.max\(0, element\.duration - 0\.04\)\)/);
  assert.match(mediaThumb, /muted\n\s+playsInline\n\s+preload="metadata"\n\s+controls=\{playing\}/);
  assert.match(mediaThumbStyles, /\.badge \{[^}]*font-variant-numeric:\s*tabular-nums/);
  assert.match(composerStyles, /\.input \{[^}]*outline: none/);
});

// 图片要能悬停放大，视频要能在原地播出去，不能只是"看起来像"。
test('素材缩略图悬停放大，视频点击后就地播放', () => {
  assert.match(mediaThumbStyles, /\.thumb > img,\s*\.thumb > video \{[\s\S]*?transition:\s*transform/);
  assert.match(mediaThumbStyles, /\.thumb:not\(\[data-playing\]\):hover > img,\s*\.thumb:not\(\[data-playing\]\):hover > video \{\s*transform: scale\(1\.07\)/);
  assert.match(mediaThumb, /const \[playing, setPlaying\] = useState\(false\)/);
  assert.match(mediaThumb, /onPlay=\{\(\) => setPlaying\(true\)\}/);
  assert.match(mediaThumb, /aria-label=\{`播放：\$\{label\}`\}/);
  assert.match(mediaThumb, /setPlaying\(true\);\n\s+void videoRef\.current\?\.play\(\)/);
  // 播放时让出原生控件，海报角标不能压在进度条上。
  assert.match(mediaThumb, /\{!!badge && !playing && <span className=\{styles\.badge\}\>/);
  // 静止预览用 zoom-in，播放中不能继续承诺放大。
  assert.match(mediaThumbStyles, /\.thumb:not\(:disabled\) \{\s*cursor: zoom-in/);
  assert.match(mediaThumbStyles, /\.thumb\[data-playing\] \{\s*cursor: default/);
});

test('策略编辑弹窗由正文滚动且测试台不会被 Flex 压缩裁切', () => {
  assert.match(settingsStyles, /\.recipe-dialog-body \{[^}]*flex:\s*1 1 auto[^}]*overflow-y:\s*auto/);
  assert.match(settingsStyles, /\.recipe-dialog-body > \* \{ flex-shrink: 0; \}/);
  assert.match(settingsStyles, /\.recipe-dialog > header,[\s\S]*?\.recipe-dialog > footer \{[\s\S]*?flex:\s*0 0 auto/);
});

test('API 厂商页先展示内置厂商列表，点击后进入详情', () => {
  assert.match(settingsFeature, /const providers = getProviderAdapters\(\)\.map/);
  assert.match(settingsPanel, /data\.providers\.map\(\(item\) => \(\n\s+<button className="provider-list-row"/);
  assert.match(settingsPanel, /setSelectedProviderId\(item\.id\)/);
  assert.match(settingsPanel, /返回厂商列表/);
  assert.match(settingsPanel, /<ProviderCard item=\{selectedProvider\}/);
  assert.doesNotMatch(settingsPanel, /controller\.(add|edit|delete)Provider/);
  assert.doesNotMatch(settingsFeature, /addProvider|editProvider|deleteProvider|ProviderConnectionDialog|getConfiguredProviders|getProviderDefinition/);
  assert.equal(existsSync(new URL('../renderer/src/app/views/ProviderConnectionDialog.tsx', import.meta.url)), false);
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
  assert.match(settingsStyles, /\.provider-incomplete i \{ background: #c9c4be/);
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
