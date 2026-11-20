import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

const env = await createRendererEnv({ storage: new Map(), withWindow: true });
after(() => env.dispose());

async function fixture() {
  const { store } = await env.load('store/projectStore');
  const { createProject } = await env.load('store/projectNormalization');
  store.project = createProject('Canvas suite service');
  store.projectDir = '/canvas-suite-service';
  return store.project;
}

function imageNode(id, title) {
  return {
    id, type: 'imageGeneration', title, x: 0, y: 0, canvasWidth: 350, canvasHeight: 350,
    status: 'completed', progress: 100, artifactType: 'character', resourceType: 'image',
    uploadedFile: { name: `${title}.png`, path: `/tmp/${id}.png`, filePath: `/tmp/${id}.png`, resourceType: 'image', mimeType: 'image/png' },
  };
}

test('复用镜头产出时同步行级参考边，不保留已移除的参考', async () => {
  const project = await fixture();
  const { addNode } = await env.load('store/nodeStore');
  const { ensureStoryboardShotNode } = await env.load('services/storyboardScriptService');
  const script = addNode('textGeneration');
  script.canvasView = 'storyboard-script';
  script.title = '分镜';
  const first = imageNode('ref-a', 'A');
  const second = imageNode('ref-b', 'B');
  project.nodes.push(first, second);
  script.storyboardShots = [{
    id: 'shot-1', shotNumber: 1, durationSeconds: 4, plot: '画面', imagePrompt: '图片提示词', videoPrompt: '',
    referenceNodeIds: ['ref-a'], imageNodeId: '', videoNodeId: '', status: 'idle', error: '',
    shotSize: '', camera: '', motion: '', dialogue: '', sound: '', characters: '', negativePrompt: '',
  }];
  const output = ensureStoryboardShotNode(script.id, 'shot-1', 'image');
  assert.ok(output);
  assert.equal(script.storyboardShots[0].imageNodeId, output.id);
  const managed = () => project.edges.filter((edge) => edge.target === output.id && edge.data?.creationSource === 'storyboard-script' && edge.data?.inputRole === 'referenceImage');
  assert.deepEqual(managed().map((edge) => edge.source), ['ref-a']);
  script.storyboardShots[0].referenceNodeIds = ['ref-b'];
  ensureStoryboardShotNode(script.id, 'shot-1', 'image');
  assert.deepEqual(managed().map((edge) => edge.source), ['ref-b']);
});

test('文本任务成功后把回执解析成镜头行，失败时保留旧行并给出可恢复错误', async () => {
  const project = await fixture();
  const { addNode } = await env.load('store/nodeStore');
  const { archiveGeneratedOutput } = await env.load('services/generatedResultArchive');
  const script = addNode('textGeneration');
  script.canvasView = 'storyboard-script';
  script.storyboardShots = [{ id: 'old', shotNumber: 1, durationSeconds: 4, plot: '旧画面' }];
  const task = { id: 'task-1', nodeId: script.id, type: 'textGeneration', requestPayload: { textSubtask: 'storyboard-script' } };
  const parsed = await archiveGeneratedOutput({
    project, node: script, task,
    output: { text: JSON.stringify({ shots: [{ plot: '新画面', durationSeconds: 5, videoPrompt: '推近' }] }) },
  });
  assert.equal(parsed.storyboardShots.length, 1);
  assert.equal(script.storyboardShots[0].plot, '新画面');
  assert.equal(script.storyboardShots[0].durationSeconds, 5);
  assert.ok(script.storyboardRawText.includes('新画面'));
  const previous = script.storyboardShots;
  const failed = await archiveGeneratedOutput({ project, node: script, task, output: { text: '不是 JSON' } });
  assert.equal(failed.parseError.length > 0, true);
  assert.deepEqual(script.storyboardShots, previous, '解析失败不覆盖已有镜头行');
});

test('按列填充使用每列全部连线图片，不把已删除列的连线算进来', async () => {
  const project = await fixture();
  const { addNode } = await env.load('store/nodeStore');
  const { batchTableData, fillBatchRowsFromColumns, appendBatchRow } = await env.load('services/batchTableService');
  const first = imageNode('ref-a', 'A');
  const second = imageNode('ref-b', 'B');
  const third = imageNode('ref-c', 'C');
  project.nodes.push(first, second, third);
  const table = addNode('batchTable');
  table.batchTable.operation = 'creative';
  appendBatchRow(String(table.id));
  appendBatchRow(String(table.id));
  const data = batchTableData(table);
  project.edges.push(
    { id: 'e1', source: 'ref-a', target: table.id, data: { batchColumnId: data.columns[0].id, creationSource: 'batch-table-connection' } },
    { id: 'e2', source: 'ref-b', target: table.id, data: { batchColumnId: data.columns[1].id, creationSource: 'batch-table-connection' } },
    { id: 'e3', source: 'ref-c', target: table.id, data: { batchColumnId: 'removed-column', creationSource: 'batch-table-connection' } },
  );
  const count = fillBatchRowsFromColumns(String(table.id));
  assert.equal(count, 1, '返回本次按列生成的行数');
  const rows = batchTableData(table).rows;
  assert.deepEqual(rows[0].referenceNodeIds.slice(0, 2), ['ref-a', 'ref-b']);
  assert.equal(rows.every((row) => !row.referenceNodeIds.includes('ref-c')), true, '已删除列的连线不会进入任何行');
});
