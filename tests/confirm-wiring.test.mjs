/**
 * 确认服务必须真的接到 antd Modal 上，并且适配器/窗口关闭守卫不再回退原生 confirm。
 */
import assert from 'node:assert/strict';

import test from 'node:test';
import { readSource } from './helpers/sourceContract.mjs';

const host = readSource('renderer/src/app/ui/confirm/ConfirmHost.tsx');
const service = readSource('renderer/src/app/ui/confirm/confirmService.ts');
const workbench = readSource('renderer/src/app/ReactWorkbench.tsx');
const library = readSource('renderer/src/app/adapters/projectLibraryAdapter.ts');
const canvas = readSource('renderer/src/app/adapters/canvasAdapter.ts');
const closeGuard = readSource('renderer/src/app/windowCloseGuard.ts');
const gate = readSource('scripts/verify-ui-components.mjs');

test('ConfirmHost 把 antd modal.confirm 注册给服务', () => {
  assert.match(host, /App\.useApp\(\)/);
  assert.match(host, /registerConfirmHandler/);
  assert.match(host, /modal\.confirm\(/);
  assert.match(workbench, /<ConfirmHost \/>/);
  assert.match(service, /Promise\.resolve\(false\)/, '宿主未挂载时必须拒绝');
});

test('适配器与窗口关闭守卫走确认服务而不是原生 confirm', () => {
  for (const [name, source] of [
    ['projectLibraryAdapter', library],
    ['canvasAdapter', canvas],
    ['windowCloseGuard', closeGuard],
  ]) {
    assert.match(source, /confirmAction/, `${name} 必须使用 confirmAction`);
    assert.doesNotMatch(source, /window\.confirm\s*\(/, `${name} 不得再用原生 confirm`);
  }
  assert.ok(gate.includes('window.confirm') && gate.includes('confirmService'), '门禁必须禁止原生 confirm');
});
