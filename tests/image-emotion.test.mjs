import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';
import { readSource, sourceExists } from './helpers/sourceContract.mjs';

const env = await createRendererEnv({ storage: new Map(), withWindow: true });
after(() => env.dispose());

const emotion = await env.load('domain/graph/imageEmotion');
const { store } = await env.load('store/projectStore');
const { applyEmotionEdit } = await env.load('app/adapters/canvas/imageEmotionActions');
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

test('情绪盘是 5×5 的二维坐标，中心是中性，每格都有可用于生成的描述', () => {
  assert.equal(emotion.EMOTION_PRESETS.length, 25);
  assert.equal(emotion.DEFAULT_EMOTION_PRESET.id, 'neutral');
  assert.equal(emotion.DEFAULT_EMOTION_PRESET.intimacy, 0);
  assert.equal(emotion.DEFAULT_EMOTION_PRESET.arousal, 0);
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      const preset = emotion.EMOTION_PRESETS[row * 5 + column];
      assert.ok(preset, `缺少 ${row}-${column}`);
      assert.equal(preset.arousal, 2 - row);
      assert.equal(preset.intimacy, 2 - column);
      assert.ok(preset.label.trim());
      assert.ok(preset.prompt.trim());
    }
  }
});

test('表情提示词锁身份、锁画面，只允许改脸', () => {
  const tender = emotion.findEmotionPreset('tender');
  assert.ok(tender);
  const prompt = emotion.composeEmotionPrompt(tender, '眼神再柔和一点');
  assert.match(prompt, /只修改人物的面部表情/);
  assert.match(prompt, /保持身份、五官、发型、服装、姿势、背景、构图、光线和色彩不变/);
  assert.match(prompt, /目标表情：/);
  assert.match(prompt, /眼神再柔和一点/);
  assert.match(prompt, /不要重绘整张画面/);
  assert.deepEqual(emotion.emotionBlendshapes(emotion.DEFAULT_EMOTION_PRESET), {});
  const tenderShapes = emotion.emotionBlendshapes(tender);
  assert.ok((tenderShapes.mouthSmile_L || 0) > 0);
  assert.ok((tenderShapes.mouthSmile_R || 0) > 0);

  assert.equal(emotion.composeEmotionPrompt(tender, '   '), emotion.composeEmotionPrompt(tender));
  assert.equal(emotion.findEmotionPreset('no-such-preset'), null);
});

test('脸部框与蒙版几何归一化，画面比例变化也不会越界', () => {
  assert.deepEqual(emotion.normalizeFaceRect(undefined), emotion.DEFAULT_FACE_RECT);
  const clamped = emotion.normalizeFaceRect({ x: -0.4, y: 2, width: 0.2, height: 0.9 });
  assert.ok(clamped.x >= 0 && clamped.x + clamped.width <= 1.000001);
  assert.ok(clamped.y >= 0 && clamped.y + clamped.height <= 1.000001);
  assert.ok(clamped.width >= 0.08 && clamped.height >= 0.08);

  const pixels = emotion.faceRectPixels({ x: 0.25, y: 0.2, width: 0.5, height: 0.4 }, 1000, 500);
  assert.deepEqual(pixels, { left: 250, top: 100, width: 500, height: 200 });

  const ellipse = emotion.emotionMaskEllipse(pixels);
  assert.ok(ellipse.radiusX > pixels.width / 2);
  assert.ok(ellipse.radiusY > pixels.height / 2);
  assert.ok(ellipse.centerY < pixels.top + pixels.height / 2);
});

test('表情调节会派生只改脸的蒙版节点，并写入表情快照', () => {
  resetProject(sourceImage());
  assert.equal(applyEmotionEdit('src-image', {
    maskFilePath: '/tmp/emotion-mask.png',
    presetId: 'tender',
    extraPrompt: '眼神再柔和一点',
    faceRect: { x: 0.3, y: 0.2, width: 0.4, height: 0.4 },
    model: 'gpt-image-2.6-sunburst',
  }), true);
  assert.equal(store.project.nodes.length, 2);
  const derived = store.project.nodes[1];
  assert.equal(derived.type, 'imageGeneration');
  assert.equal(derived.title, '表情 · 参考图');
  assert.equal(derived.model, 'gpt-image-2.6-sunburst');
  assert.deepEqual(derived.imageEdit, {
    mode: 'emotion',
    sourceFile: '/tmp/source.png',
    maskFile: '/tmp/emotion-mask.png',
  });
  assert.equal(derived.emotionEdit.presetId, 'tender');
  assert.equal(derived.emotionEdit.label, emotion.findEmotionPreset('tender')?.label);
  assert.deepEqual(derived.emotionEdit.faceRect, { x: 0.3, y: 0.2, width: 0.4, height: 0.4 });
  assert.match(derived.prompt, /目标表情：/);
  assert.match(derived.prompt, /眼神再柔和一点/);

  const edge = store.project.edges.find((item) => item.source === 'src-image' && item.target === derived.id);
  assert.ok(edge, '缺少源图到表情节点的参考连线');
  assert.equal(edge.data.inputRole, 'referenceImage');
  assert.equal(edge.data.inputSlot, 'reference');

  const readiness = generationUpstreamReadiness(derived, store.project);
  assert.equal(readiness.ready, true, JSON.stringify(readiness.issues));
  const payload = buildGenerationPayload(derived, store.project);
  assert.equal(payload.modelContract?.supportsMaskEditing, true);
  assert.equal(payload.imageEdit?.mode, 'emotion');
  assert.equal(payload.imageEdit?.maskFile, '/tmp/emotion-mask.png');
  assert.equal(payload.modelInputs?.images?.length, 1);
});

