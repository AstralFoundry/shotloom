/**
 * 画布快照：策略决定何时写、写什么，服务在真实 desktopApi（浏览器替身）上跑通读写。
 */
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env;
let policy;
let service;

const storage = new Map();
const DIRECTORY = 'browser/projects/snapshot-test';

before(async () => {
  env = await createRendererEnv({ storage, withWindow: true });
  policy = await env.load('domain/snapshots/SnapshotPolicy');
  service = await env.load('services/projectSnapshotService');
});

beforeEach(() => {
  service.resetProjectSnapshotCache();
  storage.clear();
});

after(async () => {
  await env?.dispose();
});

function projectFixture(nodes = [{ id: 'n1', type: 'textGeneration' }]) {
  return {
    name: '测试项目',
    nodes,
    edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    tasks: [],
    canvasHistory: [{ label: 'undo', nodes: [{ id: 'n1' }] }],
    selectedNodeId: 'n1',
    selectedNodeIds: ['n1'],
    viewport: { x: 10, y: 20, zoom: 1 },
  };
}

test('快照 payload 去掉本机界面状态，且不与被保存对象共享引用', () => {
  const source = projectFixture();
  const payload = policy.snapshotPayload(source);

  assert.deepEqual(payload.nodes, source.nodes);
  assert.equal('canvasHistory' in payload, false);
  assert.equal('selectedNodeId' in payload, false);
  assert.equal('selectedNodeIds' in payload, false);
  assert.equal('viewport' in payload, false);

  source.nodes.push({ id: 'n2' });
  assert.equal(payload.nodes.length, 1);
});

test('策略：内容相同跳过、5 分钟内节流、超时后写入、强制写入', () => {
  const now = Date.parse('2026-11-06T10:00:00.000Z');
  const previous = { createdAt: '2026-11-06T09:58:00.000Z', contentHash: 'hash-a' };

  assert.deepEqual(
    policy.decideSnapshot({ reason: 'auto', now, previous: null, hash: 'hash-a', bytes: 10 }),
    { action: 'create', degraded: false },
  );
  assert.deepEqual(
    policy.decideSnapshot({ reason: 'auto', now, previous, hash: 'hash-a', bytes: 10 }),
    { action: 'skip', reason: 'unchanged' },
  );
  assert.deepEqual(
    policy.decideSnapshot({ reason: 'auto', now, previous, hash: 'hash-b', bytes: 10 }),
    { action: 'skip', reason: 'throttled' },
  );
  assert.deepEqual(
    policy.decideSnapshot({ reason: 'auto', now, previous: { createdAt: '2026-11-06T09:50:00.000Z', contentHash: 'hash-a' }, hash: 'hash-b', bytes: 10 }),
    { action: 'create', degraded: false },
  );
  assert.deepEqual(
    policy.decideSnapshot({ reason: 'manual', now, previous, hash: 'hash-b', bytes: 10 }),
    { action: 'create', degraded: false },
  );
});

test('策略：超过单份体积上限时降级为元数据', () => {
  const decision = policy.decideSnapshot({
    reason: 'auto',
    now: Date.parse('2026-11-06T10:00:00.000Z'),
    previous: null,
    hash: 'hash-big',
    bytes: policy.SNAPSHOT_MAX_PAYLOAD_BYTES + 1,
  });
  assert.deepEqual(decision, { action: 'create', degraded: true });
});

test('服务：首次保存写入快照，内容重复不再写，强制保存新增一份', async () => {
  const first = await service.captureProjectSnapshot(DIRECTORY, projectFixture());
  assert.ok(first, '首次快照应写入');
  assert.equal(first.degraded, false);

  const listAfterFirst = await service.listProjectSnapshots(DIRECTORY);
  assert.equal(listAfterFirst.length, 1);
  assert.equal(listAfterFirst[0].id, first.id);

  const duplicate = await service.captureProjectSnapshot(DIRECTORY, projectFixture());
  assert.equal(duplicate, null, '内容相同不重复写入');
  assert.equal((await service.listProjectSnapshots(DIRECTORY)).length, 1);

  const changed = projectFixture([{ id: 'n1' }, { id: 'n2' }]);
  const throttled = await service.captureProjectSnapshot(DIRECTORY, changed);
  assert.equal(throttled, null, '5 分钟内改为节流');

  const forced = await service.captureProjectSnapshot(DIRECTORY, changed, { reason: 'manual', force: true });
  assert.ok(forced, '强制快照应写入');
  assert.equal((await service.listProjectSnapshots(DIRECTORY)).length, 2);
});

test('服务：读取快照得到作品结构，列表不带 payload', async () => {
  const record = await service.captureProjectSnapshot(DIRECTORY, projectFixture());
  const payload = await service.readProjectSnapshot(DIRECTORY, record.id);

  assert.deepEqual(payload.nodes, [{ id: 'n1', type: 'textGeneration' }]);
  assert.equal('canvasHistory' in payload, false);

  const [meta] = await service.listProjectSnapshots(DIRECTORY);
  assert.equal('payload' in meta, false);
  assert.equal(meta.contentHash, record.contentHash);
});

test('保留策略：同一个项目最多留下最近 20 份', async () => {
  for (let index = 0; index < 21; index += 1) {
    const record = await service.captureProjectSnapshot(
      DIRECTORY,
      projectFixture([{ id: `n${index}` }]),
      { reason: 'manual', force: true },
    );
    assert.ok(record, `第 ${index + 1} 份快照应写入`);
  }
  const list = await service.listProjectSnapshots(DIRECTORY);
  assert.equal(list.length, 20);
  assert.equal(list[0].createdAt >= list[19].createdAt, true);
});

test('恢复：先备份当前内容，再替换为快照内容', async () => {
  const { store, restoreProjectSnapshot } = await env.load('store/projectStore');
  const { createProject } = await env.load('store/projectNormalization');
  const validProject = (nodes) => ({
    ...createProject(),
    id: 'project-restore',
    name: '当前项目',
    nodes,
    edges: [],
    tasks: [],
  });

  const target = await service.captureProjectSnapshot(DIRECTORY, validProject([{ id: 'old-node', type: 'textGeneration' }]), {
    reason: 'manual',
    force: true,
  });
  assert.ok(target);

  store.projectDir = DIRECTORY;
  store.filePath = `${DIRECTORY}/project.sqlite`;
  store.project = validProject([{ id: 'new-node', type: 'textGeneration' }]);

  const result = await restoreProjectSnapshot(target.id);
  assert.equal(result.ok, true);
  assert.equal(store.project.nodes[0].id, 'old-node');

  const list = await service.listProjectSnapshots(DIRECTORY);
  assert.ok(list.some((snapshot) => snapshot.reason === 'before_restore'), '恢复前应留下备份快照');
});
