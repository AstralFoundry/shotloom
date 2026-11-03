import test from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

const snapshot = revision => ({ id: 'native', revision, settings: { width: 1920, height: 1080 }, timeline: { tracks: [] }, mediaLibrary: { items: [] } });

test('原生文件接口拒绝读取不存在的快照时，仅新工程可以初始化', async () => {
  const env = await createRendererEnv({ withWindow: true });
  try {
    const { desktopApi } = await env.load('services/desktopApi');
    const { readNativeSnapshot } = await env.load('services/clipSnapshotStore');
    desktopApi.project.getEditorSnapshot = async () => null;
    assert.equal(await readNativeSnapshot('/native', 'new'), null);
    await assert.rejects(readNativeSnapshot('/native', 'existing', true), /快照不存在/);
    desktopApi.project.getEditorSnapshot = async () => { throw new Error('Permission denied'); };
    await assert.rejects(readNativeSnapshot('/native', 'unreadable'), /Permission denied/);
  } finally { await env.dispose(); }
});

test('剪辑快照损坏和已有快照缺失不会退回空工程', async () => {
  const env = await createRendererEnv({ withWindow: true });
  try {
    const { desktopApi } = await env.load('services/desktopApi');
    const { readNativeSnapshot } = await env.load('services/clipSnapshotStore');
    desktopApi.project.getEditorSnapshot = async () => null;
    assert.equal(await readNativeSnapshot('/p', 'n'), null);
    await assert.rejects(readNativeSnapshot('/p', 'n', true), /快照不存在/);
    for (const invalid of [{}, [], { id: 'native', settings: {}, timeline: { tracks: [] } }]) {
      desktopApi.project.getEditorSnapshot = async () => invalid;
      await assert.rejects(readNativeSnapshot('/p', 'n', true), /结构无效/);
    }
  } finally { await env.dispose(); }
});

test('剪辑快照 flush 等待在途写盘，失败可重试并保留最新草稿', async () => {
  const env = await createRendererEnv({ withWindow: true });
  try {
    const { desktopApi } = await env.load('services/desktopApi');
    const { createSnapshotWriter } = await env.load('services/clipSnapshotStore');
    let release;
    const written = [];
    const errors = [];
    let fail = false;
    desktopApi.project.setEditorSnapshot = async (_directory, _nodeId, snapshotValue) => {
      if (fail) throw new Error('disk full');
      await new Promise(resolve => { release = resolve; });
      written.push(structuredClone(snapshotValue));
      return { filePath: '/p/snapshot.json' };
    };
    const writer = createSnapshotWriter('/p', 'n', 60000, error => errors.push(error.message));
    writer.schedule(snapshot(1));
    const first = writer.flush();
    await new Promise(resolve => setImmediate(resolve));
    let settled = false;
    const barrier = writer.flush().then(() => { settled = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    release();
    await first; await barrier;
    assert.deepEqual(written, [snapshot(1)]);
    fail = true;
    writer.schedule(snapshot(2));
    await assert.rejects(writer.flush(), /disk full/);
    assert.deepEqual(errors, ['disk full']);
    fail = false;
    const retry = writer.flush();
    await new Promise(resolve => setImmediate(resolve));
    release(); await retry;
    assert.deepEqual(written, [snapshot(1), snapshot(2)]);
    await writer.dispose();
  } finally { await env.dispose(); }
});

test('写入失败后卸载编辑器，新实例从保留草稿恢复并能重试保存', async () => {
  const env = await createRendererEnv({ withWindow: true });
  try {
    const { desktopApi } = await env.load('services/desktopApi');
    const { createSnapshotWriter, readNativeSnapshot } = await env.load('services/clipSnapshotStore');
    desktopApi.project.setEditorSnapshot = async () => { throw new Error('readonly'); };
    desktopApi.project.getEditorSnapshot = async () => { throw new Error('must recover draft first'); };
    const states = [];
    const old = createSnapshotWriter('/retained', 'node', 60000, () => {}, value => states.push(value));
    old.schedule(snapshot(3));
    await assert.rejects(old.dispose(), /readonly/);
    const recovered = await readNativeSnapshot('/retained', 'node', true);
    assert.deepEqual(recovered, snapshot(3));
    recovered.revision = 99;
    assert.equal((await readNativeSnapshot('/retained', 'node')).revision, 3, '调用方不能改坏保留草稿');
    const written = [];
    desktopApi.project.setEditorSnapshot = async (_directory, _nodeId, snapshotValue) => { written.push(structuredClone(snapshotValue)); return { filePath: '/retained/file' }; };
    const next = createSnapshotWriter('/retained', 'node', 60000, () => {}, value => states.push(value));
    await next.flush();
    assert.deepEqual(written, [snapshot(3)]);
    assert.deepEqual(states, ['dirty', 'saving', 'failed', 'saving', 'saved']);
    await next.dispose();
  } finally { await env.dispose(); }
});

test('多个实例对同一快照按顺序写入，旧实例不能覆盖新草稿', async () => {
  const env = await createRendererEnv({ withWindow: true });
  try {
    const { desktopApi } = await env.load('services/desktopApi');
    const { createSnapshotWriter } = await env.load('services/clipSnapshotStore');
    const written = [];
    desktopApi.project.setEditorSnapshot = async (_directory, _nodeId, snapshotValue) => { written.push(structuredClone(snapshotValue)); return { filePath: '/shared/file' }; };
    const a = createSnapshotWriter('/shared', 'n', 60000);
    const b = createSnapshotWriter('/shared', 'n', 60000);
    a.schedule(snapshot(1));
    b.schedule(snapshot(2));
    await Promise.all([a.flush(), b.flush()]);
    assert.deepEqual(written, [snapshot(2)]);
    await a.dispose(); await b.dispose();
  } finally { await env.dispose(); }
});
