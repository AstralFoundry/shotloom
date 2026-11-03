import test from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

async function fixture() {
  const env = await createRendererEnv({ withWindow: true, storage: new Map() });
  const { store } = await env.load('store/projectStore');
  const { createProject } = await env.load('store/projectNormalization');
  store.project = createProject('delivery test');
  store.projectDir = '/delivery';
  store.project.nodes = [{ id: 'clip', type: 'clipStudio', clipNodeVersion: 1, x: 0, y: 0 }];
  const delivery = await env.load('app/editor/openReel/exportDelivery');
  const { createVideoExportNode } = await env.load('app/adapters/canvas/videoEditorActions');
  const { desktopApi } = await env.load('services/desktopApi');
  return { env, store, desktopApi, ...delivery, createVideoExportNode };
}

const receipt = { id: 'request-1', directory: '/delivery', filePath: '/delivery/assets/result.mp4', name: 'result.mp4', title: '剪辑结果', duration: 6, width: 1920, height: 1080, fps: 30, size: 100 };

test('素材登记和画布放置分别失败后，重开从已完成阶段继续且保留原标识', async () => {
  const f = await fixture();
  const original = f.desktopApi.file.checksum;
  try {
    f.desktopApi.file.checksum = async () => ({ size: receipt.size, checksum: 'digest' });
    f.stageClipExportDelivery('clip', { ...receipt, checksum: 'digest', revision: 'original' });
    f.store.project.materials.unshift = () => { throw new Error('registration failure'); };
    await assert.rejects(f.retryClipExportDelivery('clip', receipt.id), /registration failure/);
    assert.equal(f.store.project.materials.length, 0);
    delete f.store.project.materials.unshift;
    f.store.project.edges.push = () => { throw new Error('placement failure'); };
    await assert.rejects(f.retryClipExportDelivery('clip', receipt.id), /placement failure/);
    assert.equal(f.store.project.nodes.length, 1);
    assert.equal(f.store.project.materials.length, 1);
    const materialId = f.clipExportDeliveries('clip')[0].materialId;
    assert.equal(materialId, f.store.project.materials[0].id);
    const { normalizeProject } = await f.env.load('store/projectNormalization');
    f.store.project = normalizeProject(JSON.parse(JSON.stringify(f.store.project)));
    const result = await f.retryClipExportDelivery('clip', receipt.id);
    assert.equal(result.materialId, materialId);
    assert.equal(f.store.project.materials.length, 1);
    assert.equal(f.store.project.nodes.length, 2);
    assert.equal(f.clipExportDeliveries('clip')[0].revision, 'original');
  } finally { f.desktopApi.file.checksum = original; await f.env.dispose(); }
});

test('完成记录保存失败保留已存在的结果，再确认不重复放置', async () => {
  const f = await fixture();
  const original = { checksum: f.desktopApi.file.checksum, save: f.desktopApi.project.save };
  try {
    f.store.filePath = '/delivery/project.shotloom.json';
    f.desktopApi.file.checksum = async () => ({ size: receipt.size, checksum: 'digest' });
    const saved = [];
    f.desktopApi.project.save = async (_directory, snapshot) => {
      const delivery = snapshot.nodes.find(n => n.id === 'clip').clipExportDeliveries[0];
      saved.push(JSON.parse(JSON.stringify(delivery)));
      if (delivery.nodeId) throw new Error('completion receipt failure');
      return { filePath: f.store.filePath };
    };
    f.stageClipExportDelivery('clip', { ...receipt, checksum: 'digest' });
    await assert.rejects(f.retryClipExportDelivery('clip', receipt.id), /保存失败/);
    const delivery = f.clipExportDeliveries('clip')[0];
    assert.ok(saved.some(d => !d.materialId && !d.nodeId));
    assert.ok(saved.some(d => d.materialId && !d.nodeId), JSON.stringify(saved));
    assert.ok(delivery.nodeId);
    assert.ok(delivery.error);
    const nodeId = delivery.nodeId;
    f.desktopApi.project.save = async () => ({ filePath: f.store.filePath });
    assert.equal((await f.retryClipExportDelivery('clip', receipt.id)).id, nodeId);
    assert.equal(f.store.project.nodes.length, 2);
    assert.equal(f.store.project.materials.length, 1);
    assert.equal(delivery.error, undefined);
  } finally { f.desktopApi.file.checksum = original.checksum; f.desktopApi.project.save = original.save; await f.env.dispose(); }
});

