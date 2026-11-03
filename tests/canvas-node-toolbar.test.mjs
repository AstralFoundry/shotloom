import assert from 'node:assert/strict';
import test from 'node:test';
import { readGenerationNodeSource } from './helpers/generationNodeSource.mjs';
import { readLocalizedSource as readSource } from './helpers/sourceContract.mjs';

const toolbar = readSource('renderer/src/app/canvas/CanvasNodeToolbar.tsx');
const customizeDialog = readSource('renderer/src/app/canvas/CanvasToolbarCustomizeDialog.tsx');
const workflowCanvas = readSource('renderer/src/app/canvas/WorkflowCanvas.tsx');
const canvas = toolbar + workflowCanvas;
const cropEditor = readSource('renderer/src/app/components/ImageCropEditor.tsx');
const annotationEditor = readSource('renderer/src/app/components/ImageAnnotationEditor.tsx');
const generation = readGenerationNodeSource();
const basicNodes = readSource('renderer/src/app/canvas/CanvasNodes.tsx');
const director = readSource('renderer/src/app/canvas/ThreeDDirectorNode.tsx');
const styles = ['canvas.css', 'media-overlays.css']
  .map((name) => readSource(`../renderer/styles/${name}`))
  .join('\n');
const adapter = readSource('renderer/src/app/adapters/canvasAdapter.ts')
  + readSource('renderer/src/app/adapters/canvas/canvasMediaActions.ts');
const api = readSource('renderer/src/services/tauriApi.ts');
const browserApi = readSource('renderer/src/services/desktopApi.ts');
const audioRust = readSource('src-tauri/src/commands/audio.rs');
const fileRust = readSource('src-tauri/src/commands/file.rs');
const imageRust = readSource('src-tauri/src/commands/image.rs');
const settings = readSource('renderer/src/store/settingsStore.ts');
const nodeChrome = await import('../renderer/src/utils/canvasNodeChrome.ts');
const toolbarContract = await import('../renderer/src/utils/canvasNodeToolbar.ts');

test('画布节点外框与选中操作工具栏保持职责分离', () => {
  assert.match(workflowCanvas, /import \{ CanvasNodeToolbar \}/);
  assert.match(workflowCanvas, /<CanvasNodeToolbar[\s\S]*?canvasOverlayRoot=\{canvasOverlayRoot\}/);
  assert.doesNotMatch(workflowCanvas, /desktopApi\.file\.hasAudio|openMenu === "asset"|<ImageCropEditor/);
  assert.match(toolbar, /desktopApi\.file\.hasAudio/);
  assert.match(toolbar, /openMenu === "asset"/);
  assert.match(toolbar, /onImageCropOpen/);
});

