import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

let server;
let generationUpstreamReadiness;
let buildGenerationPayload;

before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  ({ generationUpstreamReadiness, buildGenerationPayload } = await server.ssrLoadModule(
    '/src/utils/generationPayload.js',
  ));
});

after(async () => {
  await server?.close();
});

function fixture(uploadedFile, inputRole = 'auto') {
  const source = {
    id: 'source',
    type: 'imageGeneration',
    title: '上传图片',
    status: 'idle',
    uploadedFile,
  };
  const target = {
    id: 'target',
    type: 'imageGeneration',
    title: '下游图片',
    model: 'gpt-image-2',
    prompt: '测试',
    config: {},
  };
  return {
    source,
    target,
    project: {
      nodes: [source, target],
      edges: [{ id: 'edge', source: source.id, target: target.id, data: { inputRole } }],
      tasks: [],
      materials: [],
    },
  };
}

test('上传文件和素材应用节点可通过普通画布连线作为下游图片输入', () => {
  const { target, project } = fixture({
    name: 'reference.png',
    path: '/project/assets/reference.png',
    type: 'image/png',
    resourceType: 'image',
  });

  assert.deepEqual(generationUpstreamReadiness(target, project).issues, []);
  const [reference] = buildGenerationPayload(target, project).modelInputs.images;
  assert.equal(reference.filePath, '/project/assets/reference.png');
  assert.equal(reference.inputRole, 'auto');
});

test('上传图片也支持显式参考图角色', () => {
  const { target, project } = fixture({
    name: 'reference.png',
    path: '/project/assets/reference.png',
    type: 'image/png',
    resourceType: 'image',
  }, 'referenceImage');

  assert.deepEqual(generationUpstreamReadiness(target, project).issues, []);
  const [reference] = buildGenerationPayload(target, project).modelInputs.images;
  assert.equal(reference.filePath, '/project/assets/reference.png');
  assert.equal(reference.inputRole, 'referenceImage');
});

test('没有上传文件也没有生成结果的普通节点仍会被拦截', () => {
  const { target, project } = fixture(null);
  const result = generationUpstreamReadiness(target, project);

  assert.equal(result.ready, false);
  assert.match(result.issues.join('；'), /上传图片 尚未完成/);
});

test('文本节点只把模型结果或手写内容作为上游，不泄漏自身提示词', () => {
  const source = {
    id: 'text-source',
    type: 'textGeneration',
    title: '文案',
    status: 'idle',
    prompt: '这是给文本模型的提示词',
    textContent: '这是模型返回或手写的正文',
  };
  const target = {
    id: 'target',
    type: 'imageGeneration',
    title: '下游图片',
    model: 'gpt-image-2',
    prompt: '生成配图',
    config: {},
  };
  const project = {
    nodes: [source, target],
    edges: [{ id: 'edge', source: source.id, target: target.id, data: { inputRole: 'textContext' } }],
    tasks: [],
    materials: [],
  };

  const payload = buildGenerationPayload(target, project);
  assert.equal(payload.inputs[0].prompt, source.textContent);
  assert.doesNotMatch(payload.upstreamContext, /给文本模型的提示词/);
  assert.deepEqual(generationUpstreamReadiness(target, project).issues, []);
});

test('只有提示词而没有正文的文本节点不能作为上游结果', () => {
  const source = {
    id: 'text-source',
    type: 'textGeneration',
    title: '空文案',
    status: 'idle',
    prompt: '仅有生成提示词',
    textContent: '',
  };
  const target = {
    id: 'target',
    type: 'imageGeneration',
    title: '下游图片',
    model: 'gpt-image-2',
    prompt: '生成配图',
    config: {},
  };
  const project = {
    nodes: [source, target],
    edges: [{ id: 'edge', source: source.id, target: target.id, data: { inputRole: 'textContext' } }],
    tasks: [],
    materials: [],
  };

  const payload = buildGenerationPayload(target, project);
  assert.equal(payload.inputs[0].prompt, '');
  assert.match(generationUpstreamReadiness(target, project).issues.join('；'), /尚未完成|没有可用的文本结果/);
});