test('相同工具请求重开后返回原文件、素材和节点，不覆盖较新的导出修订', async () => {
  const f = await fixture();
  const original = f.desktopApi.file.checksum;
  try {
    f.stageClipExportDelivery('clip', { ...receipt, requestKey: 'turn:call', checksum: 'digest', revision: 'old' });
    const output = f.completeClipExportDelivery('clip', receipt.id);
    const { normalizeProject } = await f.env.load('store/projectNormalization');
    f.store.project = normalizeProject(JSON.parse(JSON.stringify(f.store.project)));
    f.store.project.nodes.find(n => n.id === 'clip').videoEditProject.lastExport.revision = 'newer-export';
    const before = JSON.stringify(f.store.project);
    f.desktopApi.file.checksum = async () => ({ size: receipt.size, checksum: 'digest' });
    const result = await f.replayClipExportDelivery('clip', 'turn:call');
    assert.equal(result.nodeId, output.id);
    assert.equal(result.materialId, output.materialId);
    assert.equal(result.filePath, receipt.filePath);
    assert.equal(result.revision, 'old');
    assert.equal(result.applied, false);
    assert.equal(result.replayed, true);
    assert.equal(JSON.stringify(f.store.project), before);
    assert.equal(await f.replayClipExportDelivery('clip', 'another-call'), null);
  } finally { f.desktopApi.file.checksum = original; await f.env.dispose(); }
});

test('交付完成回执丢失时重放复用已有结果，重复并发重放不会重复放置', async () => {
  const f = await fixture();
  const original = f.desktopApi.file.checksum;
  try {
    f.stageClipExportDelivery('clip', { ...receipt, requestKey: 'turn:call', checksum: 'digest' });
    const output = f.completeClipExportDelivery('clip', receipt.id);
    delete f.clipExportDeliveries('clip')[0].nodeId;
    f.desktopApi.file.checksum = async () => ({ size: receipt.size, checksum: 'digest' });
    const results = await Promise.all([f.replayClipExportDelivery('clip', 'turn:call'), f.replayClipExportDelivery('clip', 'turn:call')]);
    assert.ok(results.every(r => r.nodeId === output.id && r.materialId === output.materialId));
    assert.equal(f.store.project.nodes.length, 2);
    assert.equal(f.store.project.materials.length, 1);
    assert.equal(f.store.project.edges.length, 1);
    assert.equal(f.clipExportDeliveries('clip')[0].nodeId, output.id);
  } finally { f.desktopApi.file.checksum = original; await f.env.dispose(); }
});

test('用户删除已完成结果后，工具重放不会悄悄重建该节点', async () => {
  const f = await fixture();
  const original = f.desktopApi.file.checksum;
  try {
    f.stageClipExportDelivery('clip', { ...receipt, requestKey: 'turn:call', checksum: 'digest' });
    const output = f.completeClipExportDelivery('clip', receipt.id);
    f.store.project.nodes = f.store.project.nodes.filter(n => n.id !== output.id);
    f.desktopApi.file.checksum = async () => ({ size: receipt.size, checksum: 'digest' });
    await assert.rejects(f.replayClipExportDelivery('clip', 'turn:call'), /已被删除或修改/);
    assert.equal(f.store.project.nodes.length, 1);
    assert.equal(f.store.project.materials.length, 1);
  } finally { f.desktopApi.file.checksum = original; await f.env.dispose(); }
});

