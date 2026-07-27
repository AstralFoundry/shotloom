import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const canvas = readFileSync(new URL('../renderer/src/app/canvas/WorkflowCanvas.tsx', import.meta.url), 'utf8');
const node = readFileSync(new URL('../renderer/src/app/canvas/GenerationNode.tsx', import.meta.url), 'utf8');
const task = readFileSync(new URL('../renderer/src/store/taskStore.js', import.meta.url), 'utf8');
const project = readFileSync(new URL('../renderer/src/store/projectStore.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../renderer/src/services/tauriApi.js', import.meta.url), 'utf8');
const previewQueue = readFileSync(new URL('../renderer/src/app/canvas/previewLoadQueue.ts', import.meta.url), 'utf8');
const director = readFileSync(new URL('../renderer/src/app/canvas/ThreeDDirectorNode.tsx', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('../renderer/src/app/adapters/canvasAdapter.ts', import.meta.url), 'utf8');
test('React Flow 保持节点挂载并在拖动结束后合并持久化', () => {
  assert.doesNotMatch(canvas, /onlyRenderVisibleElements/); assert.match(canvas, /draggingIds\.current/);
  assert.match(canvas, /controller\.moveNodes\(moved, \{ recordHistory \}\)/);
  assert.match(canvas, /autoPanOnNodeDrag=\{false\}/);
});
test('大型画布始终使用完整节点，媒体预览在空闲时限流加载', () => {
  assert.doesNotMatch(canvas, /lodMode|data\.lod|canvas-lod-node/);
  assert.match(node, /schedulePreviewLoad/);
  assert.match(previewQueue, /MAX_CONCURRENT_PREVIEWS = 2/);
  assert.match(previewQueue, /requestIdleCallback/);
  assert.match(project, /const project = persisted \? store\.project : projectPersistenceSnapshot\(\)/);
});
test('节点与连线使用线性索引和稳定集合', () => {
  assert.match(canvas, /new Map\(current\.map/); assert.match(canvas, /const ids = useMemo\(\(\) => new Set/);
  assert.match(canvas, /edges\.filter\(\(edge\) => ids\.has\(edge\.source\)/);
});
test('画布坐标和 100% 视图保持清晰', () => {
  assert.match(canvas, /Math\.round\(Number\(node\.x\)/); assert.match(canvas, /Math\.abs\(next\.zoom - 1\) < \.015 \? 1/);
});
test('画布右键菜单把屏幕坐标换算为画布局部坐标并限制在视口内', () => {
  assert.match(canvas, /getBoundingClientRect\(\)/);
  assert.match(canvas, /clientX - bounds\.left/);
  assert.match(canvas, /clientY - bounds\.top/);
  assert.match(canvas, /bounds\.width - CANVAS_MENU_WIDTH/);
  assert.match(canvas, /bounds\.height - CANVAS_MENU_HEIGHT/);
});
test('连线使用 Loose 模式、点击连接和恒定屏幕吸附范围', () => {
  assert.match(canvas, /connectOnClick/); assert.match(canvas, /ConnectionMode\.Loose/); assert.match(canvas, /connectionRadius=\{64\}/);
});
test('连线按节点相对位置选择最近端口且不会折返回头', () => {
  assert.match(canvas, /const targetIsRight = targetCenter >= sourceCenter/);
  assert.match(canvas, /sourceHandle: targetIsRight \? "source-right" : "source-left"/);
  assert.match(canvas, /targetHandle: targetIsRight \? "target-left" : "target-right"/);
  assert.match(node, /id="source-left"/);
  assert.match(node, /id="target-right"/);
});
test('3D 导演台随节点比例铺满，画布删除键删除当前节点选择', () => {
  assert.match(director, /height: workspace\.clientHeight \/ scale/);
  assert.match(director, /width: previewLayout\.width/);
  assert.match(director, /height: previewLayout\.height/);
  assert.match(canvas, /tabIndex=\{0\}/);
  assert.match(canvas, /event\.currentTarget\.focus\(\{ preventScroll: true \}\)/);
  assert.match(canvas, /event\.key === "Backspace" \|\| event\.key === "Delete"[\s\S]*?event\.preventDefault\(\);[\s\S]*?controller\.deleteSelection\(\)/);
  assert.match(adapter, /selectNodes\(ids\) \{\s*store\.selectedEdgeId = null/);
  assert.match(adapter, /select\(id\) \{\s*store\.selectedEdgeId = null/);
});
test('并发任务轮询只在状态变化时触发合并持久化', () => {
  const update = task.match(/function applyRemoteTaskUpdate\(node, task, remote\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(update, /const changed =/); assert.match(update, /touchProject\(\{ sessionDelay: 500, coalesceSession: true \}\)/);
  assert.match(project, /if \(sessionPersistTimer && coalesce\) return/);
});
test('图片节点读取缓存缩略图且整个节点可选择', () => {
  assert.match(node, /readImagePreview\(path, 960\)/); assert.match(api, /activeImagePreviewReads < 4/);
  assert.match(node, /className="work-node-wrapper"[\s\S]*?actions\.select\(node\.id\)/);
});
