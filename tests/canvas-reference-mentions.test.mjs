import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

/**
 * 画布节点 @ 引用的候选契约：已连线的算「当前参考素材」，其余画布产物和项目素材库
 * 条目都还能继续引用；素材库条目一旦被某个节点用上，就不能再作为第二条候选出现，
 * 否则同一个文件会在画布上长出多个副本。
 */
let env;
let store;
let nodeActions;

before(async () => {
  env = await createRendererEnv({ withWindow: true, realTimers: false });
  ({ store } = await env.load('store/projectStore'));
  ({ nodeActions } = await env.load('app/adapters/canvasAdapter'));
});

after(async () => {
  await env.dispose();
});

beforeEach(() => {
  store.projectDir = '/tmp/shotloom-reference-project';
  store.project = {
    id: 'project-1',
    nodes: [
      {
        id: 'upstream', type: 'imageGeneration', title: '上游图', x: 0, y: 0,
        materialId: 'on-canvas',
        uploadedFile: { filePath: '/tmp/shotloom-reference-project/assets/on-canvas.png', resourceType: 'image' },
      },
      {
        id: 'target', type: 'imageGeneration', title: '目标', x: 500, y: 0,
        model: 'gpt-image-2.5-sunburst', inputMode: 'reference',
      },
    ],
    edges: [{
      id: 'edge-1', source: 'upstream', target: 'target',
      data: { inputRole: 'referenceImage', inputSlot: 'reference' },
    }],
    materials: [
      { id: 'on-canvas', name: '已上画.png', path: '/tmp/shotloom-reference-project/assets/on-canvas.png', resourceType: 'image', mimeType: 'image/png', checksum: 'a' },
      { id: 'library-only', name: '仅在素材库.png', path: '/tmp/shotloom-reference-project/assets/library.png', resourceType: 'image', mimeType: 'image/png', checksum: 'b' },
    ],
    canvasHistory: [],
    canvasRedoStack: [],
  };
});

test('@ 候选把已连线节点归入当前参考素材，未上画的项目资产归入项目资产分组', () => {
  const candidates = nodeActions.listReferenceCandidates('target');
  assert.deepEqual(candidates.map((item) => [item.id, item.group]), [
    ['upstream', 'current'],
    ['library-only', 'asset'],
  ]);
  assert.equal(candidates[0].media.filePath, '/tmp/shotloom-reference-project/assets/on-canvas.png');
  assert.equal(candidates[1].media.name, '仅在素材库.png');
});

test('引用项目资产会补出来源节点、连线与提示词别名', async () => {
  const before = store.project.nodes.length;
  const result = await nodeActions.insertReferenceMention('target', 'library-only', '参考@', 2, 3);
  assert.ok(result);
  assert.equal(result.prompt, '参考@仅在素材库.png ');
  assert.equal(store.project.nodes.length, before + 1);
  const created = store.project.nodes[before];
  assert.equal(created.materialId, 'library-only');
  assert.ok(Number(created.x) < 500);
  assert.ok(store.project.edges.some((edge) => edge.source === created.id && edge.target === 'target'));
  assert.deepEqual(store.project.nodes.find((item) => item.id === 'target').promptReferences, [
    { alias: '仅在素材库.png', nodeId: created.id },
  ]);
});

/**
 * 别名切分是纯函数：chip 能不能出来只取决于这里，渲染层再负责把 token 变成 DOM。
 * 中文写作里引用后面直接接文字最常见，绝不能因为「后面不是空格/标点」就退回纯文本。
 */
test('提示词别名切分把引用后的中文、标点和结尾都当边界', async () => {
  const { tokenizePrompt } = await env.load('app/canvas/promptReferenceEditor');
  const references = [{ alias: '仅在素材库.png', nodeId: 'library-only' }];
  const cases = {
    '引用后紧跟中文': '参考@仅在素材库.png的形象',
    '引用后是空格': '参考@仅在素材库.png 的形象',
    '引用在结尾': '参考@仅在素材库.png',
    '引用后是标点': '参考@仅在素材库.png，形象',
  };
  for (const [name, prompt] of Object.entries(cases)) {
    const tokens = tokenizePrompt(prompt, references);
    const references_found = tokens.filter((token) => token.type === 'reference');
    assert.equal(references_found.length, 1, `${name} 应切出一段引用`);
    assert.equal(references_found[0].alias, '仅在素材库.png', name);
    assert.equal(tokens.map((token) => token.value).join(''), prompt, `${name} 切分后必须能原样拼回`);
  }
  assert.equal(tokenizePrompt('参考@仅在素材库.png的形象', references).at(-1).value, '的形象',
    '引用后的中文要留在文本段里，不能被吞进别名');
});

test('提示词别名切分不会截断更长的同类标识符，并且长别名优先', async () => {
  const { tokenizePrompt } = await env.load('app/canvas/promptReferenceEditor');
  const short = [{ alias: 'image.png', nodeId: 'a' }];
  assert.deepEqual(tokenizePrompt('参考@image.png2', short).map((token) => token.type), ['text'],
    '后面还在拼标识符时不算写完引用');
  const both = [{ alias: 'image.png', nodeId: 'a' }, { alias: 'image.png-2', nodeId: 'b' }];
  const tokens = tokenizePrompt('参考@image.png-2 的形象', both);
  assert.deepEqual(tokens.map((token) => token.type), ['text', 'reference', 'text']);
  assert.equal(tokens[1].nodeId, 'b', '同名前缀要取最长的那条别名');
});
