/**
 * 设置页的字段只有一套外观：资产下载路径的原生输入框是基准，
 * 下拉、数字输入必须复用同一档高度、圆角、边框和字号，避免 antd 默认值把表单拉成两种密度。
 */
import assert from 'node:assert/strict';

import test from 'node:test';
import { readSource } from './helpers/sourceContract.mjs';

const styles = readSource('renderer/styles/settings.css');

test('设置页的下拉与数字输入沿用资产下载路径的字段外观', () => {
  const field = styles.match(/\.settings-row \.ant-select,\n\.settings-row \.ant-input-number \{[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(field, '缺少设置页 Select / InputNumber 的字段规则');
  assert.match(field, /height: 34px;/);
  assert.match(field, /padding: 0 10px;/);
  assert.match(field, /border: 1px solid var\(--line-strong\);/);
  assert.match(field, /border-radius: var\(--radius-sm\);/);
  assert.match(field, /font-size: var\(--text-body-13\);/);
  assert.match(field, /background: var\(--surface\);/);

  const input = styles.match(/\.settings-control-wide input \{[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(input, '缺少资产下载路径输入框规则');
  // 基准字段自己也要落在同一档，否则“跟随资产下载路径”只是口号。
  assert.match(input, /height: 34px;/);
  assert.match(input, /border-radius: var\(--radius-sm\);/);
  assert.match(input, /border: 1px solid var\(--line-strong\);/);
});

test('设置页字段的文字在 34px 高度里垂直居中', () => {
  assert.match(styles, /\.settings-row \.ant-select \{ align-items: center; \}/);
  assert.match(styles, /\.settings-row \.ant-select \.ant-select-content \{[\s\S]*?display: flex;[\s\S]*?align-items: center;/);
  assert.match(styles, /\.settings-row \.ant-input-number \{ align-items: center; \}/);
});

test('设置页控件在深浅主题下都从 tokens 取色', () => {
  const field = styles.match(/\.settings-row \.ant-select,\n\.settings-row \.ant-input-number \{[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(field, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, '字段规则不得写颜色字面量');
  assert.match(styles, /\.settings-row \.ant-select-disabled,\n\.settings-row \.ant-input-number-disabled \{[\s\S]*?background: var\(--surface-muted\)/);
});