test('导出工具传递精确调用身份，重放回传原交付标识，新调用生成独立结果', async () => {
  const f = await fixture();
  const original = f.desktopApi.file.checksum;
  let unregister;
  try {
    const tools = await f.env.load('agent/tools/videoEditorTools');
    const registry = await f.env.load('agent/core/toolRegistry');
    const identity = (await f.env.load('services/agentProjectIdentity')).getAgentProjectIdentity();
    f.store.project.harnessSessions = [{ id: 'editor-conv', editorNodeId: 'clip' }];
    const keys = [];
    let encoded = 0;
    f.desktopApi.file.checksum = async () => ({ size: receipt.size, checksum: 'digest' });
    unregister = tools.registerActiveVideoEditor({
      projectKey: identity.projectKey, nodeId: 'clip', read: () => ({}),
      exportProject: async (_project, requestKey) => {
        keys.push(requestKey);
        const replay = await f.replayClipExportDelivery('clip', requestKey);
        if (replay) return replay;
        const delivery = { ...receipt, id: `export-${++encoded}`, filePath: `/delivery/assets/export-${encoded}.mp4`, requestKey, checksum: 'digest', revision: 'revision-1' };
        f.stageClipExportDelivery('clip', delivery);
        const node = f.completeClipExportDelivery('clip', delivery.id);
        return { filePath: delivery.filePath, name: delivery.name, duration: delivery.duration, nodeId: node.id, materialId: node.materialId, deliveryId: delivery.id, revision: delivery.revision };
      },
    });
    tools.registerVideoEditorTools();
    const tool = registry.allAgentTools().find(tool => tool.id === 'video_project_export');
    const context = { conversationId: 'editor-conv', projectKey: identity.projectKey, projectInstanceId: identity.instanceId, projectGeneration: identity.generation, turnId: 'request:tool:call-1' };
    const first = await tool.execute({}, context);
    const replay = await tool.execute({}, context);
    const next = await tool.execute({}, { ...context, turnId: 'request:tool:call-2' });
    assert.deepEqual(keys, ['request:tool:call-1', 'request:tool:call-1', 'request:tool:call-2']);
    assert.equal(encoded, 2);
    assert.equal(replay.nodeId, first.nodeId);
    assert.equal(replay.materialId, first.materialId);
    assert.equal(replay.deliveryId, first.deliveryId);
    assert.equal(replay.applied, false);
    assert.equal(replay.replayed, true);
    assert.notEqual(next.nodeId, first.nodeId);
    assert.equal(f.store.project.nodes.length, 3);
    // Identical file digests reuse one library material, even for a new export.
    assert.equal(f.store.project.materials.length, 1);
    assert.equal(next.materialId, first.materialId);
  } finally { unregister?.(); f.desktopApi.file.checksum = original; await f.env.dispose(); }
});

test('导出文件交付记录可持久化，重复登记只产生一个素材、节点和派生边', async () => {
  const f = await fixture();
  try {
    f.stageClipExportDelivery('clip', receipt);
    f.stageClipExportDelivery('clip', receipt);
    assert.equal(f.clipExportDeliveries('clip').length, 1);
    // Emulate reopening the persisted project before completing registration.
    const { normalizeProject } = await f.env.load('store/projectNormalization');
    f.store.project = normalizeProject(JSON.parse(JSON.stringify(f.store.project)));
    const first = f.completeClipExportDelivery('clip', receipt.id);
    const next = f.completeClipExportDelivery('clip', receipt.id);
    assert.equal(next.id, first.id);
    assert.equal(f.store.project.nodes.length, 2);
    assert.equal(f.store.project.materials.length, 1);
    assert.equal(f.store.project.edges.length, 1);
    assert.equal(first.uploadedFile.duration, 6);
    assert.equal(first.uploadedFile.width, 1920);
    assert.equal(first.generatedFrom.deliveryId, receipt.id);
    assert.equal(f.clipExportDeliveries('clip')[0].nodeId, first.id);
    assert.equal(f.store.project.nodes.find(node => node.id === 'clip').videoEditProject.lastExport.filePath, receipt.filePath);
  } finally { await f.env.dispose(); }
});

