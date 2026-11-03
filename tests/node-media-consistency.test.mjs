import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env, store, media, catalog, selection, view, references, payload;
before(async () => {
  env = await createRendererEnv({ storage: new Map(), withWindow: true });
  ({ store } = await env.load('store/projectStore'));
  media = await env.load('utils/nodeMedia');
  catalog = await env.load('services/editorMediaCatalog');
  selection = await env.load('app/adapters/canvas/canvasMediaSelection');
  view = await env.load('app/adapters/canvas/canvasViewData');
  payload = await env.load('domain/graph/generationPayload');
});
after(async () => env?.dispose());

for (const selectedId of ['b', 'material:new', 'resource']) {
  test(`画布、操作、剪辑、对话与生成输入共用显式输出 ${selectedId}`, () => {
    const node = {
      id: 'image', type: 'imageGeneration', title: '角色', selectedOutputNodeId: selectedId,
      generatedOutputs: [
        { id: 'a', filePath: '/old.png', resourceType: 'image', selected: true },
        { id: 'b', filePath: '/b.png', resourceType: 'image' },
        { id: 'c', filePath: '/last.png', resourceType: 'image' },
      ],
    };
    const project = {
      id: 'consistency', assets: [], tasks: [],
      nodes: [node, { id: 'resource', type: 'resource', filePath: '/resource.png', resourceType: 'image', generatedFrom: { nodeId: 'image' } },
        { id: 'target', type: 'imageGeneration', model: 'seedream-4-5', prompt: '参考', inputMode: 'reference' }],
      materials: [{ id: 'new', nodeId: 'image', path: '/material.png', resourceType: 'image' }],
      edges: [{ id: 'edge', source: 'image', target: 'target', data: { inputRole: 'referenceImage', inputSlot: 'reference' } }],
    };
    store.project = project;
    const expected = { b: '/b.png', 'material:new': '/material.png', resource: '/resource.png' }[selectedId];
    assert.equal(media.localMediaPath(media.selectedNodeMedia(node, project)), expected);
    assert.equal(selection.selectedNodeLocalMedia(project, node).path, expected);
    assert.equal(catalog.editorCanvasCandidate('image').sourceFile, expected);
    const rendered = view.buildCanvasViewData(store).nodes.find((item) => item.id === 'image');
    assert.equal(media.localMediaPath(media.selectedNodeMedia(rendered)), expected);
    const request = payload.buildGenerationPayload(project.nodes[2], project);
    assert.equal(request.inputs[0].selectedOutput.filePath, expected);
  });
}

test('选中远端输出时不偷换成另一条本地文件；候选不随读取写入项目', () => {
  const node = { id: 'remote', selectedOutputNodeId: 'r', generatedOutputs: [
    { id: 'local', filePath: '/local.png' }, { id: 'r', url: 'https://cdn.example.com/r.png' },
  ] };
  const project = { nodes: [node], materials: [] };
  const before = JSON.stringify(project);
  assert.equal(selection.selectedNodeLocalMedia(project, node).path, '');
  assert.equal(media.selectedNodeMedia(node, project).url, 'https://cdn.example.com/r.png');
  assert.equal(JSON.stringify(project), before);
});
