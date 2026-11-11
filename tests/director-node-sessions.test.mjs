import assert from 'node:assert/strict';
import test from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

test('导出结果节点不会抢走导演台的选中状态', async () => {
  const env = await createRendererEnv({ storage: new Map(), withWindow: true });
  try {
    const { store } = await env.load('store/projectStore');
    const { createProject } = await env.load('store/projectNormalization');
    const { addNode } = await env.load('store/nodeStore');
    store.project = createProject('Director export');
    store.project.nodes.push({ id: 'director-a', type: 'threeDDirector' });
    store.selectedNodeId = 'director-a';
    store.selectedNodeIds = ['director-a'];
    const output = addNode('videoGeneration', { select: false });
    assert.equal(output.type, 'videoGeneration');
    assert.equal(store.selectedNodeId, 'director-a');
    assert.deepEqual(store.selectedNodeIds, ['director-a']);
  } finally {
    await env.dispose();
  }
});

test('每个 3D 导演台节点持有独立 Agent 会话，工作区会话不混入节点', async () => {
  const env = await createRendererEnv({ storage: new Map(), withWindow: true });
  try {
    const { directorHarnessSession, scopedHarnessSessions, createHarnessSession } = await env.load('services/harnessSessionStore');
    const project = { harnessSessions: [], activeHarnessSessionId: '' };
    const first = directorHarnessSession(project, 'director-a');
    const second = directorHarnessSession(project, 'director-b');
    const workspace = directorHarnessSession(project);
    assert.notEqual(first.id, second.id);
    assert.notEqual(first.id, workspace.id);
    assert.equal(directorHarnessSession(project, 'director-a').id, first.id);
    createHarnessSession(project, { agentId: 'director-primary', directorNodeId: 'director-a' });
    assert.equal(scopedHarnessSessions(project, 'director', 'director-a').length, 2);
    assert.deepEqual(scopedHarnessSessions(project, 'director', 'director-b').map(session => session.id), [second.id]);
    assert.deepEqual(scopedHarnessSessions(project, 'director').map(session => session.id), [workspace.id]);
  } finally {
    await env.dispose();
  }
});

test('删除一个导演台节点只清理该节点的 Agent 关联', async () => {
  const env = await createRendererEnv({ storage: new Map(), withWindow: true });
  try {
    const { store } = await env.load('store/projectStore');
    const { deleteCanvasNodeData } = await env.load('store/canvasGraphStore');
    store.project = {
      nodes: [{ id: 'director-a', type: 'threeDDirector' }, { id: 'director-b', type: 'threeDDirector' }],
      edges: [], tasks: [],
      harnessSessions: [
        { id: 'agent-a', agentId: 'director-primary', directorNodeId: 'director-a' },
        { id: 'agent-b', agentId: 'director-primary', directorNodeId: 'director-b' },
      ],
      activeHarnessSessionId: 'agent-a',
    };
    assert.equal(deleteCanvasNodeData('director-a', { touch: false }), true);
    assert.deepEqual(store.project.nodes.map(node => node.id), ['director-b']);
    assert.deepEqual(store.project.harnessSessions.map(session => session.id), ['agent-b']);
    assert.equal(store.project.activeHarnessSessionId, 'agent-b');
  } finally {
    await env.dispose();
  }
});

test('删除文本、剪辑和导演台节点后，会话可随画布撤销恢复', async () => {
  const env = await createRendererEnv({ storage: new Map(), withWindow: true });
  try {
    const { store } = await env.load('store/projectStore');
    const { deleteCanvasNodeData } = await env.load('store/canvasGraphStore');
    const { recordCanvasHistory, undoCanvas } = await env.load('store/canvasHistoryStore');
    for (const [type, field] of [['text', 'textNodeId'], ['clipStudio', 'editorNodeId'], ['threeDDirector', 'directorNodeId']]) {
      const nodeId = `${type}-node`;
      const session = { id: `${type}-session`, [field]: nodeId, harnessSessionId: `${type}-host` };
      store.project = { nodes: [{ id: nodeId, type }], edges: [], tasks: [], harnessSessions: [session], activeHarnessSessionId: session.id };
      recordCanvasHistory('delete node');
      assert.equal(deleteCanvasNodeData(nodeId, { touch: false }), true);
      assert.equal(store.project.harnessSessions.some(item => item.id === session.id), false);
      assert.equal(store.project.trashedHarnessSessions.some(item => item.id === session.id), true);
      undoCanvas();
      assert.equal(store.project.harnessSessions.some(item => item.id === session.id), true);
      assert.equal(store.project.trashedHarnessSessions.some(item => item.id === session.id), false);
    }
  } finally { await env.dispose(); }
});

test('手动删除会话只移除指定记录，且不会被节点撤销恢复', async () => {
  const env = await createRendererEnv({ storage: new Map(), withWindow: true });
  try {
    const { deleteHarnessSession, createHarnessSession, reconcileBoundHarnessSessions } = await env.load('services/harnessSessionStore');
    const project = { nodes: [{ id: 'text-a' }], harnessSessions: [
      { id: 'first', agentId: 'text-primary', textNodeId: 'text-a' },
      { id: 'second', agentId: 'text-primary', textNodeId: 'text-a' },
    ], activeHarnessSessionId: 'first' };
    assert.equal(deleteHarnessSession(project, 'first')?.id, 'first');
    assert.deepEqual(project.harnessSessions.map(session => session.id), ['second']);
    assert.equal(project.activeHarnessSessionId, 'second');
    reconcileBoundHarnessSessions(project);
    assert.deepEqual(project.harnessSessions.map(session => session.id), ['second']);
    deleteHarnessSession(project, 'second');
    const replacement = createHarnessSession(project, { agentId: 'text-primary', textNodeId: 'text-a' });
    assert.deepEqual(project.harnessSessions.map(session => session.id), [replacement.id]);
  } finally { await env.dispose(); }
});

test('删除父文件夹时清除导演台旧草稿并解除当前工程绑定', async () => {
  const storage = new Map([['shotloom:director-workspace:project-a', '{"format":"director-desk"}']]);
  const env = await createRendererEnv({ storage, withWindow: true });
  try {
    const projectStore = await env.load('store/projectStore');
    const { desktopApi } = await env.load('services/desktopApi');
    projectStore.store.project = { id: 'project-a', nodes: [], edges: [], tasks: [], harnessSessions: [] };
    projectStore.store.projectDir = '/library/folder/project-a';
    projectStore.store.filePath = '/library/folder/project-a/project.shotloom';
    const trash = desktopApi.project.trashLibraryFolder;
    const read = desktopApi.project.readFile;
    try {
      desktopApi.project.trashLibraryFolder = async () => ({ ok: true });
      desktopApi.project.readFile = async () => ({ id: 'project-a' });
      assert.equal(await projectStore.trashProjectLibraryFolder('/library/folder', [{ filePath: projectStore.store.filePath }]), true);
      assert.equal(storage.has('shotloom:director-workspace:project-a'), false);
      assert.equal(projectStore.store.projectDir, null);
      assert.notEqual(projectStore.store.project.id, 'project-a');
    } finally {
      desktopApi.project.trashLibraryFolder = trash;
      desktopApi.project.readFile = read;
    }
  } finally {
    await env.dispose();
  }
});
