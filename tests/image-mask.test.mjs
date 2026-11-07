import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';
import { readSource } from './helpers/sourceContract.mjs';

const env = await createRendererEnv({ storage: new Map(), withWindow: true });
after(() => env.dispose());

const mask = await env.load('domain/graph/imageMask');
const { store } = await env.load('store/projectStore');
const { applyMaskEdit } = await env.load('app/adapters/canvas/imageMaskActions');
const { buildGenerationPayload, generationUpstreamReadiness } = await env.load('domain/graph/generationPayload');

function resetProject(source) {
  store.project.nodes = [source];
  store.project.edges = [];
  store.project.tasks = [];
}

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
    name: 'source.png',
    path: '/tmp/source.png',
    filePath: '/tmp/source.png',
    type: 'image/png',
    mimeType: 'image/png',
  },
});

test('局部重绘提示词锁定「只改蒙版区域」，空输入也不会吞掉前缀', () => {
  const prompt = mask.composeMaskEditPrompt('把外套换成红色风衣');
  assert.match(prompt, /只修改蒙版圈出的区域，其他区域保持不变/);
  assert.match(prompt, /红色风衣/);
  assert.equal(mask.composeMaskEditPrompt('   '), mask.MASK_EDIT_PROMPT_PREFIX);
});

test('模型目录把 Images Edit 模式声明成可蒙版编辑', () => {
  assert.deepEqual(mask.maskEditCapabilityFor('gpt-image-2.6-sunburst'), { supported: true, modeId: 'image-to-image' });
  assert.equal(mask.maskEditCapabilityFor('gpt-image-2.6-flare').supported, true);
  assert.equal(mask.maskEditCapabilityFor('starrouter-gpt-image-2.6-sunburst').supported, true);
  assert.deepEqual(mask.maskEditCapabilityFor('no-such-model'), { supported: false, modeId: '' });
  assert.equal(mask.maskEditInputModeValue('gpt-image-2.6-sunburst'), 'reference');
  const models = mask.listMaskEditModels();
  assert.ok(models.includes('gpt-image-2.6-sunburst'));
  assert.ok(models.includes('starrouter-gpt-image-2.6-flare'));
  assert.ok(models.every((model) => mask.maskEditCapabilityFor(model).supported));
});

test('局部重绘会派生带源图与蒙版的节点，并生成可提交的 imageEdit', () => {
  resetProject(sourceImage());
  assert.equal(applyMaskEdit('src-image', {
    prompt: '把外套换成红色风衣',
    maskFilePath: '/tmp/mask.png',
    model: 'starrouter-gpt-image-2.6-sunburst',
    config: { size: '1536x1024', quality: 'high' },
  }), true);
  assert.equal(store.project.nodes.length, 2);

  const derived = store.project.nodes[1];
  assert.equal(derived.type, 'imageGeneration');
  assert.equal(derived.model, 'starrouter-gpt-image-2.6-sunburst');
  assert.equal(derived.config.size, '1536x1024');
  assert.equal(derived.config.quality, 'high');
  assert.equal(derived.title, '局部重绘 · 参考图');
  assert.equal(derived.inputMode, 'reference');
  assert.deepEqual(derived.imageEdit, {
    mode: 'inpaint',
    sourceFile: '/tmp/source.png',
    maskFile: '/tmp/mask.png',
  });
  assert.match(derived.prompt, /只修改蒙版圈出的区域/);
  assert.match(derived.prompt, /红色风衣/);

  const edge = store.project.edges.find((item) => item.source === 'src-image' && item.target === derived.id);
  assert.ok(edge, '缺少源图到重绘节点的参考连线');
  assert.equal(edge.kind, 'typed-input');
  assert.equal(edge.data.inputRole, 'referenceImage');
  assert.equal(edge.data.inputSlot, 'reference');
  assert.equal(edge.data.required, true);

  const readiness = generationUpstreamReadiness(derived, store.project);
  assert.equal(readiness.ready, true, JSON.stringify(readiness.issues));
  const payload = buildGenerationPayload(derived, store.project);
  assert.equal(payload.modelContract?.supportsMaskEditing, true);
  assert.equal(payload.modelContract?.modeId, 'image-to-image');
  assert.equal(payload.modelContract?.modelId, 'starrouter-gpt-image-2.6-sunburst');
  assert.equal(payload.imageEdit?.maskFile, '/tmp/mask.png');
  assert.equal(payload.imageEdit?.sourceFile, '/tmp/source.png');
  assert.equal(payload.imageEdit?.mode, 'inpaint');
  assert.equal(payload.modelInputs?.images?.length, 1);
});

