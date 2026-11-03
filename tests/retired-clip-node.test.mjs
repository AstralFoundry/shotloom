import test from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

test('旧剪辑节点和相关连线不会在加载或撤销后复活，素材与独立剪辑会话保留', async () => {
  const env = await createRendererEnv({ withWindow: true, realTimers: false });
  try {
    const { createProject, normalizeProject } = await env.load('store/projectNormalization');
    const { canvasNodeTypes } = await env.load('store/nodeStore');
    const project = createProject('迁移验证');
    project.nodes = [{ id: 'video', type: 'videoGeneration' }, { id: 'old', type: 'clipStudio' }];
    project.edges = [{ id: 'e', source: 'video', target: 'old' }];
    project.materials = [{ id: 'media', filePath: '/project/video.mp4' }];
    project.videoEditorSession = { title: '工作台', project: { assets: [] } };
    project.canvasHistory = [{ nodes: project.nodes, edges: project.edges }];
    project.canvasRedoStack = [{ kind: 'canvas-transaction', nodes: [{ id: 'old', value: project.nodes[1] }], edges: [] }];
    const next = normalizeProject(project);
    assert.deepEqual(next.nodes.map(node => node.id), ['video']);
    assert.deepEqual(next.edges, []);
    assert.deepEqual(next.canvasHistory, []);
    assert.deepEqual(next.canvasRedoStack, []);
    assert.deepEqual(next.materials, project.materials);
    assert.deepEqual(next.videoEditorSession, project.videoEditorSession);
    assert.equal(canvasNodeTypes.includes('clipStudio'), true);
  } finally {
    await env.dispose();
  }
});

test('新版本剪辑节点加载时保留独立工程及来源连线', async () => {
  const env = await createRendererEnv({ withWindow: true, realTimers: false });
  try {
    const { createProject, normalizeProject } = await env.load('store/projectNormalization');
    const project = createProject('新剪辑工程');
    project.nodes = [
      { id: 'video', type: 'videoGeneration' },
      { id: 'clip', type: 'clipStudio', clipNodeVersion: 1, videoEditProject: { tracks: [], assets: [] } },
    ];
    project.edges = [{ id: 'source', source: 'video', target: 'clip', data: { skipTaskInput: true, derivation: 'clip-source' } }];
    const next = normalizeProject(project);
    assert.deepEqual(next.nodes.map(node => node.id), ['video', 'clip']);
    assert.equal(next.edges[0].target, 'clip');
    assert.deepEqual(next.nodes[1].videoEditProject, project.nodes[1].videoEditProject);
  } finally { await env.dispose(); }
});
