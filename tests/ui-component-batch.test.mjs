/**
 * 第三批组件库迁移：右键菜单、重命名/分类弹窗、技能抽屉、会话历史。
 * 这里锁住"不再自己实现遮罩、定位和点外关闭"的结构，视觉细节交给浏览器冒烟。
 */
import assert from 'node:assert/strict';

import test from 'node:test';
import { readSource } from './helpers/sourceContract.mjs';

const contextMenu = readSource('renderer/src/app/components/ContextMenu.tsx');
const assets = readSource('renderer/src/app/views/AssetsView.tsx');
const materials = readSource('renderer/src/app/views/MaterialsView.tsx');
const tasks = readSource('renderer/src/app/views/TasksView.tsx');
const skills = readSource('renderer/src/app/views/SkillsView.tsx');
const skillsFeature = readSource('renderer/src/app/views/SkillsFeature.tsx');
const creation = readSource('renderer/src/app/views/CreationView.tsx');
const harness = readSource('renderer/src/app/agent-chat/HarnessSessionToolbar.tsx');
const uiGate = readSource('scripts/verify-ui-components.mjs');

test('三处右键菜单复用同一个 Dropdown 锚点', () => {
  assert.match(contextMenu, /<Dropdown[\s\S]*?open=\{Boolean\(point\)\}/);
  assert.match(contextMenu, /className="context-menu-anchor"/);
  assert.match(contextMenu, /onOpenChange=\{\(open\) => \{[\s\S]*?if \(!open\) onClose\(\)/);

  for (const [name, source] of [['AssetsView', assets], ['MaterialsView', materials], ['TasksView', tasks]]) {
    assert.match(source, /<ContextMenu/, `${name} 必须复用 ContextMenu`);
    assert.doesNotMatch(source, /className="(?:resource|task)-context-menu"/, `${name} 不得再手写菜单容器`);
    assert.doesNotMatch(source, /window\.innerWidth - 202/, `${name} 不得再手工钳制菜单边缘`);
  }
});

test('素材重命名与分类选择改用 Modal，不再手写遮罩', () => {
  for (const [name, source] of [['AssetsView', assets], ['MaterialsView', materials]]) {
    assert.match(source, /<Modal[\s\S]*?open=\{Boolean\(renameItem\)\}/, `${name} 重命名必须是 Modal`);
    assert.match(source, /<Input[\s\S]*?ref=\{renameInput\}/, `${name} 重命名必须用 antd Input`);
    assert.doesNotMatch(source, /className="rename-backdrop"/, `${name} 不得手写重命名遮罩`);
  }
  assert.match(materials, /<Modal[\s\S]*?open=\{Boolean\(libraryItem\)\}/);
  assert.match(materials, /className="library-picker-body"/);
  assert.doesNotMatch(materials, /className="library-picker-backdrop"/);
});

test('技能抽屉与会话历史交给 antd 弹层', () => {
  assert.match(skills, /<Drawer[\s\S]*?placement="right"/);
  assert.match(skills, /rootClassName="skills-drawer"/);
  assert.match(skills, /onClose=\{\(\) => controller\.close\(\)\}/);
  assert.doesNotMatch(skills, /createPortal/, '抽屉不得再直接 portal 到 body');
  assert.doesNotMatch(skills, /DRAWER_EXIT_MS/, '退出动画交给 Drawer');

  assert.match(harness, /<Dropdown/);
  assert.match(harness, /classNames=\{\{ root: "harness-session-dropdown" \}\}/);
  assert.doesNotMatch(harness, /<details/, '会话历史不得再用 details');
});

test('视图层的确认统一走 App.useApp().modal.confirm', () => {
  for (const [name, source] of [
    ['AssetsView', assets],
    ['MaterialsView', materials],
    ['TasksView', tasks],
    ['SkillsFeature', skillsFeature],
    ['CreationView', creation],
  ]) {
    assert.doesNotMatch(source, /window\.confirm/, `${name} 不得再用原生 confirm`);
    assert.match(source, /modal\.confirm\(/, `${name} 必须使用 modal.confirm`);
  }
  assert.match(assets, /const \{ modal \} = App\.useApp\(\)/);
  assert.match(skillsFeature, /const \{ modal \} = App\.useApp\(\)/);
});

test('门禁覆盖手写遮罩和菜单', () => {
  assert.match(uiGate, /HANDWRITTEN_BACKDROP_EXCEPTIONS/);
  assert.match(uiGate, /HANDWRITTEN_MENU_EXCEPTIONS/);
  assert.match(uiGate, /出现手写遮罩类名/);
  assert.match(uiGate, /手写 role="menu"/);
});