test('不支持蒙版的模型不建节点，缺少蒙版或提示词也不落节点', () => {
  resetProject(sourceImage());
  assert.equal(applyMaskEdit('src-image', { prompt: '改一下', maskFilePath: '/tmp/mask.png', model: 'no-such-model' }), false);
  assert.equal(store.project.nodes.length, 1);

  resetProject(sourceImage());
  assert.equal(applyMaskEdit('src-image', { prompt: '改一下', maskFilePath: '' }), false);
  assert.equal(store.project.nodes.length, 1);

  resetProject(sourceImage());
  assert.equal(applyMaskEdit('src-image', { prompt: '   ', maskFilePath: '/tmp/mask.png' }), false);
  assert.equal(store.project.nodes.length, 1);
});

test('局部重绘的工具栏、覆盖层与动作接线完整', () => {
  const registry = readSource('renderer/src/utils/canvasNodeToolbar.ts');
  const toolbar = readSource('renderer/src/app/canvas/CanvasNodeToolbar.tsx');
  const canvas = readSource('renderer/src/app/canvas/WorkflowCanvas.tsx');
  const overlays = readSource('renderer/src/app/canvas/GenerationNodeImageOverlays.tsx');
  const adapter = readSource('renderer/src/app/adapters/canvasAdapter.ts');
  const editor = readSource('renderer/src/app/canvas/ImageMaskEditor.tsx');
  const styles = readSource('renderer/styles/image-recipes.css');
  const icon = readSource('renderer/src/app/components/IconSymbol.tsx');

  assert.match(registry, /id: "mask-edit", label: t\("imageMask\.tool\.label"\), icon: "brush"/);
  assert.match(registry, /image: \["crop", "annotate", "split-grid", "watermark", "angle", "lighting", "mask-edit", "emotion", "reverse-prompt", "history"\]/);
  assert.match(toolbar, /case "mask-edit":[\s\S]*?pressed: imageMaskOpen[\s\S]*?onClick: onImageMaskOpen/);
  assert.match(canvas, /applyMaskEdit: \(id: string, input: \{[\s\S]*?prompt: string;[\s\S]*?maskFilePath: string;[\s\S]*?model\?: string;[\s\S]*?config\?: Record<string, unknown>;[\s\S]*?\}\) => boolean/);
  assert.match(canvas, /setImageMaskOpen\(\(current\) => !current\)/);
  assert.match(overlays, /<ImageMaskEditor[\s\S]*?models=\{maskModels\}[\s\S]*?initialModel=\{String\(node\.model/);
  assert.match(overlays, /actions\.applyMaskEdit\(node\.id, \{ prompt, maskFilePath, model, config \}\)/);
  assert.match(overlays, /desktopApi\.file\.saveDataUrlToProject\(maskDataUrl/);
  assert.match(overlays, /import \{ listMaskEditModels \} from '@\/domain\/graph\/imageMask'/);
  assert.match(adapter, /import \{ applyMaskEdit \} from "\.\/canvas\/imageMaskActions"/);
  assert.match(adapter, /^  applyMaskEdit,$/m);

  // 蒙版导出：白底 + 挖空涂抹区；画布本身用不透明像素，靠 CSS 透明度显示。
  assert.match(editor, /context\.fillStyle = '#fff'/);
  assert.match(editor, /globalCompositeOperation = 'destination-out'/);
  assert.match(editor, /drawImage\(paintCanvas, 0, 0\)/);
  assert.match(editor, /const sample = document\.createElement\('canvas'\)/);
  // 现在已经不是侧边面板：画笔条在图片上方，提示词/参数在图片下方，参数复用画布节点的设置面板。
  assert.match(editor, /className="image-mask-topbar nodrag nopan nowheel"/);
  assert.match(editor, /className="image-mask-bottombar nodrag nopan nowheel"/);
  assert.match(editor, /image-mask-divider/);
  assert.match(editor, /className="image-mask-generate"/);
  assert.match(editor, /<GenerationSettingsPanel/);
  assert.match(editor, /defaultConfigForType\('imageGeneration', nextModel\)/);
  assert.match(editor, /getModelSchema\('imageGeneration', model\)/);
  assert.match(editor, /onDoubleClick=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(icon, /brush:/);
  assert.match(icon, /eraser:/);
  assert.match(styles, /\.canvas-image-mask-layer \{[\s\S]*?z-index: var\(--layer-canvas-popover\)/);
  assert.match(styles, /\.image-mask-topbar \{/);
  assert.match(styles, /\.image-mask-bottombar \{/);
  assert.match(styles, /\.image-mask-settings \.generation-settings-panel \{/);
});
