import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';
import { readSource } from './helpers/sourceContract.mjs';

const env = await createRendererEnv({ storage: new Map(), withWindow: true });
after(() => env.dispose());

const recipe = await env.load('domain/graph/imageRecipe');
const { t } = await env.load('i18n/index');

test('多角度提示词锁定身份与机位，不把新视角说成透视变形', () => {
  const prompt = recipe.composeAnglePrompt({
    horizontalAngle: 90,
    pitchAngle: -30,
    cameraDistance: 2.4,
    wideAngle: true,
  });
  assert.match(prompt, /保持人物身份/);
  assert.match(prompt, /向右环绕 90°/);
  assert.match(prompt, /向上仰视 30°/);
  assert.match(prompt, new RegExp(`${t('imageRecipe.angle.distance.near')}`));
  assert.match(prompt, /广角镜头/);
  assert.match(prompt, /不要只做透视变形或镜像翻转/);
  // 机位参数是这条提示词的全部自由度，越界值必须先归一化再进提示词。
  const clamped = recipe.composeAnglePrompt({
    horizontalAngle: 540,
    pitchAngle: -120,
    cameraDistance: 99,
    wideAngle: false,
  });
  assert.match(clamped, /背面视角/);
  assert.match(clamped, /向上仰视 60°/);
  assert.match(clamped, /机位距离 10\.0/);
});

