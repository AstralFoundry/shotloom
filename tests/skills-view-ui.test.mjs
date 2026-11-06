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
  assert.match(appStore, /PROJECT_FREE_ROUTES = new Set<AppRoute>\(\["projects", "skills", "workflows"\]\)/);
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
  assert.match(skillsView, /<Drawer[\s\S]*?placement="right"/);
  assert.match(skillsView, /rootClassName="skills-drawer"/);
  assert.match(skillsView, /size=\{720\}/);
  assert.match(skillsView, /<SkillEditorPanel/);
  assert.match(skillsStyles, /\.skills-list-pane \{[^}]*flex: 1 1 auto/);
  // 内容区自己已经有一层边框，清单不再套第二张卡片。
  assert.doesNotMatch(skillsStyles, /\.skills-list-pane \{[^}]*border:/);
  // 抽屉外壳交给 antd，只保留产品自己的边框、圆角和 4px 窗框间距。
  assert.match(skillsStyles, /\.skills-drawer \.ant-drawer-section \{[\s\S]*?border-radius: var\(--workbench-radius\)/);
  assert.match(skillsStyles, /\.skills-drawer \.ant-drawer-content-wrapper \{[\s\S]*?padding: 4px 0 4px 4px/);
  assert.doesNotMatch(skillsStyles, /\.skills-drawer \.ant-drawer-section \{[^}]*box-shadow/);
  assert.match(skillsView, /mask: \{ background: "var\(--scrim-modal\)"/);
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
  assert.match(skillsFeature, /function confirmDiscard\(action: \(\) => void\)/);
  assert.match(skillsFeature, /modal\.confirm\(\{\s*title:/);
  assert.match(skillsFeature, /confirmDiscard\(\(\) => \{\s*const item = readSkills\(\)/);
  assert.match(skillsFeature, /confirmDiscard\(\(\) => \{\s*const draft = createSkillDraft/);
  // 确认对话框不能放在 run 的成功分支里，否则用户取消也会提示已恢复默认。
  const resetBody = skillsFeature.split('function resetOpenSkill()')[1].split('\n  }')[0];
  assert.ok(resetBody.includes('modal.confirm'), resetBody);
  assert.ok(resetBody.indexOf('modal.confirm') < resetBody.indexOf('run('), resetBody);
});

test('抽屉三条关闭路径都在，且 Esc 不会静默丢掉草稿', () => {
  // Drawer 本身负责 Esc、遮罩点击和焦点陷阱，统一走 onClose → controller.close()；
  // close() 在 SkillsFeature 里先过 confirmDiscard，不会静默丢草稿。
  assert.match(skillsView, /onClose=\{\(\) => controller\.close\(\)\}/);
  assert.doesNotMatch(skillsView, /keyboard=\{false\}|maskClosable=\{false\}/);
  assert.match(editorPanel, /onClick=\{controller\.close\}/);
  assert.match(skillsFeature, /function confirmDiscard\(action: \(\) => void\)/);
  assert.match(skillsFeature, /modal\.confirm\(\{/);
});

test('抽屉关闭交给 antd 动画，退出期间保留最后一份草稿', () => {
  assert.match(skillsView, /afterOpenChange=\{\(open\) => \{\s*if \(!open\) setCachedEditor\(null\);/);
  assert.match(skillsView, /const editor = data\.editor \?\? cachedEditor;/);
  assert.doesNotMatch(skillsView, /DRAWER_EXIT_MS/);
  assert.doesNotMatch(skillsView, /skills-drawer-backdrop/);
  assert.doesNotMatch(skillsStyles, /@keyframes skills-drawer-in/);
});

test('技能不再住在设置弹窗里', () => {
  assert.doesNotMatch(settingsPanel, /"skills"/);
  assert.doesNotMatch(settingsPanel, /skill/i);
  assert.doesNotMatch(settingsFeature, /skillsStore|SkillEditor|upsertSkill|loadGlobalSkills/);
  assert.equal(sourceExists('renderer/src/app/views/CatalogEditorDialogs.tsx'), false);
});
