import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const canvas = readFileSync(new URL('../renderer/src/app/canvas/WorkflowCanvas.tsx', import.meta.url), 'utf8');
const generation = readFileSync(new URL('../renderer/src/app/canvas/GenerationNode.tsx', import.meta.url), 'utf8');
const basicNodes = readFileSync(new URL('../renderer/src/app/canvas/CanvasNodes.tsx', import.meta.url), 'utf8');
const board = readFileSync(new URL('../renderer/src/app/canvas/BoardNode.tsx', import.meta.url), 'utf8');
const director = readFileSync(new URL('../renderer/src/app/canvas/ThreeDDirectorNode.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../renderer/styles/react-migration.css', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('../renderer/src/app/adapters/canvasAdapter.ts', import.meta.url), 'utf8');
const api = readFileSync(new URL('../renderer/src/services/tauriApi.js', import.meta.url), 'utf8');
const rust = readFileSync(new URL('../src-tauri/src/commands/file.rs', import.meta.url), 'utf8');

test('加入对话只在节点选中工具栏中显示', () => {
  assert.match(canvas, /<NodeToolbar[\s\S]*?canvas-node-selection-toolbar--hidden[\s\S]*?isVisible=\{selected\}[\s\S]*?offset=\{useSubtleUploadToolbar \? 18 : 30\}[\s\S]*?>[\s\S]*?加入对话[\s\S]*?<\/NodeToolbar>/);
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
  assert.match(adapter, /async extractAudio\(id\)[\s\S]*?extractAudioToProject[\s\S]*?addNode\("audioGeneration"\)/);
  assert.match(api, /extractAudioToProject:[\s\S]*?file:extract-audio/);
  assert.match(rust, /pub fn file_extract_audio[\s\S]*?source_has_audio[\s\S]*?"-map", "0:a:0"[\s\S]*?"-c:a", "aac"/);
});

test('空媒体节点从顶部工具栏上传且节点内部只保留占位图标', () => {
  assert.match(canvas, /const canUpload = Boolean\(uploadLabel && !hasMediaContent\)/);
  assert.match(canvas, /useSubtleUploadToolbar[\s\S]*?canvas-node-selection-toolbar--subtle[\s\S]*?offset=\{useSubtleUploadToolbar \? 18 : 30\}/);
  assert.match(canvas, /\{canUpload && \([\s\S]*?title=\{`上传\$\{uploadLabel\}`\}[\s\S]*?actions\.upload\(item\.id\)/);
  assert.doesNotMatch(generation, /className="work-empty-upload/);
  assert.doesNotMatch(generation, /上传\{metaLabel\.replace/);
  assert.match(styles, /\.work-preview \.work-empty-type-icon \{[\s\S]*?width:\s*34px;[\s\S]*?height:\s*34px/);
  assert.match(styles, /\.canvas-node-selection-toolbar--subtle \{[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none/);
  assert.match(styles, /\.canvas-node-selection-toolbar--subtle button \{[\s\S]*?height:\s*26px;[\s\S]*?font-size:\s*11px/);
});
