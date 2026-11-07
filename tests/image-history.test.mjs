import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';
import { readSource } from './helpers/sourceContract.mjs';

const env = await createRendererEnv({ storage: new Map(), withWindow: true });
after(() => env.dispose());
const { store } = await env.load('store/projectStore');
const { listNodeGenerationHistory, reinsertGenerationHistory } = await env.load('app/adapters/canvas/imageHistoryActions');

const sourceImage = () => ({
  id: 'src-image', type: 'imageGeneration', title: '角色', model: 'gpt-image-2.6-sunburst',
  x: 100, y: 60, width: 320, height: 320, status: 'completed', prompt: '原图',
});

function reset() {
  store.project.nodes = [sourceImage()];
  store.project.edges = [];
  store.project.tasks = [];
  store.project.materials = [];
}

test('只列已完成且有归档素材的生成结果', () => {
  reset();
  store.project.tasks = [
    { id: 't-done', nodeId: 'src-image', status: 'completed', type: 'imageGeneration', model: 'gpt-image-2.6-sunburst', prompt: '红色风衣', completedAt: '2026-11-06T10:00:00Z' },
    { id: 't-fail', nodeId: 'src-image', status: 'failed', type: 'imageGeneration', prompt: '失败' },
    { id: 't-empty', nodeId: 'src-image', status: 'completed', type: 'imageGeneration', prompt: '没有素材' },
  ];
  store.project.materials = [
    { id: 'mat-1', taskId: 't-done', nodeId: 'src-image', name: 'out.png', path: '/tmp/out.png', mimeType: 'image/png', resourceType: 'image' },
    { id: 'mat-fail', taskId: 't-fail', nodeId: 'src-image', name: 'bad.png', path: '/tmp/bad.png', mimeType: 'image/png', resourceType: 'image' },
  ];
  const items = listNodeGenerationHistory('src-image');
  assert.equal(items.length, 1);
  assert.equal(items[0].taskId, 't-done');
  assert.equal(items[0].materialId, 'mat-1');
  assert.equal(items[0].prompt, '红色风衣');
  assert.equal(items[0].type, 'imageGeneration');
});

test('回插会新建独立结果节点，不覆盖源节点', () => {
  reset();
  store.project.tasks = [{ id: 't-done', nodeId: 'src-image', status: 'completed', type: 'imageGeneration', model: 'gpt-image-2.6-sunburst', prompt: '红色风衣', completedAt: '2026-11-06T10:00:00Z' }];
  store.project.materials = [{ id: 'mat-1', taskId: 't-done', nodeId: 'src-image', name: 'out.png', path: '/tmp/out.png', mimeType: 'image/png', resourceType: 'image' }];
  assert.equal(reinsertGenerationHistory('src-image', 't-done', 'mat-1'), true);
  assert.equal(store.project.nodes.length, 2);
  const [source, created] = store.project.nodes;
  assert.equal(source.title, '角色');
  assert.equal(created.type, 'imageGeneration');
  assert.equal(created.title, '角色 · 历史');
  assert.equal(created.filePath, '/tmp/out.png');
  assert.equal(created.status, 'completed');
  assert.equal(created.prompt, '红色风衣');
  assert.equal(created.historyReinsert.taskId, 't-done');
  assert.equal(created.historyReinsert.materialId, 'mat-1');
  assert.equal(created.x > source.x + source.width, true);
  assert.equal(store.project.edges.length, 0);
  assert.equal(reinsertGenerationHistory('src-image', 't-done', 'missing'), false);
});

test('文本历史直接回插为文本节点，保留结果正文', () => {
  reset();
  store.project.tasks = [{ id: 't-text', nodeId: 'src-image', status: 'completed', type: 'textGeneration', model: 'gemini-3.8-flash', prompt: '反推', result: { text: '一段反推提示词' }, completedAt: '2026-11-06T10:00:00Z' }];
  const items = listNodeGenerationHistory('src-image');
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'text');
  assert.equal(reinsertGenerationHistory('src-image', 't-text', ''), true);
  const created = store.project.nodes.at(-1);
  assert.equal(created.type, 'textGeneration');
  assert.equal(created.textContent, '一段反推提示词');
  assert.deepEqual(created.textOutputs, ['一段反推提示词']);
});

test('生成历史的工具栏、弹窗与样式接线完整', () => {
  const registry = readSource('renderer/src/utils/canvasNodeToolbar.ts');
  const toolbar = readSource('renderer/src/app/canvas/CanvasNodeToolbar.tsx');
  const canvas = readSource('renderer/src/app/canvas/WorkflowCanvas.tsx');
  const dialog = readSource('renderer/src/app/canvas/GenerationHistoryDialog.tsx');
  const action = readSource('renderer/src/app/adapters/canvas/imageHistoryActions.ts');
  const styles = readSource('renderer/styles/canvas.css');
  assert.match(registry, /id: "history", label: t\("imageHistory\.tool\.label"\), icon: "clock"/);
  assert.match(registry, /"reverse-prompt", "history"/);
  assert.match(toolbar, /case "history":[\s\S]*?onOpenGenerationHistory\?\.\(node\.id\)/);
  assert.match(canvas, /CanvasHistoryContext/);
  assert.match(canvas, /<GenerationHistoryDialog[\s\S]*?nodeId=\{historyNodeId \|\| ''\}/);
  assert.match(dialog, /listNodeGenerationHistory/);
  assert.match(dialog, /reinsertGenerationHistory/);
  assert.match(action, /materials.*taskId|material\.taskId/);
  assert.match(styles, /\.generation-history-grid \{/);
});
