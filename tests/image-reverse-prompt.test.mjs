import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';
import { readSource } from './helpers/sourceContract.mjs';

const env = await createRendererEnv({ storage: new Map(), withWindow: true });
after(() => env.dispose());

const { store } = await env.load('store/projectStore');
const { createImageReversePromptNode } = await env.load('app/adapters/canvas/imageReversePromptActions');
const { buildGenerationPayload, generationUpstreamReadiness } = await env.load('domain/graph/generationPayload');
const { getGenerationInputModes } = await env.load('domain/catalog/ModelCatalog');
const { IMAGE_REVERSE_PROMPT } = await env.load('domain/graph/imageReversePrompt');

const sourceImage = () => ({
  id: 'src-image',
  type: 'imageGeneration',
  title: '参考图',
  model: 'gpt-image-2.6-sunburst',
  x: 0,
  y: 0,
  width: 320,
  height: 320,
  status: 'completed',
  prompt: '原提示词',
  filePath: '/tmp/source.png',
  uploadedFile: {
    name: 'source.png', path: '/tmp/source.png', filePath: '/tmp/source.png',
    type: 'image/png', mimeType: 'image/png',
  },
});

test('Gemini 文本模式声明了图片输入，反推节点才能解析到可用模式', () => {
  const modes = getGenerationInputModes('gemini-3.8-flash');
  const reference = modes.find((mode) => mode.value === 'reference');
  assert.ok(reference, JSON.stringify(modes));
  assert.equal(reference.maxImages, 1);
});

test('反推提示词派生文本节点，接上图片参考并直接运行', () => {
  store.project.nodes = [sourceImage()];
  store.project.edges = [];
  store.project.tasks = [];
  assert.equal(createImageReversePromptNode('src-image'), true);
  assert.equal(store.project.nodes.length, 2);
  const reverse = store.project.nodes.find((node) => node.type === 'textGeneration');
  assert.ok(reverse);
  assert.equal(reverse.model, 'gemini-3.8-flash');
  assert.equal(reverse.prompt, IMAGE_REVERSE_PROMPT);
  assert.equal(reverse.title, '反推提示词');
  assert.deepEqual(reverse.reversePrompt, { sourceNodeId: 'src-image', mode: 'image' });
  assert.equal(reverse.x > 320, true);
  const edge = store.project.edges.find((item) => item.source === 'src-image' && item.target === reverse.id);
  assert.ok(edge);
  assert.equal(edge.data.inputRole, 'referenceImage');
  assert.equal(edge.data.inputSlot, 'reference');

  const readiness = generationUpstreamReadiness(reverse, store.project);
  assert.equal(readiness.ready, true, JSON.stringify(readiness.issues));
  const payload = buildGenerationPayload(reverse, store.project);
  assert.equal(payload.modelContract?.modeId, 'text-generation');
  assert.equal(payload.modelContract?.maxInputImages, 1);
  assert.equal(payload.modelInputs?.images?.length, 1);
  assert.ok(!payload.imageEdit);
});

test('反推工具的工具栏、动作与适配器接线完整', () => {
  const registry = readSource('renderer/src/utils/canvasNodeToolbar.ts');
  const toolbar = readSource('renderer/src/app/canvas/CanvasNodeToolbar.tsx');
  const canvas = readSource('renderer/src/app/canvas/WorkflowCanvas.tsx');
  const adapter = readSource('renderer/src/app/adapters/canvasAdapter.ts');
  const action = readSource('renderer/src/app/adapters/canvas/imageReversePromptActions.ts');
  const catalog = readSource('renderer/src/config/model-catalog-v2/google.json');
  const provider = readSource('renderer/src/domain/provider/adapters/declarative.ts');
  assert.match(registry, /id: "reverse-prompt", label: t\("imageReverse\.tool\.label"\), icon: "scan-text"/);
  assert.match(registry, /"emotion", "reverse-prompt"/);
  assert.match(toolbar, /case "reverse-prompt":[\s\S]*?actions\.createReversePromptNode\(node\.id\)/);
  assert.match(canvas, /createReversePromptNode: \(id: string\) => boolean/);
  assert.match(adapter, /createReversePromptNode: createImageReversePromptNode/);
  assert.match(action, /getGenerationInputModes/);
  assert.match(action, /inputRole: 'referenceImage'/);
  assert.match(catalog, /"images":[\s\S]*?"referenceImage"[\s\S]*?"imageContentFormat": "openai-image-url"/);
  assert.match(provider, /type: 'image_url'/);
  assert.match(provider, /type: 'text'/);
});

test('带图片的文本任务把图片塞进 chat content parts，而不是静默丢掉', async () => {
  const env2 = await createRendererEnv();
  try {
    const { desktopApi } = await env2.load('services/desktopApi');
    const { findProviderAdapter } = await env2.load('domain/provider/adapters/index');
    const { resolveModelRuntimeContract } = await env2.load('domain/catalog/ModelCatalog');
    const adapter = findProviderAdapter('google');
    const contract = resolveModelRuntimeContract('textGeneration', 'gemini-3.8-flash', ['referenceImage']);
    assert.equal(contract.modeId, 'text-generation');
    const previousChat = desktopApi.model.chatCompletion;
    const previousRead = desktopApi.file.readArrayBuffer;
    let captured = null;
    try {
      desktopApi.file.readArrayBuffer = async () => new TextEncoder().encode('fake-png').buffer;
      desktopApi.model.chatCompletion = async (body) => {
        captured = body;
        return { choices: [{ message: { content: '一段反推提示词' } }] };
      };
      const task = await adapter.submit(adapter.compileRequest({
        taskType: 'textGeneration',
        model: 'gemini-3.8-flash',
        prompt: '请反推提示词',
        modelContract: contract,
        params: {},
        modelInputs: {
          images: [{ filePath: '/tmp/source.png', mimeType: 'image/png', inputSlot: 'reference' }],
        },
      }));
      assert.equal(task.status, 'completed');
      assert.equal(task.result.text, '一段反推提示词');
      const user = captured?.messages?.find((message) => message.role === 'user');
      assert.ok(Array.isArray(user?.content), JSON.stringify(captured));
      assert.equal(user.content[0].type, 'text');
      assert.equal(user.content[1].type, 'image_url');
      assert.match(user.content[1].image_url.url, /^data:image\/png;base64,/);
    } finally {
      desktopApi.model.chatCompletion = previousChat;
      desktopApi.file.readArrayBuffer = previousRead;
    }
  } finally {
    await env2.dispose();
  }
});
