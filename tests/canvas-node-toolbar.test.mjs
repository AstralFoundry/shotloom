import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const canvas = readFileSync(new URL('../renderer/src/app/canvas/WorkflowCanvas.tsx', import.meta.url), 'utf8');
const cropDialog = readFileSync(new URL('../renderer/src/app/components/ImageCropDialog.tsx', import.meta.url), 'utf8');
const generation = readFileSync(new URL('../renderer/src/app/canvas/GenerationNode.tsx', import.meta.url), 'utf8');
const basicNodes = readFileSync(new URL('../renderer/src/app/canvas/CanvasNodes.tsx', import.meta.url), 'utf8');
const board = readFileSync(new URL('../renderer/src/app/canvas/BoardNode.tsx', import.meta.url), 'utf8');
const director = readFileSync(new URL('../renderer/src/app/canvas/ThreeDDirectorNode.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../renderer/styles/react-migration.css', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('../renderer/src/app/adapters/canvasAdapter.ts', import.meta.url), 'utf8');
const api = readFileSync(new URL('../renderer/src/services/tauriApi.js', import.meta.url), 'utf8');
const rust = readFileSync(new URL('../src-tauri/src/commands/file.rs', import.meta.url), 'utf8');
const nodeChrome = await import('../renderer/src/utils/canvasNodeChrome.mjs');

test('加入对话只在节点选中工具栏中显示', () => {
  assert.match(canvas, /<NodeToolbar[\s\S]*?canvas-node-selection-toolbar--hidden[\s\S]*?isVisible=\{selected\}[\s\S]*?offset=\{toolbarOffset\}[\s\S]*?>[\s\S]*?加入对话[\s\S]*?<\/NodeToolbar>/);
  assert.match(canvas, /mentionInCopilot\(item\.id\)/);
  assert.match(styles, /\.canvas-node-selection-toolbar \{[\s\S]*?z-index: 110/);
  for (const source of [generation, basicNodes, board, director]) {
    assert.doesNotMatch(source, /className="node-mention-btn/);
  }
});

test('文本节点工具栏提供复制、加入对话与完整文本编辑', () => {
  assert.match(canvas, /isTextNode = item\.type === "textGeneration"/);
  assert.match(canvas, /canvas-node-toolbar-label">文本节点/);
  assert.match(canvas, /title="复制全文"[\s\S]*?navigator\.clipboard\.writeText\(textContent\)/);
  assert.match(canvas, /title="打开完整文本"[\s\S]*?openTextDetail\(\)/);
  assert.match(canvas, /openMediaViewer\(\{[\s\S]*?kind: "text"[\s\S]*?actions\.update\(item\.id/);
  assert.doesNotMatch(canvas, /item\.textContent \|\| item\.prompt/);
});

test('媒体节点工具栏提供真实入库与音频分离', () => {
  assert.match(canvas, /canExtractAudio[\s\S]*?actions\.extractAudio\(item\.id\)[\s\S]*?音频分离/);
  assert.match(canvas, /desktopApi\.file\.hasAudio\(localMediaPath\)[\s\S]*?"present"\s*:\s*"absent"/);
  assert.match(canvas, /disabled=\{!canExtractAudio \|\| audioSplitRunning\}[\s\S]*?"拆分中…"[\s\S]*?"无音轨"/);
  assert.match(canvas, /canSaveToAssets[\s\S]*?存为资产[\s\S]*?assetScopeMenuOpen/);
  assert.match(canvas, /assetCategories\.map[\s\S]*?setAssetCategory\(category\.id\)/);
  assert.match(canvas, /createPortal\([\s\S]*?canvas-node-asset-scope-menu--portal[\s\S]*?canvasOverlayRoot/);
  assert.match(canvas, /assetPlacementRevision = useStore[\s\S]*?positionAbsolute[\s\S]*?state\.transform/);
  assert.match(canvas, /actions\.saveToAssets\(item\.id, "project", assetCategory\)[\s\S]*?<strong>存到项目<\/strong>/);
  assert.match(canvas, /actions\.saveToAssets\(item\.id, "global", assetCategory\)[\s\S]*?<strong>存到全局<\/strong>/);
  assert.match(adapter, /async saveToAssets\(id, scope, category\)[\s\S]*?scope === "project"[\s\S]*?addMaterialToAssetLibrary[\s\S]*?promoteMaterialToLocalLibrary/);
  assert.match(adapter, /assetDetails = \{[\s\S]*?category,[\s\S]*?promoteMaterialToLocalLibrary/);
  assert.match(styles, /\.canvas-node-asset-scope-menu \{[\s\S]*?width:\s*220px/);
  assert.match(styles, /\.canvas-node-asset-scope-menu--portal \{[\s\S]*?z-index:\s*121/);
  assert.match(styles, /\.react-workflow-canvas \{[\s\S]*?isolation:\s*isolate/);
  assert.match(adapter, /async extractAudio\(id\)[\s\S]*?separateAudioToProject[\s\S]*?addNode\("videoGeneration"\)[\s\S]*?addNode\("audioGeneration"\)/);
  assert.match(adapter, /sourceDimensions = canvasNodeDimensions\(source\)[\s\S]*?silentVideo\.y \+ canvasNodeDimensions\(silentVideo\)\.height \+ 48/);
  assert.match(adapter, /addCanvasEdge\(store\.project, source\.id, silentVideo\.id[\s\S]*?addCanvasEdge\(store\.project, source\.id, audio\.id/);
  assert.match(api, /separateAudioToProject:[\s\S]*?file:separate-audio/);
  assert.match(api, /hasAudio:[\s\S]*?file:has-audio/);
  assert.match(rust, /pub async fn file_has_audio[\s\S]*?spawn_blocking[\s\S]*?fn probe_audio[\s\S]*?source_has_audio/);
  assert.match(rust, /pub async fn file_separate_audio[\s\S]*?spawn_blocking/);
  assert.match(rust, /fn separate_audio[\s\S]*?source_has_audio[\s\S]*?"-map", "0:a:0"[\s\S]*?"-c:a", "aac"[\s\S]*?"-map", "0:v:0"[\s\S]*?"-an"[\s\S]*?"copy"/);
});

test('本地图片节点提供原图裁剪并创建保留来源连线的新节点', () => {
  assert.match(canvas, /isLocalImage[^]*?title="裁剪图片"[^]*?setCropOpen\(true\)/);
  assert.match(canvas, /createPortal\([^]*?<ImageCropDialog[^]*?actions\.cropImage\(item\.id, rect\)[^]*?document\.body/);
  assert.match(cropDialog, /readImagePreview\(source, 2048\)/);
  assert.match(cropDialog, /cropRatios[\s\S]*?"1:1"[\s\S]*?"16:9"[\s\S]*?"9:16"/);
  assert.match(adapter, /async cropImage\(id, crop\)[\s\S]*?cropImageToProject[\s\S]*?addNode\("imageGeneration"\)/);
  assert.match(adapter, /addCanvasEdge\(store\.project, source\.id, output\.id[\s\S]*?derivation: "image-crop"/);
  assert.match(api, /case 'file:crop-image':[\s\S]*?file_crop_image/);
  assert.match(api, /cropImageToProject:[\s\S]*?file:crop-image/);
  assert.match(rust, /pub async fn file_crop_image[\s\S]*?spawn_blocking/);
  assert.match(rust, /fn crop_image[\s\S]*?apply_orientation[\s\S]*?crop_imm[\s\S]*?ImageFormat::Png/);
  assert.match(styles, /\.image-crop-backdrop \{[\s\S]*?z-index:\s*240/);
});

test('空媒体节点从顶部工具栏上传且节点内部只保留占位图标', () => {
  assert.match(canvas, /const canUpload = Boolean\(uploadLabel && !hasMediaContent\)/);
  assert.match(canvas, /toolbarOffset = canvasNodeToolbarOffset\(semanticZoom, useSubtleUploadToolbar\)/);
  assert.match(canvas, /useSubtleUploadToolbar[\s\S]*?canvas-node-selection-toolbar--subtle[\s\S]*?offset=\{toolbarOffset\}/);
  assert.match(canvas, /\{canUpload && \([\s\S]*?title=\{`上传\$\{uploadLabel\}`\}[\s\S]*?actions\.upload\(item\.id\)/);
  assert.doesNotMatch(generation, /className="work-empty-upload/);
  assert.doesNotMatch(generation, /上传\{metaLabel\.replace/);
  assert.match(styles, /\.work-preview \.work-empty-type-icon \{[\s\S]*?width:\s*34px;[\s\S]*?height:\s*34px/);
  assert.match(styles, /\.canvas-node-selection-toolbar--subtle \{[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none/);
  assert.match(styles, /\.canvas-node-selection-toolbar--subtle button \{[\s\S]*?height:\s*26px;[\s\S]*?font-size:\s*11px/);
});

test('节点顶部工具栏保持屏幕字号并随名称高度避让', () => {
  assert.equal(nodeChrome.canvasNodeToolbarOffset(0.55, true), 18);
  assert.equal(nodeChrome.canvasNodeToolbarOffset(1, true), 26);
  assert.equal(nodeChrome.canvasNodeToolbarOffset(1.8, true), 42);
  assert.equal(nodeChrome.canvasNodeToolbarOffset(0.55, false), 30);
  assert.equal(nodeChrome.canvasNodeToolbarOffset(1, false), 30);
  assert.equal(nodeChrome.canvasNodeToolbarOffset(1.8, false), 46);
  assert.match(canvas, /top: -CANVAS_NODE_LABEL_HEIGHT \* semanticZoom/);
  assert.match(canvas, /height: CANVAS_NODE_LABEL_HEIGHT \* semanticZoom/);
  assert.match(styles, /\.canvas-node-selection-toolbar--subtle button \{[^}]*font-size:\s*11px/);
  assert.doesNotMatch(styles, /canvas-node-selection-toolbar[^}]*transform:\s*scale/);
});