test('恢复登记核验真实文件，文件缺失或同大小内容被替换时保留失败记录', async () => {
  const f = await fixture();
  const original = f.desktopApi.file.checksum;
  try {
    f.stageClipExportDelivery('clip', { ...receipt, checksum: 'expected-sha256' });
    f.desktopApi.file.checksum = async () => { throw new Error('文件不存在'); };
    await assert.rejects(f.retryClipExportDelivery('clip', receipt.id), /文件不存在/);
    assert.equal(f.store.project.nodes.length, 1);
    assert.match(f.clipExportDeliveries('clip')[0].error, /文件不存在/);
    f.desktopApi.file.checksum = async () => ({ size: receipt.size, checksum: 'replacement-sha256' });
    await assert.rejects(f.retryClipExportDelivery('clip', receipt.id), /内容已改变/);
    assert.equal(f.store.project.materials.length, 0);
    f.desktopApi.file.checksum = async () => ({ size: receipt.size, checksum: 'expected-sha256' });
    const result = await f.retryClipExportDelivery('clip', receipt.id);
    const duplicate = await f.retryClipExportDelivery('clip', receipt.id);
    assert.equal(result.id, duplicate.id);
    assert.equal(f.store.project.nodes.length, 2);
    assert.equal(f.clipExportDeliveries('clip')[0].error, undefined);
  } finally { f.desktopApi.file.checksum = original; await f.env.dispose(); }
});

test('文件核验在途切换同目录同节点 ID 的项目，旧结果不能进入新项目', async () => {
  const f = await fixture();
  const original = f.desktopApi.file.checksum;
  try {
    f.stageClipExportDelivery('clip', { ...receipt, checksum: 'digest' });
    let finish;
    f.desktopApi.file.checksum = () => new Promise(resolve => { finish = resolve; });
    const pending = f.retryClipExportDelivery('clip', receipt.id);
    const { normalizeProject } = await f.env.load('store/projectNormalization');
    f.store.project = normalizeProject(JSON.parse(JSON.stringify(f.store.project)));
    finish({ size: receipt.size, checksum: 'digest' });
    await assert.rejects(pending, /项目已切换/);
    assert.equal(f.store.project.nodes.length, 1);
    assert.equal(f.clipExportDeliveries('clip')[0].error, undefined);
  } finally { f.desktopApi.file.checksum = original; await f.env.dispose(); }
});

test('文件核验期间删除源节点，不创建孤立结果或遗留素材', async () => {
  const f = await fixture();
  const original = f.desktopApi.file.checksum;
  try {
    f.stageClipExportDelivery('clip', { ...receipt, checksum: 'digest' });
    let finish;
    f.desktopApi.file.checksum = () => new Promise(resolve => { finish = resolve; });
    const pending = f.retryClipExportDelivery('clip', receipt.id);
    f.store.project.nodes = [];
    finish({ size: receipt.size, checksum: 'digest' });
    await assert.rejects(pending, /删除/);
    assert.equal(f.store.project.nodes.length, 0);
    assert.equal(f.store.project.materials.length, 0);
  } finally { f.desktopApi.file.checksum = original; await f.env.dispose(); }
});

