import test from 'node:test';
import assert from 'node:assert/strict';
import { readLocalizedSource as readSource, sourceExists } from './helpers/sourceContract.mjs';

const sidebar = readSource('renderer/src/app/layout/SideBar.tsx');
const navigation = readSource('renderer/src/app/constants/navigation.ts');
const appStore = readSource('renderer/src/app/store/appStore.ts');
const projectNavigation = readSource('renderer/src/utils/projectNavigation.ts');
const workbench = readSource('renderer/src/app/ReactWorkbench.tsx');
const skillsView = readSource('renderer/src/app/views/SkillsView.tsx');
const skillsFeature = readSource('renderer/src/app/views/SkillsFeature.tsx');
const editorPanel = readSource('renderer/src/app/views/SkillEditorPanel.tsx');
const settingsPanel = readSource('renderer/src/app/views/SettingsPanel.tsx');
const settingsFeature = readSource('renderer/src/app/views/SettingsFeature.tsx');
const skillsStyles = readSource('renderer/styles/skills.css');
const tokenStyles = readSource('renderer/styles/tokens.css');

test('技能是应用级路由，未打开工程也能进入且能被恢复', () => {
  assert.match(projectNavigation, /APPLICATION_ROUTES = new Set\(\['projects', 'skills', \.\.\.PROJECT_WORKSPACE_ROUTES\]\)/);
  // 技能目录不隶属工程，因此不能进工作区路由集合，否则恢复路由时会被弹回项目库。
  assert.doesNotMatch(projectNavigation, /PROJECT_WORKSPACE_ROUTES = new Set\(\[[^\]]*'skills'/);
  assert.match(appStore, /PROJECT_FREE_ROUTES = new Set<AppRoute>\(\["projects", "skills"\]\)/);
  assert.match(appStore, /if \(!PROJECT_FREE_ROUTES\.has\(route\) && !get\(\)\.currentProject\) return false;/);
  assert.match(workbench, /APPLICATION_ROUTES\.has\(route\)/);
  assert.doesNotMatch(workbench, /\["projects", "creation", "tasks", "assets", "materials"\]/);
  assert.match(workbench, /appRoute === "skills"[\s\S]*<SkillsFeature \/>/);
});

test('技能入口常驻侧栏且与工程入口分开成组', () => {
  assert.match(navigation, /export const applicationItems: NavigationItem\[\] = \[\s*\{\s*id: "skills"/);
  assert.match(sidebar, /\{projectScopedNavigation\}\s*\{applicationNavigation\}/);
  assert.match(sidebar, /route === "projects" \|\| route === "skills"/);
  assert.match(sidebar, /className=\{`side-item\$\{route === item\.id \? " active" : ""\}\`/);
});

test('技能清单占满内容区，编辑与新建从右侧抽屉覆盖', () => {
  assert.match(skillsView, /className="skills-workspace"/);
  assert.match(skillsView, /className="skills-list-pane"/);
  assert.match(skillsView, /className=\{`skills-drawer-backdrop/);
  assert.match(skillsView, /<SkillEditorPanel/);
  assert.match(skillsStyles, /\.skills-list-pane \{[^}]*flex: 1 1 auto/);
  // 内容区自己已经有一层边框，清单不再套第二张卡片。
  assert.doesNotMatch(skillsStyles, /\.skills-list-pane \{[^}]*border:/);
  assert.doesNotMatch(skillsStyles, /\.skills-drawer-backdrop \{[^}]*border-radius/);
  // 抽屉挂到 body 并盖住整个窗口：内容区自己有 isolation，绝对定位盖不到侧栏。
  assert.match(skillsView, /createPortal\(/);
  assert.match(skillsView, /document\.body,/);
  assert.match(skillsStyles, /\.skills-drawer-backdrop \{[^}]*position: fixed;[^}]*inset: 0/);
  assert.match(skillsStyles, /z-index: var\(--layer-overlay\)/);
  // 抽屉不贴死窗口边框，但间距只沿用窗体自己的 4px 边框，且不带阴影。
  assert.match(skillsStyles, /\.skills-drawer-backdrop \{[^}]*padding: 4px 4px 4px 0/);
  assert.doesNotMatch(skillsStyles, /\.skills-drawer \{[^}]*box-shadow/);
  assert.match(skillsStyles, /\.skills-drawer \{[^}]*border-radius: var\(--workbench-radius\)/);
  // 抽屉要整块从屏外推回来；只挪一点再淡入会被读成弹窗跳出。
  assert.match(skillsStyles, /@keyframes skills-drawer-in \{\s*from \{ transform: translateX\(calc\(100% \+ 4px\)\); \}/);
  const drawerKeyframes = skillsStyles.match(/@keyframes skills-drawer-in \{[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(drawerKeyframes, /opacity/);
  assert.match(skillsStyles, /background: var\(--scrim-modal\)/);
  assert.match(skillsStyles, /\.skills-drawer \{[^}]*height: 100%/);
  // 抽屉正文随窗口高度滚动，字段本身不能被 Flex 压缩裁切。
  assert.match(skillsStyles, /\.skill-editor-body \{[^}]*flex: 1 1 auto[^}]*overflow-y: auto/);
  assert.match(skillsStyles, /\.skill-editor-body > \* \{ flex-shrink: 0; \}/);
  assert.match(skillsStyles, /\.skill-editor-head \{[^}]*flex: 0 0 auto/);
});

test('编辑面板保存前校验必填字段，内置技能只提示覆盖范围', () => {
  for (const message of [
    'ID 仅允许小写字母、数字和连字符，且首尾不能是连字符',
    '名称不能为空',
    '用途说明不能为空',
    '技能指令不能为空',
  ]) {
    assert.ok(editorPanel.includes(`"${message}"`) || editorPanel.includes(message), message);
  }
  assert.match(editorPanel, /if \(!draft\.instructions\.trim\(\)\)/);
  assert.match(editorPanel, /controller\.save\(draft\)/);
  assert.match(editorPanel, /modifiedFields\.length > 0 && \(\s*<button type="button" onClick=\{controller\.reset\}/);
});

test('切换或新建技能前先保住未保存的草稿', () => {
  assert.match(skillsFeature, /const dirty = Boolean\(open && JSON\.stringify\(open\.draft\) !== open\.baseline\)/);
  assert.match(skillsFeature, /const discardGuard = \(\) => !dirty \|\| window\.confirm/);
  assert.match(skillsFeature, /if \(open\?\.draft\.id === id \|\| !discardGuard\(\)\) return;/);
  assert.match(skillsFeature, /if \(!discardGuard\(\)\) return;/);
  // 确认对话框不能放在 run 的成功分支里，否则用户取消也会提示已恢复默认。
  const resetBody = skillsFeature.split('function resetOpenSkill()')[1].split('\n  }')[0];
  assert.ok(resetBody.includes('window.confirm'), resetBody);
  assert.ok(resetBody.indexOf('window.confirm') < resetBody.indexOf('void run('), resetBody);
});

test('抽屉三条关闭路径都在，且 Esc 不会静默丢掉草稿', () => {
  assert.match(skillsView, /if \(event\.key !== "Escape"\) return;/);
  assert.match(skillsView, /controller\.close\(\)/);
  // 监听器必须跟着当次渲染的 controller 走，否则脏状态是旧值。
  assert.match(skillsView, /\[data\.editor, controller\]/);
  assert.match(editorPanel, /onClick=\{controller\.close\}/);
  assert.match(skillsView, /event\.target === event\.currentTarget && controller\.close\(\)/);
});

test('抽屉关闭要先播退出帧再卸载，且退出中不能有一帧空档', () => {
  // CSS 的 animation 只在挂载时跑入场帧，直接卸载就是"啪"地消失。
  assert.match(skillsView, /const DRAWER_EXIT_MS = (\d+);/);
  // 退出状态必须在同一次渲染里算出来：用 state 记会先卸载一帧再挂回来，那一帧就是闪烁。
  assert.match(skillsView, /const drawer = data\.editor \?\? lastEditor\.current;/);
  assert.match(skillsView, /const drawerExiting = Boolean\(drawer\) && !data\.editor;/);
  assert.doesNotMatch(skillsView, /setDrawerExiting/);
  assert.match(skillsView, /skills-drawer-backdrop\$\{drawerExiting \? " closing" : ""\}/);
  assert.match(skillsView, /skills-drawer\$\{drawerExiting \? " closing" : ""\}/);
  assert.match(skillsStyles, /\.skills-drawer\.closing \{ animation: skills-drawer-out var\(--duration-slow\)[^}]*forwards/);
  assert.match(skillsStyles, /\.skills-drawer-backdrop\.closing \{ animation: skills-scrim-out var\(--duration-slow\)[^}]*forwards/);
  assert.match(skillsStyles, /@keyframes skills-drawer-out \{\s*from \{ transform: translateX\(0\); \}\s*to \{ transform: translateX\(calc\(100% \+ 4px\)\); \}/);
  // 保留窗口必须盖过退出动画，否则动画被卸载拦腰截断。
  const exitMs = Number(skillsView.match(/const DRAWER_EXIT_MS = (\d+);/)[1]);
  const slowMs = Number(tokenStyles.match(/--duration-slow: (\d+)ms/)[1]);
  assert.ok(exitMs > slowMs, `DRAWER_EXIT_MS ${exitMs} 必须大于退出动画 ${slowMs}ms`);
  // 关掉动效时不能白等这段保留时间。
  assert.match(skillsView, /prefers-reduced-motion: reduce/);
});

test('技能不再住在设置弹窗里', () => {
  assert.doesNotMatch(settingsPanel, /"skills"/);
  assert.doesNotMatch(settingsPanel, /skill/i);
  assert.doesNotMatch(settingsFeature, /skillsStore|SkillEditor|upsertSkill|loadGlobalSkills/);
  assert.equal(sourceExists('renderer/src/app/views/CatalogEditorDialogs.tsx'), false);
});
