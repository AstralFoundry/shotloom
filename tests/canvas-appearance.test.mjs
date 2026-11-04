import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCanvasAppearance, canvasEdgeVisible } from '../renderer/src/utils/canvasAppearance.ts';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

test('canvas preferences restore defaults for old settings and invalid values', () => {
  for (const input of [undefined, null, [], { pattern: 'unknown', color: '#fff', edges: false }]) {
    assert.deepEqual(normalizeCanvasAppearance(input), { pattern: 'dots', color: 'default', edges: 'all' });
  }
  assert.deepEqual(normalizeCanvasAppearance({ pattern: 'grid', color: 'sage', edges: 'manual', extra: true }),
    { pattern: 'grid', color: 'sage', edges: 'manual' });
});

test('connection display only filters presentation using recorded creation source', () => {
  const edges = [{ id: 'legacy' }, { id: 'manual', data: { creationSource: 'manual' } }, { id: 'agent', data: { creationSource: 'agent' } }];
  const snapshot = structuredClone(edges);
  assert.deepEqual(edges.filter(edge => canvasEdgeVisible(edge, 'manual')).map(edge => edge.id), ['manual']);
  assert.deepEqual(edges.filter(edge => canvasEdgeVisible(edge, 'hidden')), []);
  assert.deepEqual(edges.filter(edge => canvasEdgeVisible(edge, 'all')), edges);
  assert.deepEqual(edges, snapshot);
});

test('canvas preferences survive settings reload and user connection paths record their source', async () => {
  const env = await createRendererEnv({ storage: new Map(), withWindow: true });
  try {
    const settings = await env.load('store/settingsStore');
    await settings.loadAppSettings();
    const preferences = { pattern: 'solid', color: 'blue', edges: 'manual' };
    await settings.saveAppSettings({ canvasAppearance: preferences });
    settings.settingsStore.canvasAppearance = normalizeCanvasAppearance();
    await settings.loadAppSettings();
    assert.deepEqual({ ...settings.settingsStore.canvasAppearance }, preferences);

    const { store } = await env.load('store/projectStore');
    const { createProject } = await env.load('store/projectNormalization');
    const { canvasController } = await env.load('app/adapters/canvasAdapter');
    const { selectNode } = await env.load('store/nodeStore');
    store.project = createProject();
    store.project.nodes = ['a', 'b', 'c'].map(id => ({ id, type: 'textGeneration', x: 0, y: 0 }));
    assert.equal(canvasController.connect({ source: 'a', target: 'b' }), true);
    store.connectFromId = 'b';
    selectNode('c');
    assert.equal(store.project.edges.length, 2);
    assert.ok(store.project.edges.every(edge => canvasEdgeVisible(edge, 'manual')));
  } finally {
    await env.dispose();
  }
});
