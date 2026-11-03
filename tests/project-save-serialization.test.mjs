/**
 * 存储契约：同一个工程的写入必须全部从 projectSaveQueue 串行发出。
 * 旁路调用 desktopApi.project.save 会与自动保存交错提交，后发的旧快照带着上一次的
 * storageRevision 撞上后端乐观锁（src-tauri/src/crud/project_crud.rs 的 save），
 * 于是同一个窗口也会收到「工程已被另一窗口修改」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from './helpers/sourceContract.mjs';

const source = readSource('renderer/src/store/projectStore.ts');
const queueAt = source.indexOf('new LatestSaveQueue(');
const helperAt = source.indexOf('function saveProjectSerialized(');

test('projectStore 的工程写入只保留保存队列一个出口', () => {
  assert.ok(queueAt > 0, '应存在 projectSaveQueue 定义');
  assert.ok(helperAt > queueAt, '应存在 saveProjectSerialized 统一写入入口');
  const calls = [...source.matchAll(/desktopApi\.project\.save\(/g)];
  assert.equal(calls.length, 1, `desktopApi.project.save 只应出现在队列回调里，实际 ${calls.length} 次`);
  assert.ok(calls[0].index > queueAt && calls[0].index < helperAt,
    '唯一的 desktopApi.project.save 调用必须位于 projectSaveQueue 回调内');
});

test('新建、克隆与素材恢复写入都改走串行入口', () => {
  const serializedCalls = [...source.matchAll(/saveProjectSerialized\(/g)].length;
  assert.ok(serializedCalls >= 4, `统一写入入口应覆盖队列定义与三处调用，实际 ${serializedCalls} 次`);
});