test('打光提示词只改光、不画灯具，骨架占位符与预设来自同一份定义', () => {
  const options = recipe.normalizeLightingOptions({
    azimuth: 90,
    elevation: 0,
    brightness: 90,
    rimLight: true,
    stylePresetId: 'rembrandt',
    smartMode: true,
    smartDescription: '雨夜霓虹的潮湿反光',
    lightColor: '#3366ff',
  });
  const prompt = recipe.composeLightingPrompt(options);
  assert.match(prompt, /这是对参考图的打光编辑/);
  assert.match(prompt, /不要在画面中添加灯具/);
  assert.match(prompt, /保持输入图中的人物身份/);
  assert.match(prompt, /来自右侧，接近纯侧光/);
  assert.match(prompt, /高调明亮/);
  assert.match(prompt, /轮廓光与边缘高光/);
  assert.match(prompt, /主光色温偏向 #3366ff/);
  assert.match(prompt, /雨夜霓虹的潮湿反光/);
  assert.match(prompt, /伦勃朗布光/);
  assert.match(prompt, /\[lighting azimuth:90° elevation:0° brightness:90% rim:on\]/);

  // 智能模式关掉之后，用户文字整体退出提示词，而不是只隐藏输入框。
  const withoutSmart = recipe.composeLightingPrompt({ ...options, smartMode: false });
  assert.doesNotMatch(withoutSmart, /雨夜霓虹的潮湿反光/);
});

test('打光提示词骨架由用户编辑，空段落被丢弃而不是留下空行', () => {
  const template = [
    '{{consistency}}',
    '{{direction}}',
    '{{brightness}}',
    '{{lightColor}}',
  ].join('\n');
  const prompt = recipe.composeLightingPrompt({
    ...recipe.DEFAULT_LIGHTING_OPTIONS,
    promptTemplate: template,
    azimuth: 180,
    elevation: 0,
  });
  assert.match(prompt, /来自主体正后方/);
  assert.doesNotMatch(prompt, /\n{2,}/);
  // 模板里被删掉的占位符（预设、智能描述、轮廓光）不再出现在结果里。
  assert.doesNotMatch(prompt, /文字描述|预设/);

  const defaults = recipe.DEFAULT_LIGHTING_OPTIONS;
  assert.equal(defaults.promptTemplate, recipe.DEFAULT_LIGHTING_PROMPT_TEMPLATE);
  for (const placeholder of recipe.LIGHTING_PROMPT_PLACEHOLDERS) {
    assert.ok(defaults.promptTemplate.includes(`{{${placeholder}}}`), `${placeholder} 不在默认骨架里`);
  }
});

test('机位与光位参数归一化：越界裁剪、脏值回默认、未知预设丢弃', () => {
  assert.deepEqual(recipe.normalizeAngleParams(undefined), recipe.DEFAULT_ANGLE_PARAMS);
  assert.deepEqual(recipe.normalizeAngleParams({ horizontalAngle: -400, pitchAngle: 400, cameraDistance: 0, wideAngle: 'yes' }), {
    horizontalAngle: -180,
    pitchAngle: 60,
    cameraDistance: 1,
    wideAngle: false,
  });
  const lighting = recipe.normalizeLightingOptions({ azimuth: -30, elevation: 200, brightness: 300, stylePresetId: 'ghost', lightColor: 'red' });
  assert.equal(lighting.azimuth, 0);
  assert.equal(lighting.elevation, 90);
  assert.equal(lighting.brightness, 100);
  assert.equal(lighting.stylePresetId, '');
  assert.equal(lighting.lightColor, '#ffffff');

  assert.equal(recipe.anglePresetId({ horizontalAngle: 45, pitchAngle: 0 }), 'custom');
  assert.equal(recipe.anglePresetId({ horizontalAngle: -90, pitchAngle: 0 }), 'left');
});

test('节点上的编辑参数可以读回并重建同一条提示词', () => {
  const angle = recipe.createImageRecipe('angle', { horizontalAngle: 45, pitchAngle: 0, cameraDistance: 4.8, wideAngle: false });
  const stored = { version: recipe.IMAGE_RECIPE_VERSION, kind: angle.kind, params: angle.params };
  const restored = recipe.readImageRecipe(stored);
  assert.equal(restored?.kind, 'angle');
  assert.equal(recipe.composeImageRecipePrompt(restored), recipe.composeAnglePrompt(angle.params));
  assert.equal(recipe.readImageRecipe({ kind: 'ghost' }), null);
  assert.equal(recipe.readImageRecipe(undefined), null);
});

test('节点工具条注册了机位与打光，并且两枚按钮都有真实 wiring', () => {
  const toolbar = readSource('renderer/src/app/canvas/CanvasNodeToolbar.tsx');
  const overlays = readSource('renderer/src/app/canvas/GenerationNodeImageOverlays.tsx');
  const canvas = readSource('renderer/src/app/canvas/WorkflowCanvas.tsx');
  const adapter = readSource('renderer/src/app/adapters/canvasAdapter.ts');
  const recipeAction = readSource('renderer/src/app/adapters/canvas/imageRecipeActions.ts');

  assert.match(toolbar, /case "angle":[\s\S]*?pressed: imageAngleOpen[\s\S]*?onClick: onImageAngleOpen/);
  assert.match(toolbar, /case "lighting":[\s\S]*?pressed: imageLightingOpen[\s\S]*?onClick: onImageLightingOpen/);
  assert.match(overlays, /if \(actions\.applyImageRecipe\(node\.id, "angle", params\)\) onImageAngleClose\?\.\(\)/);
  assert.match(overlays, /if \(actions\.applyImageRecipe\(node\.id, "lighting", options\)\) onImageLightingClose\?\.\(\)/);
  assert.match(overlays, /readImageRecipe\(node\.imageRecipe\)/);
  assert.match(canvas, /setImageAngleOpen\(\(current\) => !current\)/);
  assert.match(canvas, /setImageLightingOpen\(\(current\) => !current\)/);
  // 面板与裁剪、标注、水印互斥，否则两个浮层会同时压在节点上。
  assert.match(canvas, /setImageWatermarkOpen\(false\);\s*setImageLightingOpen\(false\);\s*setImageAngleOpen/);

  assert.match(adapter, /import \{ applyImageRecipe \} from "\.\/canvas\/imageRecipeActions"/);
  assert.match(adapter, /^  applyImageRecipe,$/m);
  assert.match(recipeAction, /export function applyImageRecipe\(nodeId: string, kind: ImageRecipeKind, params: unknown\)/);
  assert.match(recipeAction, /const existing = readImageRecipe\(source\.imageRecipe\)/);
  assert.match(recipeAction, /if \(existing\?\.kind === kind\)[\s\S]*?source\.prompt = prompt[\s\S]*?source\.imageRecipe = storedRecipe\(recipe\)/);
  // 派生节点必须把源图作为真实参考输入接进来，而不是像裁剪那样排除任务输入。
  assert.match(recipeAction, /kind: 'typed-input'/);
  assert.match(recipeAction, /inputRole: 'referenceImage'/);
  assert.doesNotMatch(recipeAction, /skipTaskInput: true/);
  assert.match(recipeAction, /getGenerationInputModes\(model\)\.find\(\(mode\) => mode\.maxImages > 0\)/);
  assert.match(recipeAction, /showToast\(t\('imageRecipe\.error\.referenceModel'\)\)/);
  assert.match(recipeAction, /runNode\(node\)|runNode\(derived\)/);
});

test('机位与打光面板挂在画布浮层根节点上，并用 portal 跟随节点矩形', () => {
  const frame = readSource('renderer/src/app/canvas/ImageRecipePanelFrame.tsx');
  const angle = readSource('renderer/src/app/canvas/ImageAnglePanel.tsx');
  const lighting = readSource('renderer/src/app/canvas/ImageLightingPanel.tsx');
  const overlays = readSource('renderer/src/app/canvas/GenerationNodeImageOverlays.tsx');
  const styles = readSource('renderer/styles/image-recipes.css');
  const entry = readSource('renderer/src/main.tsx');
  const uiGate = readSource('scripts/verify-ui-components.mjs');

  assert.match(frame, /createPortal\(/);
  assert.match(frame, /requestAnimationFrame\(function sync\(\)/);
  assert.match(frame, /role="dialog"/);
  // 面板在 DOM 上挂画布浮层，但在 React 树里仍属于图片预览；双击必须在这里截断，
  // 否则连续点面板按钮会被预览的 onDoubleClick 当成看大图。
  assert.match(frame, /onDoubleClick=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(uiGate, /'canvas\/ImageRecipePanelFrame\.tsx'/);
  assert.match(entry, /import '\.\.\/styles\/image-recipes\.css';/);
  assert.match(styles, /\.image-recipe-panel \{[\s\S]*?z-index: var\(--layer-canvas-composer\)/);
  assert.match(styles, /\.image-angle-orbit \{[\s\S]*?preserve-3d/);
  assert.match(styles, /\.image-angle-face\.is-front \{[^}]*translateZ\(52px\)/);
  // 两种预览必须真的换表现，而不是把同一个立方体放大缩小。
  assert.match(angle, /previewMode === "skybox" && \([\s\S]*?image-angle-cube/);
  assert.match(angle, /previewMode === "camera" && \([\s\S]*?image-angle-subject/);
  assert.doesNotMatch(styles, /is-skybox \.image-angle-cube \{[^}]*scale\(/);
  // 摄像头是贴在轨道上的一台小相机，带指向主体的虚线，不会压在主体卡上。
  assert.match(angle, /FRONT_DEPTH_BIAS \* Math\.cos\(params\.horizontalAngle \* radians\)/);
  assert.match(angle, /left: `calc\(50% \+ \$\{cameraX\}px\)`/);
  assert.match(angle, /className="image-angle-camera-sight"/);
  assert.match(angle, /className="image-angle-camera-lens"/);
  assert.match(styles, /\.image-angle-camera-sight \{[^}]*z-index: 1/);
  assert.match(styles, /\.image-angle-subject \{[\s\S]*?z-index: 2/);
  assert.match(styles, /\.image-angle-camera-body \{[\s\S]*?border-radius: var\(--radius-xs\)/);
  assert.match(styles, /\.image-lighting-preset\[aria-pressed="true"\]/);

  // 两栏布局与光照球尺寸各只有一处定义，避免预览和按钮对不上。
  assert.match(styles, /\.image-angle-body \{[^}]*grid-template-columns: minmax\(0, 1fr\) 286px/);
  assert.match(styles, /\.image-lighting-stage \{[^}]*width: 236px/);
  assert.match(lighting, /const STAGE_SIZE = 236/);
  assert.match(overlays, /<ImageAnglePanel[\s\S]*?root=\{root\}[\s\S]*?anchorRef=\{anchorRef\}/);
  assert.match(overlays, /<ImageLightingPanel[\s\S]*?root=\{root\}[\s\S]*?anchorRef=\{anchorRef\}/);

  // 面板文案只从字典读取；提示词骨架属于内容，不参与界面翻译。
  assert.match(angle, /t\('imageRecipe\.angle\.generate'\)/);
  assert.match(lighting, /t\('imageRecipe\.lighting\.generate'\)/);
  // 预设卡必须真的可点：选中态还要有勾选角标，不能只画一组渐变图。
  assert.match(lighting, /onClick=\{onSelect\}/);
  assert.match(lighting, /onSelect=\{\(\) => update\(\{ stylePresetId: options\.stylePresetId === preset\.id \? '' : preset\.id \}\)\}/);
  assert.match(lighting, /image-lighting-preset-check/);
  assert.match(styles, /\.image-lighting-preset-check \{/);
  assert.match(lighting, /DEFAULT_LIGHTING_PROMPT_TEMPLATE/);
});

test('应用机位编辑会派生带参考图输入的真实节点，同类型就地更新、异类型继续派生', async () => {
    const { store } = await env.load('store/projectStore');
    const { applyImageRecipe } = await env.load('app/adapters/canvas/imageRecipeActions');
    store.project.nodes = [{
      id: 'source-image', type: 'imageGeneration', title: '参考图',
      model: 'gpt-image-2.6-sunburst', x: 0, y: 0, width: 320, height: 320,
      status: 'completed', prompt: '原提示词',
    }];
    store.project.edges = [];
    store.project.tasks = [];

    assert.equal(applyImageRecipe('source-image', 'angle', { horizontalAngle: 90, pitchAngle: 0, cameraDistance: 2.4, wideAngle: true }), true);
    assert.equal(store.project.nodes.length, 2);
    const derived = store.project.nodes[1];
    assert.equal(derived.type, 'imageGeneration');
    assert.equal(derived.model, 'gpt-image-2.6-sunburst');
    assert.equal(derived.title, `多角度 · 参考图`);
    assert.equal(derived.imageRecipe.kind, 'angle');
    assert.match(derived.prompt, /向右环绕 90°/);
    assert.equal(derived.generatedFrom.nodeId, 'source-image');

    // 源图必须作为 typed-input 的参考图进入任务，而不是只画一条派生线。
    const edge = store.project.edges.find((item) => item.source === 'source-image' && item.target === derived.id);
    assert.ok(edge, '缺少源图到派生节点的连线');
    assert.equal(edge.kind, 'typed-input');
    assert.equal(edge.data.inputRole, 'referenceImage');
    assert.equal(edge.data.inputSlot, 'reference');
    assert.equal(edge.data.required, true);

    // 同一种编辑再应用一次只更新这一个节点，不会在画布上堆副本。
    assert.equal(applyImageRecipe(derived.id, 'angle', { horizontalAngle: -90, pitchAngle: 0, cameraDistance: 4.8, wideAngle: false }), true);
    assert.equal(store.project.nodes.length, 2);
    assert.match(derived.prompt, /向左环绕 90°/);
    assert.equal(derived.imageRecipe.params.horizontalAngle, -90);

    // 换一种编辑（光线）则从多角度结果继续派生，链式可追溯。
    assert.equal(applyImageRecipe(derived.id, 'lighting', { azimuth: 90, elevation: 0, brightness: 50, rimLight: false, stylePresetId: '', smartMode: true, smartDescription: '', lightColor: '#ffffff' }), true);
    assert.equal(store.project.nodes.length, 3);
    const lighting = store.project.nodes[2];
    assert.equal(lighting.imageRecipe.kind, 'lighting');
    assert.match(lighting.prompt, /这是对参考图的打光编辑/);
    assert.ok(store.project.edges.some((item) => item.source === derived.id && item.target === lighting.id));

    assert.equal(applyImageRecipe('missing-node', 'angle', {}), false);
});
