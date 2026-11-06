/**
 * P2 输入控件统一：搜索框共用 SearchInput，筛选与分档用 Segmented，
 * 厂商凭据与技能编辑字段用 antd Input / Input.Password / Input.TextArea。
 */
import assert from 'node:assert/strict';

import test from 'node:test';
import { readSource } from './helpers/sourceContract.mjs';

const searchInput = readSource('renderer/src/app/components/SearchInput.tsx');
const skills = readSource('renderer/src/app/views/SkillsView.tsx');
const tasks = readSource('renderer/src/app/views/TasksView.tsx');
const materials = readSource('renderer/src/app/views/MaterialsView.tsx');
const assets = readSource('renderer/src/app/views/AssetsView.tsx');
const projects = readSource('renderer/src/app/views/ProjectsView.tsx');
const creation = readSource('renderer/src/app/views/CreationView.tsx');
const settings = readSource('renderer/src/app/views/SettingsPanel.tsx');
const skillEditor = readSource('renderer/src/app/views/SkillEditorPanel.tsx');
const gate = readSource('scripts/verify-ui-components.mjs');

test('搜索框统一走 SearchInput，带图标前缀与清空按钮', () => {
  assert.match(searchInput, /allowClear/);
  assert.match(searchInput, /prefix=\{<IconSymbol name="search" \/>\}/);
  assert.match(searchInput, /aria-label=\{ariaLabel \?\? placeholder\}/);

  for (const [name, source] of [
    ['SkillsView', skills],
    ['TasksView', tasks],
    ['MaterialsView', materials],
    ['AssetsView', assets],
    ['ProjectsView', projects],
    ['CreationView', creation],
  ]) {
    assert.match(source, /<SearchInput/, `${name} 必须使用 SearchInput`);
    assert.doesNotMatch(source, /type="search"/, `${name} 不得再手写搜索 input`);
  }
});

test('筛选与分档使用 Segmented', () => {
  assert.match(tasks, /<Segmented[\s\S]*?className="task-filter"[\s\S]*?options=\{filters\.map/);
  assert.match(tasks, /disabled: !filter\.count && filterKey !== filter\.key/);
  assert.match(creation, /<Segmented[\s\S]*?className="canvas-material-tabs"/);
  assert.doesNotMatch(creation, /role="tablist"/, '素材分档不再手写 tablist');
});

test('厂商凭据与技能字段使用 antd 输入组件', () => {
  assert.match(settings, /<Input\.Password[\s\S]*?onPressEnter=\{\(e\) => e\.currentTarget\.blur\(\)\}/);
  assert.match(settings, /<Input[\s\S]*?value=\{draft\.baseUrl\}/);
  assert.match(skillEditor, /<Input\.TextArea/);
  assert.match(skillEditor, /<Input[\s\S]*?value=\{draft\.id\}/);
  assert.doesNotMatch(skillEditor, /<input\b|<textarea\b/);
});

test('门禁拒绝原生搜索与密码输入', () => {
  assert.ok(gate.includes('search|password'), '门禁必须覆盖 search/password');
  assert.ok(gate.includes('components/SearchInput'));
  assert.ok(gate.includes('antd Input.Password'));
});

test('取色、范围分档与空态也走组件库', () => {
  const watermark = readSource('renderer/src/app/components/ImageWatermarkEditor.tsx');
  assert.match(watermark, /<ColorPicker[\s\S]*?onChange=\{\(color\) => update\(\{ color: color\.toHexString\(\) \}\)\}/);
  assert.doesNotMatch(watermark, /type="color"/);

  assert.match(assets, /<Segmented[\s\S]*?className="asset-scope-tabs"/);
  assert.doesNotMatch(assets, /role="tablist"/);

  assert.match(skills, /<Empty[\s\S]*?className="skills-empty"/);
  assert.doesNotMatch(skills, /className="skills-empty">\{/);
});
