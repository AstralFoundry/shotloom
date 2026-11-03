import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource } from './helpers/sourceContract.mjs';

const dir = '../renderer/src/app/canvas/';
const modules = [
  'GenerationNode.tsx',
  'generationNodeState.ts',
  'GenerationNodePreview.tsx',
  'GenerationNodeImageOverlays.tsx',
  'GenerationNodeComposer.tsx',
  'GenerationSettingsPanel.tsx',
];
const sources = Object.fromEntries(modules.map((name) => [
  name,
  readSource(`${dir}${name}`),
]));

test('节点派生值只在状态模块计算一次，子组件只消费结果', () => {
  const derived = [
    /createNodeMediaCatalog\(\)/,
    /textNodeContent\(\{ \.\.\.node, generatedOutputs: outputs \}\)/,
    /getGenerationInputModes\(selectedModel\)/,
    /normalizeCameraConfig\(/,
    /getImageStylePreset\(config\.stylePresetId\)/,
  ];
  for (const pattern of derived) {
    const owners = modules.filter((name) => pattern.test(sources[name]));
    assert.deepEqual(owners, ['generationNodeState.ts'], `${pattern} 应由状态模块独占`);
  }
});

test('节点外壳只负责组装，媒体体与输入面板各自拥有交互状态', () => {
  assert.match(sources['GenerationNode.tsx'], /<GenerationNodePreview[\s\S]*?state=\{state\}/);
  assert.match(sources['GenerationNode.tsx'], /<ScreenSpaceComposer nodeId=\{node\.id\}>[\s\S]*?<GenerationNodeComposer/);
  assert.match(sources['GenerationNodePreview.tsx'], /videoPreviewRef/);
  assert.match(sources['GenerationNodeComposer.tsx'], /isImeKeyEvent\(e\.nativeEvent\)/);
  assert.match(sources['GenerationNodeComposer.tsx'], /<GenerationSettingsPanel[\s\S]*?onConfigChange=\{setConfig\}/);
  // 图片编辑覆盖层只挂在媒体体里，由自己的模块消费浮层挂载点。
  assert.match(sources['GenerationNodePreview.tsx'], /<GenerationNodeImageOverlays[\s\S]*?anchorRef=\{annotationAnchorRef\}/);
  assert.match(sources['GenerationNodeImageOverlays.tsx'], /useContext\(CanvasOverlayRootContext\)/);
  assert.doesNotMatch(sources['GenerationNodePreview.tsx'], /ImageCropEditor|ImageAnnotationEditor/);
});