test('加入对话只在节点选中工具栏中显示', () => {
  assert.match(canvas, /<NodeToolbar[\s\S]*?canvas-node-selection-toolbar--hidden[\s\S]*?isVisible=\{selected && !imageAnnotationOpen\}[\s\S]*?offset=\{toolbarOffset\}[\s\S]*?>[\s\S]*?加入对话[\s\S]*?<\/NodeToolbar>/);
  assert.match(canvas, /mentionNode\(node\.id\)/);
  // 3D 导演台不挂引用入口，工具栏整体不渲染，而不是留下一个空壳。
  assert.match(toolbar, /node\.type === "threeDDirector" \|\| node\.type === "clipStudio" \? null : addNodeMention/);
  assert.match(toolbar, /hasToolbar = isTextNode \|\| canUpload \|\| mentionNode \|\|/);
  assert.match(styles, /\.canvas-node-selection-toolbar \{[\s\S]*?z-index: var\(--layer-canvas-control\)/);
  for (const source of [generation, basicNodes, director]) {
    assert.doesNotMatch(source, /className="node-mention-btn/);
  }
});

test('画布不存在便签与画板节点', () => {
  const navigation = readSource('renderer/src/app/constants/navigation.ts');
  const nodeTypes = readSource('renderer/src/services/agentTypes.ts');
  const registry = readSource('renderer/src/app/canvas/nodeRegistry.ts');
  assert.doesNotMatch(nodeTypes, /'note'|'board'/);
  for (const source of [navigation, registry, workflowCanvas, styles]) {
    assert.doesNotMatch(source, /\bnote\b|\bboard\b/);
  }
});

test('文本节点工具栏提供复制、加入对话与完整文本编辑', () => {
  assert.match(canvas, /isTextNode = node\.type === "textGeneration"/);
  assert.match(canvas, /canvas-node-toolbar-label">文本节点/);
  assert.match(canvas, /title="复制全文"[\s\S]*?navigator\.clipboard\.writeText\(textContent\)/);
  assert.match(canvas, /title="打开完整文本"[\s\S]*?openTextDetail\(\)/);
  assert.match(canvas, /openMediaViewer\(\{[\s\S]*?kind: "text"[\s\S]*?actions\.update\(node\.id/);
  assert.doesNotMatch(canvas, /item\.textContent \|\| item\.prompt/);
});

test('媒体节点工具栏提供真实入库与音频分离', () => {
  assert.match(toolbar, /label: audioSplitRunning \? "拆分中…"[\s\S]*?disabled: !canExtractAudio \|\| audioSplitRunning,[\s\S]*?actions\.extractAudio\(node\.id\)/);
  assert.match(canvas, /desktopApi\.file\.hasAudio\(localMediaPath\)[\s\S]*?"present"\s*:\s*"absent"/);
  assert.match(canvas, /canSaveToAssets[\s\S]*?存为资产[\s\S]*?openMenu === "asset"/);
  assert.match(canvas, /assetCategories\.map[\s\S]*?setAssetCategory\(category\.id\)/);
  assert.match(canvas, /createPortal\([\s\S]*?canvas-node-asset-scope-menu--portal[\s\S]*?canvasOverlayRoot/);
  assert.match(canvas, /assetPlacementRevision = useStore[\s\S]*?positionAbsolute[\s\S]*?state\.transform/);
  assert.match(canvas, /actions\.saveToAssets\(node\.id, "project", assetCategory\)[\s\S]*?<strong>存到项目<\/strong>/);
  assert.match(canvas, /actions\.saveToAssets\(node\.id, "global", assetCategory\)[\s\S]*?<strong>存到全局<\/strong>/);
  assert.match(adapter, /async function saveToAssets\([\s\S]*?scope === "project"[\s\S]*?addMaterialToAssetLibrary[\s\S]*?promoteMaterialToLocalLibrary/);
  assert.match(adapter, /assetDetails = \{[\s\S]*?category,[\s\S]*?promoteMaterialToLocalLibrary/);
  assert.match(adapter, /scope === "project"[\s\S]*?ensureMaterialStoredInProjectAssets\(projectMaterial\)[\s\S]*?addMaterialToAssetLibrary/);
  assert.match(styles, /\.canvas-node-asset-scope-menu \{[\s\S]*?width:\s*220px/);
  assert.match(styles, /\.canvas-node-asset-scope-menu--portal \{[\s\S]*?z-index:\s*calc\(var\(--layer-canvas-composer\) \+ 1\)/);
  assert.match(styles, /\.react-workflow-canvas \{[\s\S]*?isolation:\s*isolate/);
  assert.match(adapter, /async function extractAudio\(id: string\)[\s\S]*?separateAudioToProject[\s\S]*?addNode\("videoGeneration"\)[\s\S]*?addNode\("audioGeneration"\)/);
  assert.match(adapter, /sourceDimensions = canvasNodeDimensions\(source\)[\s\S]*?silentVideo\.y \+ canvasNodeDimensions\(silentVideo\)\.height \+ 48/);
  assert.match(adapter, /addCanvasEdge\(store\.project, source\.id, silentVideo\.id[\s\S]*?addCanvasEdge\(store\.project, source\.id, audio\.id/);
  assert.match(api, /separateAudioToProject:[\s\S]*?file:separate-audio/);
  assert.match(api, /hasAudio:[\s\S]*?file:has-audio/);
  assert.match(audioRust, /fn probe_audio[\s\S]*?source_has_audio/);
  assert.match(audioRust, /pub async fn file_has_audio[\s\S]*?spawn_blocking/);
  assert.match(audioRust, /pub async fn file_separate_audio[\s\S]*?spawn_blocking/);
  assert.match(audioRust, /fn separate_audio[\s\S]*?source_has_audio[\s\S]*?"-map", "0:a:0"[\s\S]*?"-c:a", "aac"[\s\S]*?"-map", "0:v:0"[\s\S]*?"-an"[\s\S]*?"copy"/);
});

test('取尾帧按真实媒体时长寻址，不依赖空桩', () => {
  const probeRust = readSource('src-tauri/src/commands/media_probe.rs');
  assert.match(toolbar, /desktopApi\.file\.probeMedia\?\.\(localMediaPath\)/);
  assert.match(toolbar, /duration - 1 \/ 30/);
  assert.match(api, /probeMedia:[\s\S]*?file:probe-media/);
  assert.match(api, /invoke\('file_probe_media', \{ source: args\[0\] \}\)/);
  assert.match(probeRust, /pub async fn file_probe_media[\s\S]*?spawn_blocking/);
  assert.match(probeRust, /"format=duration"/);
  // ffprobe 缺席时退回解析 ffmpeg 打印的流信息，两条路都不解码画面。
  assert.match(probeRust, /probe_with_ffmpeg\(&media_tool\("ffmpeg"\)\?, &source\)/);
  // 浏览器预览没有 FFmpeg，只能明确返回空元数据而不是假装探测成功。
  assert.match(browserApi, /probeMedia:[\s\S]*?duration: null/);
});

test('本地图片节点提供原图裁剪与宫格切分两个入口', () => {
  assert.match(toolbar, /case "crop":[\s\S]*?title: "在画布上裁剪图片"[\s\S]*?onImageCropOpen\("crop"\)/);
  assert.match(toolbar, /case "split-grid":[\s\S]*?onImageCropOpen\("grid"\)/);
  assert.match(workflowCanvas, /imageCropMode=\{imageCropMode\}[\s\S]*?onImageCropOpen=\{\(mode\)/);
  assert.match(workflowCanvas, /setImageAnnotationOpen\(false\)[\s\S]*?setImageCropMode\(mode\)/);
  assert.match(workflowCanvas, /setImageCropMode\(null\)[\s\S]*?setImageAnnotationOpen\(true\)/);
  assert.match(generation, /<ImageCropEditor[^]*?initialMode=\{imageCropMode\}[^]*?actions\.cropImage\(node\.id, rect\)/);
  assert.match(cropEditor, /useState<"crop" \| "grid">\(initialMode\)/);
  assert.match(cropEditor, /createPortal\([^]*?canvas-image-crop-toolbar[^]*?, root\)/);
  assert.match(cropEditor, /ratios[\s\S]*?"1:1"[\s\S]*?"16:9"[\s\S]*?"9:16"/);
  assert.match(adapter, /async function cropImage\(id: string, crop: ImageCropRect\)[\s\S]*?cropImageToProject[\s\S]*?addNode\("imageGeneration"\)/);
  assert.match(adapter, /addCanvasEdge\(store\.project, source\.id, output\.id[\s\S]*?derivation: "image-crop"/);
  assert.match(api, /case 'file:crop-image':[\s\S]*?file_crop_image/);
  assert.match(api, /cropImageToProject:[\s\S]*?file:crop-image/);
  assert.match(imageRust, /pub async fn file_crop_image[\s\S]*?spawn_blocking/);
  assert.match(imageRust, /fn crop_image[\s\S]*?apply_orientation[\s\S]*?crop_imm[\s\S]*?ImageFormat::Png/);
  assert.match(styles, /\.canvas-image-crop-layer \{/);
  assert.match(styles, /\.canvas-image-crop-toolbar \{[^}]*z-index:\s*var\(--layer-canvas-composer\)/);
});

test('本地图片节点使用 react-screenshots 完成标注并保存合成图片', () => {
  assert.match(toolbar, /title: "标注图片"[\s\S]*?onClick: onImageAnnotationOpen/);
  assert.match(workflowCanvas, /imageAnnotationOpen=\{imageAnnotationOpen\}[\s\S]*?onImageAnnotationOpen/);
  assert.match(generation, /ImageAnnotationEditor[\s\S]*?imageUrl=\{previewUrl\}[\s\S]*?saveDataUrlToProject/);
  assert.match(annotationEditor, /react-screenshots\/lib\/Screenshots\/ScreenshotsCanvas/);
  assert.match(annotationEditor, /operation_text_title: "标注"/);
  assert.match(annotationEditor, /operation_mosaic_title: "马赛克"/);
  assert.match(generation, /saveDataUrlToProject/);
  assert.match(generation, /annotationImagePath/);
  assert.match(styles, /\.canvas-image-annotation-editor \.screenshots \{/);
  // 标注浮层必须自己裁圆角：卡片靠 --canvas-node-radius 裁图，浮层不裁就在四个角上露出方角画布。
  assert.match(styles, /\.canvas-image-annotation-editor \.screenshots,\s*\n\.canvas-image-annotation-editor \.screenshots-canvas \{ border-radius: calc\(var\(--canvas-node-radius\) \* var\(--canvas-annotation-zoom, 1\)\); \}/);
  assert.match(annotationEditor, /"--canvas-annotation-zoom": String\(semanticZoom\)/);
  // 只裁图像层，外层容器仍要 visible，否则操作条浮不到图片之外。
  assert.match(styles, /\.canvas-image-annotation-editor \{\n(?:[^}\n]*\n)*?  overflow: visible;/);
  assert.match(annotationEditor, /ScreenshotsContext\.Provider/);
  // 图标档位与节点选中工具栏同一档（--icon-md）：第三方图标字体按 em 刻字，缩到这一档才不比产品线性图标粗。
  assert.match(styles, /\.canvas-node-selection-toolbar svg \{ width: var\(--icon-md\); height: var\(--icon-md\); \}/);
  assert.match(styles, /\.canvas-image-annotation-editor \.screenshots-button \{\n(?:[^}\n]*\n)*?  font-size: var\(--icon-md\);\n/);
  assert.match(styles, /\.canvas-image-annotation-editor \.screenshots-button > span \{\n  line-height: 1;\n\}/);
  // 分隔线由本项目给出：第三方自带的样式是 26px 实色粗线，会在细图标之间形成更重的块。
  assert.match(styles, /\.canvas-image-annotation-editor \.screenshots-operations-divider \{\n  width: var\(--toolbar-divider-width\);/);
});

// 标注的第二条出路：把合成结果另存成新素材并派生一个节点，原节点一个字段都不动。
test('标注可以派生新的图片节点而不改动原节点', () => {
  // 操作条由本项目拼接，否则第三方那份固定的按钮清单里放不下"生成新节点"。
  assert.match(annotationEditor, /import annotationOperations from "\.\.\/\.\.\/\.\.\/\.\.\/node_modules\/react-screenshots\/lib\/Screenshots\/operations\/index\.js"/);
  assert.match(annotationEditor, /annotationOperations\.map/);
  assert.match(annotationEditor, /title="标注完成，生成新节点"/);
  assert.match(annotationEditor, /compose\(onCreateNode\)/);
  // 合成必须和"完成"走同一条路：先摘掉选中态，否则蓝色选择框会被画进结果图。
  assert.match(annotationEditor, /HistoryItemType\.Source\) item\.isSelected = false/);
  assert.match(annotationEditor, /composeImage\(\{ image, width, height, history, bounds \}\)/);
  assert.match(generation, /if \(await actions\.createAnnotationNode\(node\.id, blob\)\) onImageAnnotationClose\?\.\(\)/);

  // 标注与水印共用同一条派生路径：结果存成素材、派生新节点、原节点一个字段都不改。
  const derivedAction = adapter.slice(
    adapter.indexOf('async function createDerivedImageNode'),
    adapter.indexOf('export async function createAnnotationNode'),
  );
  assert.ok(derivedAction.length > 0, '缺少 createDerivedImageNode 实现');
  assert.doesNotMatch(derivedAction, /annotationImageUrl|annotationData|Object\.assign\(/);
  assert.match(derivedAction, /recordCanvasHistory\([\s\S]*?addNode\("imageGeneration"\)/);
  assert.match(derivedAction, /output\.uploadedFile = \{[\s\S]*?filePath,[\s\S]*?mimeType: "image\/png"/);
  assert.match(derivedAction, /derivation: spec\.source/);
  for (const [name, source, suffix] of [
    ['createAnnotationNode', 'image-annotation', '标注'],
    ['createWatermarkNode', 'image-watermark', '水印'],
  ]) {
    const wrapper = adapter.slice(
      adapter.indexOf(`export async function ${name}`),
      adapter.indexOf(`export async function ${name}`) + 400,
    );
    assert.match(wrapper, new RegExp(`source: "${source}"`), `${name} 必须标来源`);
    assert.match(wrapper, new RegExp(`suffix: "${suffix}"`), `${name} 必须标后缀`);
  }
  assert.match(styles, /\.canvas-image-annotation-editor \.canvas-annotation-node-button svg \{\s*\n\s*width: var\(--icon-md\);/);
});

test('图片水印工具接线完整，预览与导出共用同一份几何', () => {
  const watermarkRender = readSource('renderer/src/utils/watermarkRender.ts');
  const watermarkEditor = readSource('renderer/src/app/components/ImageWatermarkEditor.tsx');
  const overlays = readSource('renderer/src/app/canvas/GenerationNodeImageOverlays.tsx');

  // 注册表里列出了水印，工具条就必须真的接上它，并且按钮状态跟随编辑器开关。
  assert.match(toolbar, /case "watermark":[\s\S]*?pressed: imageWatermarkOpen[\s\S]*?onClick: onImageWatermarkOpen/);
  // 预览按显示尺寸缩放同一份参数，不允许预览和导出各写一套几何。
  assert.match(watermarkRender, /export function drawWatermark\(/);
  assert.match(watermarkEditor, /scaledWatermarkSettings\(settings, rect\.width \/ imageWidth\)/);
  assert.match(watermarkEditor, /renderWatermarkedBlob\(imageUrl, settings\)/);
  // 结果存成项目素材并派生新图片节点，原节点一个字段都不动。
  assert.match(overlays, /actions\.createWatermarkNode\(node\.id, blob\)/);
  assert.match(styles, /\.canvas-image-watermark-panel \{[^}]*z-index: var\(--layer-canvas-composer\)/);
});

test('空媒体节点从顶部工具栏上传且节点内部只保留占位图标', () => {
  assert.match(canvas, /const canUpload = Boolean\(uploadLabel && !hasMediaContent\)/);
  assert.match(canvas, /toolbarOffset = canvasNodeToolbarOffset\(semanticZoom, useSubtleUploadToolbar\)/);
  assert.match(canvas, /useSubtleUploadToolbar[\s\S]*?canvas-node-selection-toolbar--subtle[\s\S]*?offset=\{toolbarOffset\}/);
  assert.match(canvas, /\{canUpload && \([\s\S]*?title=\{`上传\$\{uploadLabel\}`\}[\s\S]*?actions\.upload\(node\.id\)/);
  assert.doesNotMatch(generation, /className="work-empty-upload/);
  assert.doesNotMatch(generation, /上传\{metaLabel\.replace/);
  assert.match(styles, /--canvas-node-state-icon-size:\s*34px/);
  assert.match(styles, /\.work-preview \.work-empty-type-icon \{[^}]*width:\s*var\(--canvas-node-state-icon-size\)[^}]*height:\s*var\(--canvas-node-state-icon-size\)/);
  assert.match(styles, /\.canvas-node-selection-toolbar--subtle \{[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none/);
  assert.match(styles, /\.canvas-node-selection-toolbar--subtle button \{[\s\S]*?height:\s*var\(--canvas-toolbar-action-compact\);[\s\S]*?font-size:\s*var\(--text-body-12\)/);
});

test('节点顶部工具栏保持屏幕字号并随名称高度避让', () => {
  assert.equal(nodeChrome.canvasNodeToolbarOffset(0.55, true), 26);
  assert.equal(nodeChrome.canvasNodeToolbarOffset(1, true), 34);
  assert.equal(nodeChrome.canvasNodeToolbarOffset(1.8, true), 56.4);
  assert.equal(nodeChrome.canvasNodeToolbarOffset(0.55, false), 38);
  assert.equal(nodeChrome.canvasNodeToolbarOffset(1, false), 38);
  assert.equal(nodeChrome.canvasNodeToolbarOffset(1.8, false), 60.4);
  assert.match(canvas, /top: -CANVAS_NODE_LABEL_OFFSET \* semanticZoom/);
  assert.match(canvas, /height: CANVAS_NODE_LABEL_HEIGHT \* semanticZoom/);
  assert.match(styles, /\.canvas-node-selection-toolbar--subtle button \{[^}]*font-size:\s*var\(--text-body-12\)/);
  assert.doesNotMatch(styles, /canvas-node-selection-toolbar[^}]*transform:\s*scale/);
});

// 工具清单、默认排布与用户排布互相定义对方，所以它们只有 utils 里那一份。
test('节点工具条由注册表驱动，未接线的工具只是不出现', () => {
  const {
    NODE_TOOLBAR_TOOLS,
    NODE_TOOLBAR_DEFAULT_PINNED,
    nodeToolbarScope,
    nodeToolbarToolIds,
    nodeToolbarOverflowIds,
    defaultCanvasToolbarCustomization,
    normalizeCanvasToolbarCustomization,
  } = toolbarContract;

  assert.equal(nodeToolbarScope('imageGeneration'), 'image');
  assert.equal(nodeToolbarScope('videoGeneration'), 'video');
  assert.equal(nodeToolbarScope('textGeneration'), null);
  for (const scope of ['image', 'video']) {
    // 默认钉住的每一项都必须是真实登记过的工具，否则用户看到一个空位。
    for (const id of NODE_TOOLBAR_DEFAULT_PINNED[scope]) {
      assert.ok(nodeToolbarToolIds(scope).includes(id), `${scope} 默认钉住了未登记的工具 ${id}`);
    }
    assert.deepEqual(
      nodeToolbarOverflowIds(scope, NODE_TOOLBAR_DEFAULT_PINNED[scope]),
      nodeToolbarToolIds(scope).filter((id) => !NODE_TOOLBAR_DEFAULT_PINNED[scope].includes(id)),
    );
  }

  // 解析不出 wiring 的工具不渲染按钮：default 分支返回 null，而不是一个禁用摆设。
  assert.match(toolbar, /switch \(tool\.id\) \{[\s\S]*?default:\s*\n\s*return null;/);
  assert.match(toolbar, /\.filter\(\(entry\): entry is \{ tool: NodeToolDefinition; resolved: ResolvedTool \} => Boolean\(entry\.resolved\)\)/);
  // 工具清单只在 utils 里存在一次，界面不得再抄一份 id 判断。
  assert.doesNotMatch(toolbar, /case "color-adjust"/);
  // 注册表里的每一项都必须有 wiring，否则弹窗能勾选、工具条永远不出现。
  for (const scope of Object.keys(NODE_TOOLBAR_TOOLS)) {
    for (const tool of NODE_TOOLBAR_TOOLS[scope]) {
      assert.match(toolbar, new RegExp(`case "${tool.id}"`), `${scope}/${tool.id} 在注册表里但没有 round wiring`);
    }
  }
  assert.equal(NODE_TOOLBAR_TOOLS.image.some((tool) => tool.id === 'color-adjust'), false);
});

test('工具栏排布偏好是持久状态，脏值回到默认而不是报错', () => {
  const { defaultCanvasToolbarCustomization, normalizeCanvasToolbarCustomization, CANVAS_TOOLBAR_LAYOUT_VERSION } = toolbarContract;

  const fresh = defaultCanvasToolbarCustomization();
  assert.equal(fresh.layoutVersion, CANVAS_TOOLBAR_LAYOUT_VERSION);
  assert.equal(fresh.showLabels, false);

  // 注册表删掉一个工具后，磁盘上的旧排布只是不再出现，不该连带清空其余项。
  const dirty = normalizeCanvasToolbarCustomization({
    layoutVersion: CANVAS_TOOLBAR_LAYOUT_VERSION,
    showLabels: true,
    pinned: { image: ['crop', 'crop', 'ghost-tool', 'annotate'], video: 'not-an-array' },
  });
  assert.deepEqual(dirty.pinned.image, ['crop', 'annotate']);
  assert.deepEqual(dirty.pinned.video, fresh.pinned.video);
  assert.equal(dirty.showLabels, true);

  // 跨版本没有可以安全搬运的语义，整体回默认。
  const stale = normalizeCanvasToolbarCustomization({ layoutVersion: CANVAS_TOOLBAR_LAYOUT_VERSION + 1, pinned: fresh.pinned });
  assert.deepEqual(stale, fresh);
  assert.deepEqual(normalizeCanvasToolbarCustomization(undefined), fresh);

  // 只有一个落盘通道：加载与保存都过同一个规范化。
  assert.match(settings, /canvasToolbarCustomization: normalizeCanvasToolbarCustomization\(rawStore\.canvasToolbarCustomization\)/);
  assert.match(settings, /settingsStore\.canvasToolbarCustomization = normalizeCanvasToolbarCustomization\(settings\.canvasToolbarCustomization\)/);
});

test('⋮ 溢出菜单承载未钉住的工具与编辑工具栏入口', () => {
  assert.match(toolbar, /nodeToolbarOverflowIds\(scope, pinnedIds\)/);
  assert.match(toolbar, /label: "编辑工具栏"[\s\S]*?setCustomizeOpen\(true\)/);
  assert.match(toolbar, /\{ id: "customize-separator", separator: true \}/);
  assert.match(toolbar, /title="更多工具"[\s\S]*?setOpenMenu\(\(current\) => \(current === "more" \? null : "more"\)\)/);
  assert.match(toolbar, /<ToolbarPortalMenu[\s\S]*?items=\{moreItems\}[\s\S]*?root=\{canvasOverlayRoot\}/);
  // 弹层挂画布浮层根节点并借同一档层级，不逃逸到 document.body。
  assert.match(styles, /\.canvas-node-toolbar-menu \{[\s\S]*?z-index: calc\(var\(--layer-canvas-composer\) \+ 1\)/);
  assert.match(styles, /\.canvas-node-toolbar-menu \{[\s\S]*?box-shadow: var\(--canvas-shadow-menu\)/);
});

test('编辑工具栏弹窗即时落盘并用 dnd-kit 排序', () => {
  assert.match(customizeDialog, /from "@dnd-kit\/sortable"/);
  assert.match(customizeDialog, /from "@dnd-kit\/core"/);
  // 没有 4px 激活距离时一次点击会被当成拖拽，显示/隐藏就点不动了。
  assert.match(customizeDialog, /activationConstraint: \{ distance: 4 \}/);
  assert.match(customizeDialog, /await saveAppSettings\(\{ canvasToolbarCustomization: next \}\)/);
  assert.doesNotMatch(customizeDialog, /useState<CanvasToolbarCustomization>/);
  // 两个作用域各自一份排布，弹窗在同一时刻只编辑当前作用域。
  assert.match(customizeDialog, /nodeToolbarScopes\(\)\.map/);
  assert.match(customizeDialog, /pinned: \{[\s\S]*?\[scope\]: pinnedSet\.has\(toolId\)/);
  assert.match(customizeDialog, /恢复默认/);
  assert.match(customizeDialog, /defaultCanvasToolbarCustomization\(\)\.pinned\[scope\]/);
  // 弹窗是应用级浮层，挂工作台表面而不是画布层叠上下文。
  assert.match(customizeDialog, /useWorkbenchSurfaceRoot\(\)/);
  assert.match(customizeDialog, /className="canvas-toolbar-customize-backdrop"[\s\S]*?surface,/);
  assert.match(styles, /\.canvas-toolbar-customize-backdrop \{[^}]*background: var\(--overlay-dim\)/);
});

test('排布偏好落盘后工具条与弹窗实时跟随，不靠节点重渲染', () => {
  // React Flow 的 NodeWrapper 是 memo 的，工作台级的领域通知传不进节点：
  // 工具条必须自己订阅设置域，否则「编辑工具栏」落盘后背后的按钮一个都不变。
  assert.match(toolbar, /import \{ subscribeDomain \} from "\.\.\/\.\.\/store\/domainReactivity\.ts"/);
  assert.match(toolbar, /useSyncExternalStore\(\s*subscribeDomain,\s*getToolbarCustomization,\s*getToolbarCustomization,?\s*\)/);
  // 快照取排布对象身份而不是全局 revision——画布高频写入不该重渲染每一枚工具条。
  assert.match(toolbar, /function getToolbarCustomization\(\) \{\s*return settingsStore\.canvasToolbarCustomization;/);
  assert.doesNotMatch(toolbar, /useSyncExternalStore\(subscribeDomain, getDomainRevision/);
  // 弹窗只消费工具条订阅到的那一份快照，不维护第二个状态源。
  assert.doesNotMatch(customizeDialog, /settingsStore\.canvasToolbarCustomization/);
  assert.match(customizeDialog, /customization: CanvasToolbarCustomization/);
  assert.match(toolbar, /<CanvasToolbarCustomizeDialog[\s\S]*?customization=\{customization\}/);
});

test('小地图节点可点击定位、保持缩放且地图不被面板裁切', () => {
  assert.match(workflowCanvas, /onNodeClick=\{\(_event, node\) => minimapNodeClick\.current\(node\.id\)\}/);
  assert.match(workflowCanvas, /minimapNodeClick\.current = \(nodeId: string\) => \{\n\s*controller\.selectNodes\(\[nodeId\]\);\n\s*focusCanvasNodes\(\[nodeId\], \{ keepZoom: true \}\);\n\s*\}/);
  // 小地图只认节点对象上的尺寸；外部同步会丢掉 React Flow 的 measured。
  assert.ok((workflowCanvas.match(/\n\s+width: screenWidth,/g) || []).length >= 2, '节点必须把屏幕尺寸同时写进 style 与 width，否则小地图在外部同步后没有可点节点');
  assert.match(workflowCanvas, /const zoom = options\?\.keepZoom\n\s*\?\s*semanticZoomRef\.current\n\s*: Math\.min\(/);
  // 对话与计划的"定位"仍要把节点放大到可读，keepZoom 只属于小地图这一类概览入口。
  assert.match(workflowCanvas, /singleNodeFocus \? 0\.78 : MIN_CANVAS_ZOOM/);
  assert.match(workflowCanvas, /style=\{\{ width: MINIMAP_SIZE\.width, height: MINIMAP_SIZE\.height \}\}/);
  assert.match(styles, /\.react-flow__minimap\.canvas-minimap \{[^}]*border: 0;/);
  assert.doesNotMatch(styles, /\.react-flow__minimap\.canvas-minimap \{[^}]*\n\s*(width|height):/);
  assert.match(styles, /\.react-flow__minimap\.canvas-minimap \.react-flow__minimap-node \{[^}]*cursor: pointer/);
  assert.match(styles, /\.react-flow__minimap\.canvas-minimap \.react-flow__minimap-node:hover \{[^}]*fill: color-mix\(in srgb, var\(--text\) 55%, transparent\)/);
  assert.match(styles, /\.react-flow__minimap\.canvas-minimap \.react-flow__minimap-node\.selected \{[^}]*fill: color-mix\(in srgb, var\(--brand-accent\) 78%, transparent\)/);
  assert.doesNotMatch(styles, /react-flow__minimap[^}]*#[0-9a-f]{3,6}/i);
  // 旧版自绘小地图留下的第二套盒子会重新裁掉 svg，尺寸只能由 MiniMap 的 style 决定。
  assert.doesNotMatch(
    readSource('../renderer/styles/workbench.css'),
    /\.canvas-minimap|\.minimap-viewport|\.minimap-dot/,
  );
});