test('未知表情或不支持蒙版的模型不会建节点', () => {
  resetProject(sourceImage());
  assert.equal(applyEmotionEdit('src-image', {
    maskFilePath: '/tmp/emotion-mask.png',
    presetId: 'no-such-preset',
    faceRect: emotion.DEFAULT_FACE_RECT,
  }), false);
  assert.equal(store.project.nodes.length, 1);

  resetProject({ ...sourceImage(), model: 'no-such-model' });
  assert.equal(applyEmotionEdit('src-image', {
    maskFilePath: '/tmp/emotion-mask.png',
    presetId: 'tender',
    faceRect: emotion.DEFAULT_FACE_RECT,
  }), false);
  assert.equal(store.project.nodes.length, 1);
});

test('表情工具的工具栏、覆盖层与动作接线完整', () => {
  const registry = readSource('renderer/src/utils/canvasNodeToolbar.ts');
  const toolbar = readSource('renderer/src/app/canvas/CanvasNodeToolbar.tsx');
  const canvas = readSource('renderer/src/app/canvas/WorkflowCanvas.tsx');
  const overlays = readSource('renderer/src/app/canvas/GenerationNodeImageOverlays.tsx');
  const adapter = readSource('renderer/src/app/adapters/canvasAdapter.ts');
  const editor = readSource('renderer/src/app/canvas/ImageEmotionEditor.tsx');
  const styles = readSource('renderer/styles/image-recipes.css');
  const icon = readSource('renderer/src/app/components/IconSymbol.tsx');
  const facePreview = readSource('renderer/src/app/canvas/EmotionFacePreview.tsx');

  assert.match(registry, /id: "emotion", label: t\("imageEmotion\.tool\.label"\), icon: "smile"/);
  assert.match(registry, /image: \[[^\]]*"mask-edit", "emotion"[^\]]*\]/);
  assert.match(toolbar, /case "emotion":[\s\S]*?pressed: imageEmotionOpen[\s\S]*?onClick: onImageEmotionOpen/);
  assert.match(canvas, /applyEmotionEdit: \(id: string, input: \{[\s\S]*?presetId: string;[\s\S]*?faceRect:/);
  assert.match(canvas, /setImageEmotionOpen\(\(current\) => !current\)/);
  assert.match(overlays, /<ImageEmotionEditor[\s\S]*?model=\{String\(node\.model[\s\S]*?modelSupported=\{maskModels\.includes/);
  assert.match(overlays, /actions\.applyEmotionEdit\(node\.id, \{ maskFilePath, presetId, extraPrompt, faceRect \}\)/);
  assert.match(overlays, /-emotion-mask\.png/);
  assert.match(adapter, /import \{ applyEmotionEdit \} from "\.\/canvas\/imageEmotionActions"/);
  assert.match(adapter, /^  applyEmotionEdit,$/m);

  // 5×5 情绪盘 + 可拖动/缩放的矩形脸部框 + 复用节点参数面板。
  assert.match(editor, /className="image-emotion-pad"/);
  // 两步流程：先框脸（顶部提示条），再进入宽版情绪面板（角色 chip + 预览/情绪盘两列 + 底栏）。
  assert.match(editor, /className="image-emotion-select-bar nodrag nopan nowheel"/);
  assert.match(editor, /className="image-emotion-chips"/);
  assert.match(editor, /className="image-emotion-columns"/);
  assert.match(editor, /className="image-recipe-foot image-emotion-foot"/);
  assert.match(styles, /\.image-emotion-select-bar \{/);
  assert.match(styles, /\.image-emotion-columns \{/);
  assert.match(editor, /EMOTION_PRESETS\.map/);
  assert.match(editor, /className="image-emotion-frame"/);
  assert.match(editor, /image-emotion-handle/);
  assert.match(editor, /emotionMaskEllipse/);
    // 3D 脸部预览走独立 chunk，避免 three 进主包。
  assert.match(editor, /lazy\(\(\) => import\('\.\/EmotionFacePreview'\)\)/);
  assert.match(editor, /<Suspense fallback=\{<div className="image-emotion-face-stage" \/>\}/);
  assert.match(facePreview, /GLTFLoader/);
  assert.match(facePreview, /setMeshoptDecoder\(MeshoptDecoder\)/);
  assert.match(facePreview, /morphTargetDictionary/);
  assert.match(facePreview, /models\/facecap-mannequin\.glb/);
  assert.match(facePreview, /emotionBlendshapes/);
  assert.ok(sourceExists('renderer/public/models/facecap-mannequin.glb'));
  assert.ok(sourceExists('renderer/public/models/facecap-mannequin.glb.LICENSE.md'));
  assert.match(styles, /\.image-emotion-face-stage \{/);
  assert.match(icon, /smile:/);
  assert.match(styles, /\.image-emotion-pad \{/);
  assert.match(styles, /\.image-emotion-frame \{/);
  });

test('25 个情绪词条在中文和英文里都存在', async () => {
  const zh = (await env.load('i18n/locales/zh-CN.json')).default;
  const en = (await env.load('i18n/locales/en-US.json')).default;
  for (const preset of emotion.EMOTION_PRESETS) {
    assert.ok(preset.label);
    // 运行时已经通过 t() 取到当前语言；字典里再确认英文键存在。
    const key = `imageEmotion.preset.${preset.id}`;
    assert.ok(zh[key], `缺少中文词条 ${key}`);
    assert.ok(en[key], `缺少英文词条 ${key}`);
  }
});
