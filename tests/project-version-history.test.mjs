/**
 * 版本记录界面：入口接线、预览只读、恢复必须确认、文案齐全。
 * 交互本身由组件负责，这里锁定「预览不写 store、恢复走确认后再替换」这两条边界。
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from './helpers/sourceContract.mjs';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

const component = readSource('renderer/src/app/components/ProjectVersionHistory.tsx');
const bottomBar = readSource('renderer/src/app/canvas/BottomModeBar.tsx');
const creationView = readSource('renderer/src/app/views/CreationView.tsx');
const policy = readSource('renderer/src/domain/snapshots/SnapshotPolicy.ts');
const zh = JSON.parse(readSource('renderer/src/i18n/locales/zh-CN.json'));
const en = JSON.parse(readSource('renderer/src/i18n/locales/en-US.json'));

let env;
let service;
let store;
let policyModule;

before(async () => {
  env = await createRendererEnv({ storage: new Map(), withWindow: true });
  service = await env.load('services/projectSnapshotService');
  ({ store } = await env.load('store/projectStore'));
  policyModule = await env.load('domain/snapshots/SnapshotPolicy');
});

after(async () => {
  await env?.dispose();
});

test('画布底栏提供版本记录入口，并挂载抽屉', () => {
  assert.match(bottomBar, /onOpenHistory\?: \(\) => void/);
  assert.match(bottomBar, /onClick=\{onOpenHistory\}/);
  assert.match(creationView, /<ProjectVersionHistory[\s\S]*?open=\{versionHistoryOpen\}/);
  assert.match(creationView, /onOpenHistory=\{\(\) => setVersionHistoryOpen\(true\)\}/);
});

test('预览只读：读取快照不修改当前项目，恢复只在确认回调里调用', () => {
  // 预览路径只调用 readProjectSnapshot + snapshotPreview，不碰 store.project。
  assert.match(component, /readProjectSnapshot\(store\.projectDir, selectedId\)/);
  assert.match(component, /snapshotPreview\(payload\)/);
  assert.doesNotMatch(component, /store\.project\s*=/);
  assert.doesNotMatch(component, /touchProject/);
  // 恢复必须经过 modal.confirm，再调用 restoreProjectFromSnapshot。
  assert.match(component, /modal\.confirm\(\{/);
  assert.match(component, /restoreProjectFromSnapshot\(snapshotId\)/);
  const confirmIndex = component.indexOf('modal.confirm(');
  const restoreIndex = component.indexOf('restoreProjectFromSnapshot(');
  assert.ok(confirmIndex > 0 && restoreIndex > confirmIndex, '恢复调用必须位于确认之后');
});

test('快照预览是纯函数：截断到 50 个节点且不改变源数据', () => {
  const payload = {
    name: '测试',
    nodes: Array.from({ length: 60 }, (_, index) => ({ id: `n${index}`, title: `节点${index}`, type: 'textGeneration' })),
    edges: [{ id: 'e1' }],
  };
  const before = JSON.stringify(payload);
  const preview = policyModule.snapshotPreview(payload);

  assert.equal(preview.nodeCount, 60);
  assert.equal(preview.edgeCount, 1);
  assert.equal(preview.nodes.length, 50);
  assert.equal(preview.truncated, true);
  assert.deepEqual(preview.nodes[0], { id: 'n0', title: '节点0', type: 'textGeneration' });
  assert.equal(JSON.stringify(payload), before, '预览不得改动源数据');
  assert.match(policy, /nodes\.slice\(0, 50\)/);
});

test('读取快照后当前项目完全不变', async () => {
  const directory = 'browser/projects/version-history-test';
  const snapshot = await service.captureProjectSnapshot(
    directory,
    { name: '旧版本', nodes: [{ id: 'old' }], edges: [], tasks: [] },
    { reason: 'manual', force: true },
  );
  assert.ok(snapshot);

  store.project = {
    ...store.project,
    id: 'current-project',
    nodes: [{ id: 'current' }],
    edges: [],
    tasks: [],
  };
  const before = JSON.stringify(store.project);
  const payload = await service.readProjectSnapshot(directory, snapshot.id);

  assert.deepEqual(payload.nodes, [{ id: 'old' }]);
  assert.equal(JSON.stringify(store.project), before, '预览读取不影响当前项目');
});

test('版本记录文案在中英文都存在且参数一致', () => {
  const keys = Object.keys(zh).filter((key) => key.startsWith('project.version.'));
  assert.ok(keys.length >= 15, `版本记录文案过少：${keys.length}`);
  for (const key of keys) {
    assert.ok(key in en, `英文缺少 ${key}`);
    const zhParams = [...zh[key].matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]).sort();
    const enParams = [...en[key].matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]).sort();
    assert.deepEqual(enParams, zhParams, `${key} 的参数不一致`);
  }
});
