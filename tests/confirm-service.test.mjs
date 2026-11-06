/**
 * 非 React 模块通过 confirmService 请求确认；宿主未挂载时拒绝危险动作，
 * 不让删除/覆盖类操作绕过确认。
 */
import assert from 'node:assert/strict';

import test from 'node:test';
import { confirmAction, registerConfirmHandler } from '../renderer/src/app/ui/confirm/confirmService.ts';

test('确认宿主未注册时默认拒绝', async () => {
  assert.equal(await confirmAction({ title: '删除项目？' }), false);
});

test('注册后把请求交给宿主，并能返回确认/取消', async () => {
  const requests = [];
  const dispose = registerConfirmHandler(async (request) => {
    requests.push(request);
    return request.title === '允许';
  });
  try {
    assert.equal(await confirmAction({ title: '允许', danger: true }), true);
    assert.equal(await confirmAction({ title: '拒绝' }), false);
    assert.deepEqual(requests, [
      { title: '允许', danger: true },
      { title: '拒绝' },
    ]);
  } finally {
    dispose();
  }
  assert.equal(await confirmAction({ title: '卸载后' }), false);
});
