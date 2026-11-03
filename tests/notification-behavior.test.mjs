import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env;
let api;
let state;
before(async () => {
  env = await createRendererEnv({ withWindow: true });
  api = await env.load('store/notificationStore');
  state = api.useNotificationStore;
});
after(async () => { await env.dispose(); });
beforeEach(() => { state.setState({ toasts: [], messages: [] }); });

test('连续提示不互相覆盖，关闭一条不影响其他消息', () => {
  api.showSuccessToast('项目已保存');
  api.showToast('请先选择节点');
  api.showToast('远端仍在运行', 'warning');
  const items = state.getState().toasts;
  assert.equal(items.length, 3);
  assert.equal(items[0].tone, 'success');
  assert.ok(items[0].duration > 0);
  assert.equal(items[2].duration, 0, '警告须主动关闭');
  state.getState().dismissToast(items[1].id);
  assert.deepEqual(state.getState().toasts.map(item => item.message), ['项目已保存', '远端仍在运行']);
});

test('重要错误排队保留完整原因，轻提示不覆盖消息弹窗', () => {
  api.showErrorMessage('磁盘写入失败\n请检查目录权限', '项目保存失败');
  api.showMessage('导入未完成', { tone: 'warning', details: 'file-a.png: not found' });
  api.showToast('已复制');
  assert.equal(state.getState().messages.length, 2);
  assert.equal(state.getState().messages[0].message, '磁盘写入失败\n请检查目录权限');
  const id = state.getState().messages[0].id;
  state.getState().dismissMessage(id);
  assert.equal(state.getState().messages[0].details, 'file-a.png: not found');
  state.getState().dismissMessage(id); // 过期关闭不能清掉下一条
  assert.equal(state.getState().messages.length, 1);
});

test('忽略空消息并合并相同未关闭通知', () => {
  api.showToast('  ');
  api.showErrorMessage('');
  api.showToast('已保存');
  api.showToast('已保存');
  api.showErrorMessage('自动保存失败');
  api.showErrorMessage('自动保存失败');
  assert.equal(state.getState().toasts.length, 1);
  assert.equal(state.getState().messages.length, 1);
  state.getState().dismissMessage(state.getState().messages[0].id);
  api.showErrorMessage('自动保存失败');
  assert.equal(state.getState().messages.length, 1, '关闭后再次发生仍应提醒');
});
