import test from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

test('在途剪辑交付阻止切项目、离开、删目标和关闭窗口；其他节点仍可删除，完成后正常放行', async () => {
  const env = await createRendererEnv({ withWindow: true, storage: new Map() });
  let dispose;
  try {
    const projectStore = await env.load('store/projectStore');
    const { store } = projectStore;
    const { createProject } = await env.load('store/projectNormalization');
    store.project = createProject('pending export');
    store.projectDir = '/export-owner';
    store.filePath = '/export-owner/project.shotloom.json';
    store.route = 'creation';
    store.project.nodes = [{ id: 'clip', type: 'clipStudio' }, { id: 'other', type: 'textGeneration' }];
    const owner = store.project;
    const { registerProjectOperationGuard } = await env.load('services/projectOperationGuards');
    let pending = true;
    dispose = registerProjectOperationGuard(() => pending ? { project: owner, nodeId: 'clip', reason: 'export still writing' } : null);
    assert.equal(projectStore.navigateToRoute('projects'), false);
    assert.equal(store.route, 'creation');
    assert.equal(await projectStore.createNewProject('must not create'), false);
    assert.equal(await projectStore.openRecentProject('/another/project.shotloom.json'), false);
    assert.equal(store.project, owner);
    const nodes = await env.load('store/nodeStore');
    assert.equal(nodes.deleteNodeById('clip'), false);
    const graph = await env.load('store/canvasGraphStore');
    assert.throws(() => graph.deleteCanvasNodeData('clip'), /export still writing/);
    assert.equal(nodes.deleteNodeById('other'), true);
    const { desktopApi } = await env.load('services/desktopApi');
    let closeRequested;
    let cancelled = 0;
    let closed = 0;
    desktopApi.window.onCloseRequested = callback => { closeRequested = callback; return () => {}; };
    desktopApi.window.cancelClose = async () => { cancelled++; };
    desktopApi.window.confirmClose = async () => { closed++; };
    (await env.load('app/windowCloseGuard')).registerWindowCloseGuard();
    await closeRequested('close');
    assert.equal(cancelled, 1);
    assert.equal(closed, 0);
    pending = false;
    assert.equal(projectStore.navigateToRoute('projects'), true);
    assert.equal(nodes.deleteNodeById('clip'), true);
  } finally { dispose?.(); await env.dispose(); }
});
