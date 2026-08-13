import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const source = readFileSync(new URL('../renderer/src/app/canvas/GenerationNode.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../renderer/styles/react-migration.css', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('../renderer/src/app/adapters/canvasAdapter.ts', import.meta.url), 'utf8');
const editorStyles = readFileSync(new URL('../renderer/src/app/editor/VideoEditorWorkspace.css', import.meta.url), 'utf8');
test('发送按钮仅在节点运行时禁用并提供反馈', () => {
  assert.match(source, /disabled=\{busy\}/); assert.doesNotMatch(source, /modelStatus\.available/); assert.match(source, /actions\.run\(node\.id\)/);
});
test('点击发送与输入框回车复用运行入口', () => {
  assert.match(source, /onKeyDown=[\s\S]*?actions\.run\(node\.id\)/); assert.match(source, /onClick=\{\(\) => actions\.run\(node\.id\)\}/);
});
test('文本节点提示词与节点正文使用独立数据', () => {
  assert.match(source, /textNodeContent\(\{ \.\.\.node, generatedOutputs: outputs \}\)/);
  assert.doesNotMatch(source, /node\.textContent \|\| node\.prompt/);
  assert.match(source, /placeholder=\{kind === "text" \? "输入给大模型的文本生成提示词"/);
  assert.match(source, /className="text-result-manual nodrag nopan"[\s\S]*?自己编写内容/);
});
test('非文本节点使用模型目录类型与节点内配置面板', () => {
  assert.match(source, /getTypeMeta\(node\.type\)/); assert.match(source, /work-composer nodrag nopan nowheel/);
});
test('画布节点只显示可辨识名称，不重复铺生成类型', () => {
  assert.match(source, /function generationNodeDisplayTitle/);
  assert.match(source, /output\?\.fileName, output\?\.title, uploaded\?\.name, node\.title/);
  assert.match(source, /genericNames\.has\(stem\)/);
  assert.match(source, /<div className="work-visual-block">/);
  assert.match(styles, /\.work-node-kicker \{[\s\S]*?inset: -20px 0 auto/);
  assert.doesNotMatch(styles, /\.work-visual-block\.has-kicker-label/);
  assert.match(source, /CanvasNodeLabelRootContext/);
  assert.match(source, /labelRoot && createPortal\(nodeLabel, labelRoot\)/);
  assert.match(source, /<span title=\{displayTitle\}>\{displayTitle\}<\/span>[\s\S]*?className="work-node-kicker-actions"/);
  assert.match(styles, /\.canvas-node-label-anchor \.work-node-kicker \{[\s\S]*?inset: 0;[\s\S]*?height: 100%/);
});
test('节点输入面板固定在屏幕空间，不跟随画布倍率缩放', () => {
  assert.match(source, /ScreenSpaceComposer/);
  assert.match(source, /createPortal/);
  assert.match(source, /CanvasOverlayRootContext/);
  assert.match(source, /viewportX \+ .* \* zoom/);
  assert.match(styles, /\.work-composer \{[\s\S]*?position:\s*relative/);
  assert.match(styles, /\.work-composer-anchor \{[\s\S]*?z-index:\s*120/);
  assert.doesNotMatch(styles, /\.work-composer \{[\s\S]*?top:\s*calc\(100% \+ 10px\)/);
});

test('节点输入面板使用四分之三紧凑尺寸', () => {
  assert.match(source, /Math\.min\(570, Math\.max\(320, rootWidth - 24\)\)/);
  assert.match(styles, /\.work-composer \{[\s\S]*?height:\s*186px/);
  assert.match(styles, /\.work-composer-add \{[\s\S]*?width:\s*36px;[\s\S]*?height:\s*36px/);
  assert.match(styles, /\.work-composer-input \{[\s\S]*?width:\s*36px;[\s\S]*?height:\s*36px/);
});

test('节点输入面板层级被限制在画布内且不会盖住剪辑工作区', () => {
  assert.match(styles, /\.react-workflow-canvas \{[\s\S]*?isolation:\s*isolate/);
  assert.doesNotMatch(styles, /\.work-composer-anchor \{[\s\S]*?z-index:\s*10000/);
  assert.match(editorStyles, /\.ov-editor \{[\s\S]*?z-index:\s*1500/);
});

test('参考素材入口创建真实上游节点和连线并显示可移除缩略图', () => {
  assert.match(source, /mediaInputs\.map\([\s\S]*?ComposerInputThumbnail/);
  assert.match(source, /actions\.addReference\(node\.id(?:, slot)?\)/);
  assert.match(source, /actions\.removeIncomingEdge\(node\.id, input\.edgeId\)/);
  assert.match(source, /getGenerationInputModes\(selectedModel\)/);
  assert.match(source, /actions\.setInputMode\(node\.id, mode\.value\)/);
  assert.match(styles, /\.work-composer-input > :is\(img, video\)[^}]*object-fit: cover/);
  assert.match(adapter, /async addReference\(id, requestedSlot\)[\s\S]*?createUploadedNode\(picked/);
  assert.match(adapter, /inputSlot: resolvedSlot/);
  assert.match(adapter, /addCanvasEdge\(store\.project, source\.id, id/);
  assert.match(adapter, /removeIncomingEdge\(id, edgeId\)[\s\S]*?item\.id !== edgeId/);
});

test('生成参数收纳到分组面板且发送按钮保持在底栏', () => {
  assert.match(source, /generation-settings-trigger/);
  assert.match(source, /className="generation-settings-panel nodrag nopan nowheel"/);
  assert.match(source, /<p>生成方式<\/p>/);
  assert.match(source, /generation-settings-options/);
  assert.match(styles, /\.generation-settings-panel \{[\s\S]*?width:\s*380px/);
  assert.match(styles, /\.work-run-btn \{[^}]*?flex:\s*0 0 32px/);
  assert.match(styles, /\.work-composer \{[\s\S]*?width:\s*100%/);
  assert.match(source, /className="work-composer nodrag nopan nowheel"[\s\S]*?onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(source, /className="generation-settings-panel nodrag nopan nowheel"/);
});
