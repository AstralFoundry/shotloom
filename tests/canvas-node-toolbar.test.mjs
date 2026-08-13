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
  assert.match(canvas, /<NodeToolbar[\s\S]*?isVisible=\{selected\}[\s\S]*?offset=\{30\}[\s\S]*?>[\s\S]*?加入对话[\s\S]*?<\/NodeToolbar>/);
  assert.match(canvas, /mentionInCopilot\(item\.id\)/);
  assert.match(styles, /\.canvas-node-selection-toolbar \{[\s\S]*?z-index: 110/);
  for (const source of [generation, basicNodes, board, director]) {
    assert.doesNotMatch(source, /className="node-mention-btn/);
  }
});

test('媒体节点工具栏提供真实入库与音频分离', () => {
  assert.match(canvas, /canExtractAudio[\s\S]*?actions\.extractAudio\(item\.id\)[\s\S]*?音频分离/);
  assert.match(canvas, /canSaveToAssets[\s\S]*?actions\.saveToAssets\(item\.id\)[\s\S]*?存为资产/);
  assert.match(adapter, /async saveToAssets\(id\)[\s\S]*?promoteMaterialToLocalLibrary/);
  assert.match(adapter, /async extractAudio\(id\)[\s\S]*?extractAudioToProject[\s\S]*?addNode\("audioGeneration"\)/);
  assert.match(api, /extractAudioToProject:[\s\S]*?file:extract-audio/);
  assert.match(rust, /pub fn file_extract_audio[\s\S]*?source_has_audio[\s\S]*?"-map", "0:a:0"[\s\S]*?"-c:a", "aac"/);
});