test('画布登记失败回滚半成品与历史，保留文件交付记录供重试', async () => {
  const f = await fixture();
  try {
    f.stageClipExportDelivery('clip', receipt);
    const before = JSON.parse(JSON.stringify(f.store.project));
    assert.throws(() => f.createVideoExportNode({ id: 'missing-source', type: 'clipStudio' }, { ...receipt, deliveryId: receipt.id }, 'result'), /连线|节点|不存在/);
    for (const key of ['nodes', 'edges', 'materials', 'assets', 'canvasHistory', 'canvasRedoStack']) {
      assert.deepEqual(JSON.parse(JSON.stringify(f.store.project[key])), before[key], key);
    }
    assert.equal(f.clipExportDeliveries('clip')[0].filePath, receipt.filePath);
    f.completeClipExportDelivery('clip', receipt.id);
    assert.equal(f.store.project.nodes.length, 2);
  } finally { await f.env.dispose(); }
});

test('删除再恢复同 ID 节点也不接受删除前发起的文件核验结果', async () => {
  const f = await fixture();
  const original = f.desktopApi.file.checksum;
  try {
    f.stageClipExportDelivery('clip', { ...receipt, checksum: 'digest' });
    let finish;
    f.desktopApi.file.checksum = () => new Promise(resolve => { finish = resolve; });
    const pending = f.retryClipExportDelivery('clip', receipt.id);
    f.store.project.nodes = JSON.parse(JSON.stringify(f.store.project.nodes));
    finish({ size: receipt.size, checksum: 'digest' });
    await assert.rejects(pending, /节点已被替换/);
    assert.equal(f.store.project.nodes.length, 1);
    assert.equal(f.clipExportDeliveries('clip')[0].error, undefined);
  } finally { f.desktopApi.file.checksum = original; await f.env.dispose(); }
});

test('切换目录或删除源节点后，不能把旧交付登记到新归属', async () => {
  const f = await fixture();
  try {
    f.stageClipExportDelivery('clip', receipt);
    f.store.projectDir = '/other';
    assert.throws(() => f.completeClipExportDelivery('clip', receipt.id), /其他项目/);
    assert.equal(f.store.project.nodes.length, 1);
    f.store.projectDir = '/delivery';
    f.store.project.nodes = [];
    assert.throws(() => f.completeClipExportDelivery('clip', receipt.id), /删除/);
    assert.equal(f.store.project.materials.length, 0);
  } finally { await f.env.dispose(); }
});

test('结束恢复只停止后续登记，保留文件回执和已有结果，重开及在途核验不能重新登记', async () => {
  const f = await fixture();
  const original = f.desktopApi.file.checksum;
  try {
    f.stageClipExportDelivery('clip', receipt);
    let finish;
    f.desktopApi.file.checksum = () => new Promise(resolve => { finish = resolve; });
    const pending = f.retryClipExportDelivery('clip', receipt.id);
    const stopped = f.abandonClipExportDelivery('clip', receipt.id);
    assert.equal(stopped.filePath, receipt.filePath);
    assert.ok(stopped.abandonedAt);
    finish({ size: receipt.size, checksum: 'digest' });
    await assert.rejects(pending, /恢复已结束/);
    assert.equal(f.store.project.nodes.length, 1);
    assert.equal(f.store.project.materials.length, 0);
    const { normalizeProject } = await f.env.load('store/projectNormalization');
    f.store.project = normalizeProject(JSON.parse(JSON.stringify(f.store.project)));
    await assert.rejects(f.retryClipExportDelivery('clip', receipt.id), /恢复已结束/);
    assert.throws(() => f.completeClipExportDelivery('clip', receipt.id), /恢复已结束/);
    assert.equal(f.clipExportDeliveries('clip')[0].filePath, receipt.filePath);
    const next = { ...receipt, id: 'new-request' };
    f.stageClipExportDelivery('clip', next);
    const result = f.completeClipExportDelivery('clip', next.id);
    f.abandonClipExportDelivery('clip', next.id);
    assert.ok(f.store.project.nodes.some(node => node.id === result.id));
    assert.equal(f.store.project.materials.length, 1);
  } finally { f.desktopApi.file.checksum = original; await f.env.dispose(); }
});
