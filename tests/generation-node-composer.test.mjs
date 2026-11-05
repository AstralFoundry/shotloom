import assert from 'node:assert/strict';
import test from 'node:test';
import { readGenerationNodeSource } from './helpers/generationNodeSource.mjs';
import { readSource } from './helpers/sourceContract.mjs';
const source = readGenerationNodeSource();
const styles = readSource('renderer/styles/canvas.css');
const adapter = readSource('renderer/src/app/adapters/canvasAdapter.ts');
const editorStyles = readSource('renderer/src/app/editor/OpenReelWorkspace.css');
test('发送按钮仅在节点运行时禁用并提供反馈', () => {
  assert.match(source, /disabled=\{busy\}/); assert.doesNotMatch(source, /modelStatus\.available/); assert.match(source, /actions\.run\(node\.id\)/);
});
test('点击发送与输入框回车复用运行入口', () => {
  assert.match(source, /onKeyDown=[\s\S]*?actions\.run\(node\.id\)/); assert.match(source, /onClick=\{\(\) => actions\.run\(node\.id\)\}/);
});
test('文本节点提示词与节点正文使用独立数据', () => {
  assert.match(source, /textNodeContent\(\{ \.\.\.node, generatedOutputs: outputs \}\)/);
  assert.doesNotMatch(source, /node\.textContent \|\| node\.prompt/);
  assert.match(source, /placeholder=\{kind === "text"\s*\?\s*"输入给大模型的文本生成提示词"/);
  // 音频节点是逐字朗读而不是按描述生成：占位文案必须说清这里放的是要朗读的文本。
  assert.match(source, /kind === "audio"\s*\?\s*"输入要朗读的文本"/);
  assert.match(source, /className="text-result-starters nodrag nopan"[\s\S]*?试试：[\s\S]*?className="text-result-starter"[\s\S]*?自己编写内容/);
});
test('非文本节点使用模型目录类型与节点内配置面板', () => {
  assert.match(source, /getTypeMeta\(node\.type\)/); assert.match(source, /work-composer nodrag nopan nowheel/);
});
test('画布节点优先显示可辨识名称且空节点回退到简短类型名', () => {
  assert.match(source, /function generationNodeDisplayTitle/);
  assert.match(source, /output\?\.fileName, output\?\.title, uploaded\?\.name, node\.title/);
  assert.match(source, /genericNames\.has\(stem\)/);
  assert.match(source, /return typeLabel\.replace\(\/生成\$\/, ""\) \|\| "节点"/);
  assert.match(source, /<div className="work-visual-block">/);
  assert.match(styles, /\.work-node-kicker \{[\s\S]*?inset: -28px 0 auto/);
  assert.doesNotMatch(styles, /\.work-visual-block\.has-kicker-label/);
  assert.match(source, /CanvasNodeLabelRootContext/);
  assert.match(source, /labelRoot && createPortal\(nodeLabel, labelRoot\)/);
  assert.match(source, /className="work-node-type-icon" name=\{metaIcon\}[\s\S]*?<span[\s\S]*?title=\{displayTitle\}[\s\S]*?>\{displayTitle\}<\/span>[\s\S]*?className="work-node-kicker-actions"/);
  assert.match(styles, /\.canvas-node-label-anchor \.work-node-kicker \{[\s\S]*?inset: 0;[\s\S]*?height: 100%/);
  assert.match(styles, /\.canvas-node-label-anchor \.work-node-kicker > svg \{[\s\S]*?var\(--node-label-zoom, 1\)/);
  assert.match(styles, /\.work-node-kicker > \.work-node-type-icon \{[\s\S]*?background: var\(--muted\)/);
});
test('节点输入面板固定在屏幕空间，不跟随画布倍率缩放', () => {
  assert.match(source, /ScreenSpaceComposer/);
  assert.match(source, /createPortal/);
  assert.match(source, /CanvasOverlayRootContext/);
  assert.match(source, /viewportX \+ .* \* zoom/);
  assert.match(styles, /\.work-composer \{[\s\S]*?position:\s*relative/);
  assert.match(styles, /\.work-composer-anchor \{[\s\S]*?z-index:\s*var\(--layer-canvas-composer\)/);
  assert.doesNotMatch(styles, /\.work-composer \{[\s\S]*?top:\s*calc\(100% \+ 10px\)/);
});

test('纯上传资源节点不显示下方输入面板', () => {
  // 只有"用户放进来的文件"这一类来源隐藏面板；裁剪/标注/宫格/截帧/导演台/拼接/对话产物都留在集合外。
  assert.match(source, /const uploadedResourceSourceTypes = new Set\(\["canvas-upload", "node-upload", "material-library"\]\)/);
  // 生成结果优先：节点有模型产物时面板照常出现，隐藏只看当前选中的那一份输出。
  assert.match(source, /const uploadedResource = !selectedOutput && Boolean\(uploaded\)/);
  assert.match(source, /\{selected && !imageCropMode && !state\.uploadedResource && \(\s*\n\s*<ScreenSpaceComposer nodeId=\{node\.id\}>\s*\n\s*<GenerationNodeComposer/);
  // 生成型 starter 把提示词写进这个面板，面板不在时不能留下无效入口。
  assert.match(source, /\{!uploadedResource && TEXT_NODE_STARTERS\.map/);
});

test('节点输入面板使用四分之三紧凑尺寸', () => {
  assert.match(source, /Math\.min\(570, Math\.max\(320, rootWidth - 24\)\)/);
  assert.match(styles, /\.work-composer \{[\s\S]*?height:\s*186px/);
  assert.match(styles, /\.work-composer-add \{[\s\S]*?width:\s*var\(--canvas-slot-size\);[\s\S]*?height:\s*var\(--canvas-slot-size\)/);
  assert.match(styles, /\.work-composer-input \{[\s\S]*?width:\s*var\(--canvas-slot-size\);[\s\S]*?height:\s*var\(--canvas-slot-size\)/);
  // 缩略图行只在触发器在场时让位，让的宽度由触发器自身尺寸派生。
  assert.doesNotMatch(styles, /width:\s*calc\(100% - 160px\)/);
  assert.match(styles, /\.work-composer:has\(\.preset-picker\) \.work-composer-inputs \{ width: calc\(100% - var\(--canvas-composer-trigger-reserve\)\); \}/);
});

test('长提示词滚动时不会进入参考素材区域', () => {
  assert.match(styles, /\.work-prompt-shell \{[^}]*?display:\s*flex;[^}]*?flex-direction:\s*column/);
  assert.match(styles, /\.work-composer-inputs \{[\s\S]*?position:\s*relative;[\s\S]*?flex:\s*0 0 var\(--canvas-slot-size\)/);
  assert.match(styles, /\.work-prompt-editor \{[^}]*?flex:\s*1 1 auto;[^}]*?overflow:\s*auto/);
  assert.doesNotMatch(styles, /\.work-prompt-editor \{[^}]*?padding:\s*47px/);
  // 输入面板高度固定，没有参考槽位的节点（纯文本生成）不能让空行白占一整档行高。
  assert.match(styles, /\.work-composer-inputs:empty \{ display: none; \}/);
});

test('节点输入面板层级被限制在画布内且不会盖住剪辑工作区', () => {
  assert.match(styles, /\.react-workflow-canvas \{[\s\S]*?isolation:\s*isolate/);
  assert.doesNotMatch(styles, /\.work-composer-anchor \{[\s\S]*?z-index:\s*10000/);
  // 剪辑台铺在内容区挂载点里，靠 .content 的层叠上下文隔离，不再用应用级 z-index 逃逸。
  assert.match(editorStyles, /\.ov-openreel \{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;[\s\S]*?z-index:\s*10\b/);
  assert.doesNotMatch(editorStyles, /\.ov-openreel[^{]*\{[^}]*?position:\s*fixed/);
});

test('参考素材入口创建真实上游节点和连线，缩略图可放大并可独立移除', () => {
  assert.match(source, /mediaInputs\.map\([\s\S]*?ComposerInputThumbnail/);
  assert.match(source, /actions\.addReference\(node\.id(?:, slot)?\)/);
  assert.match(source, /actions\.removeIncomingEdge\(node\.id, input\.edgeId\)/);
  assert.match(source, /getGenerationInputModes\(selectedModel\)/);
  assert.match(source, /actions\.setInputMode\(nodeId, mode\.value\)/);
  assert.match(source, /actions\.setInputMode\(node\.id, nextMode\.value\)/);
  assert.match(source, /className="work-composer-input-preview"/);
  assert.match(source, /openMediaViewer\(\{[\s\S]*?src: url,[\s\S]*?filePath: String\(input\.filePath \|\| input\.path/);
  assert.match(source, /className="work-composer-input-remove"/);
  assert.match(styles, /\.work-composer-input-preview > :is\(img, video\)[^}]*object-fit: cover/);
  assert.match(styles, /cursor:\s*zoom-in/);
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
  assert.match(source, /paramPresentation\(param\)\.control !== "hidden"/);
  assert.match(source, /control === "slider"/);
  assert.match(source, /control === "select"/);
  assert.match(source, /className="generation-settings-group-title"/);
  assert.match(source, /className="generation-settings-input nodrag nopan"/);
  assert.match(styles, /\.generation-settings-panel \{[\s\S]*?width:\s*384px/);
  assert.match(styles, /\.generation-settings-input \{/);
  assert.match(styles, /\.generation-settings-slider \{/);
  // 比例卡：5 列时单卡可用文字宽恰好等于最长标签（实测 59px 对 59px），零余量会在真机折行。
  assert.match(styles, /\.ratios \{[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(\s*(7[6-9]|8[0-9]|9[0-9])px/);
  assert.match(styles, /\.ratios button \{[^}]*min-height:\s*56px/);
  assert.doesNotMatch(styles, /\.ratios button \{[^}]*[^-]height:/, '固定高度会让两行标签溢出卡片');
  assert.match(styles, /\.generation-settings-group-title \{/);
  // 原生 select 的上下双箭头是操作系统控件，和面板里的选项块、音色选择器不是同一套图形。
  assert.match(source, /className="generation-settings-select"/);
  assert.match(source, /<select[\s\S]{0,140}aria-label=\{param\.label\}/);
  assert.match(styles, /\.generation-settings-select > select \{[^}]*appearance: none/);
  assert.match(styles, /\.generation-settings-select > svg \{[^}]*position: absolute/);
  // 倍率型滑杆的轨道映射只读目录声明，界面不再自己算 min/max。
  assert.match(source, /sliderTrackDomain\(param\)/);
  assert.match(source, /sliderValueFromTrack\(param, Number\(event\.target\.value\)\)/);
  assert.doesNotMatch(source, /const min = Number\(presentation\.min\)/, '滑杆轨道域只能由 modelPresentation 一处计算');
  // 滑杆的值是裸数字，摘要里必须带参数名，否则"· 1 ·"读不出是哪项参数。
  assert.match(source, /paramSummary\(param, config\[param\.key\] \?\? param\.default\)/);
  // 摘要由统一展示模块生成；双语和滑杆行为在 i18n.test.mjs 中执行验证。
  assert.match(source, /import \{ paramSummary \} from "\.\.\/\.\.\/utils\/modelPresentation\.ts"/);
  assert.match(styles, /\.work-run-btn \{[^}]*?flex:\s*0 0 var\(--canvas-slot-size\)/);
  assert.match(styles, /\.work-composer \{[\s\S]*?width:\s*100%/);
  assert.match(source, /className="work-composer nodrag nopan nowheel"[\s\S]*?onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(source, /className="generation-settings-panel nodrag nopan nowheel"/);
});

test('切换模型时按新协议重编译配置，空数字不写成零、自由文本可写回', () => {
  assert.match(source, /model,[\s\S]*?config: compileGenerationNodeConfig\([\s\S]*?getModelSchema\(node\.type, model\)\.params/);
  assert.match(source, /onConfigChange\(param\.key, numeric \? \(value === "" \? undefined : Number\(value\)\) : value\)/);
  assert.doesNotMatch(source, /numeric && value !== "" \? Number\(value\) : undefined/, '自由文本参数不得被写成 undefined');
  assert.match(source, /min=\{numeric && Number\.isFinite\(Number\(presentation\.min\)\)/);
  assert.match(source, /max=\{numeric && Number\.isFinite\(Number\(presentation\.max\)\)/);
});
