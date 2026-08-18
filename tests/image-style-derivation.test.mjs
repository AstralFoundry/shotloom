import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adapterSource = readFileSync(
  new URL('../renderer/src/app/adapters/canvasAdapter.ts', import.meta.url),
  'utf8',
);
const serviceSource = readFileSync(
  new URL('../renderer/src/services/coloredPencilNodeService.ts', import.meta.url),
  'utf8',
);

test('本地彩铅处理创建完整的普通图片节点并接入原工作流', () => {
  assert.match(serviceSource, /type: 'imageGeneration'/);
  assert.match(serviceSource, /prompt: sourceNode\.prompt \|\| ''/);
  assert.match(serviceSource, /model: sourceNode\.model \|\| ''/);
  assert.match(serviceSource, /config: \{ \.\.\.\(sourceNode\.config \|\| \{\}\) \}/);
  assert.match(serviceSource, /project\.nodes\.push\(derived\)/);
  assert.match(serviceSource, /addCanvasEdge\(project, sourceNode\.id, derived\.id/);
  assert.match(serviceSource, /edge\.data\?\.skipTaskInput !== true/);
  assert.match(serviceSource, /rewireColoredPencilDownstreamEdges\(/);
  assert.match(serviceSource, /edge\.source = derivedNodeId/);
  assert.doesNotMatch(serviceSource, /styleDerivation:/);
  assert.match(adapterSource, /setSelectedNodeIds\(\[result\.node\.id\]\)/);
});

test('彩铅输出归属新图片节点并立即成为其选中输出', () => {
  assert.match(serviceSource, /desktopApi\.file\.applyColoredPencil/);
  assert.match(serviceSource, /semanticOutputFileName\(derived\.title, 'png'\)/);
  assert.match(serviceSource, /name: file\.name \|\| preferredName/);
  assert.match(serviceSource, /nodeId: derived\.id/);
  assert.match(serviceSource, /project\.materials\.unshift\(material\)/);
  assert.match(serviceSource, /derived\.selectedOutputNodeId = `material:/);
  assert.match(serviceSource, /derived\.status = 'completed'/);
  assert.match(serviceSource, /scope: 'full-image'/);
  assert.doesNotMatch(serviceSource, /runNode/);
});

test('手动彩铅按钮复用统一的图片节点派生服务', () => {
  assert.match(adapterSource, /import \{ createColoredPencilImageNode \}/);
  assert.match(adapterSource, /createColoredPencilImageNode\(store\.project, node\)/);
  assert.match(adapterSource, /showSuccessToast\(`创建成功：\$\{result\.node\.title/);
  assert.doesNotMatch(adapterSource, /desktopApi\.file\.applyColoredPencil/);
});
