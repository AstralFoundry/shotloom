import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const canvas = readFileSync(
  new URL('../renderer/src/app/canvas/WorkflowCanvas.tsx', import.meta.url),
  'utf8',
);
const node = readFileSync(
  new URL('../renderer/src/app/canvas/GenerationNode.tsx', import.meta.url),
  'utf8',
);
const task = readFileSync(new URL('../renderer/src/store/taskStore.js', import.meta.url), 'utf8');
const project = readFileSync(
  new URL('../renderer/src/store/projectStore.js', import.meta.url),
  'utf8',
);
const api = readFileSync(new URL('../renderer/src/services/tauriApi.js', import.meta.url), 'utf8');
const previewQueue = readFileSync(
  new URL('../renderer/src/app/canvas/previewLoadQueue.ts', import.meta.url),
  'utf8',
);
const mediaCacheHook = readFileSync(
  new URL('../renderer/src/app/canvas/useMediaPreviewCache.ts', import.meta.url),
  'utf8',
);
const mediaCache = readFileSync(
  new URL('../renderer/src/services/mediaPreviewCache.ts', import.meta.url),
  'utf8',
);
const director = readFileSync(
  new URL('../renderer/src/app/canvas/ThreeDDirectorNode.tsx', import.meta.url),
  'utf8',
);
const directorStyles = readFileSync(
  new URL('../renderer/src/app/canvas/ThreeDDirectorNode.css', import.meta.url),
  'utf8',
);
const directorApp = readFileSync(
  new URL('../renderer/src/vendor/storyai-3d-director-desk/src/App.tsx', import.meta.url),
  'utf8',
);
const directorBridge = readFileSync(
  new URL(
    '../renderer/src/vendor/storyai-3d-director-desk/src/editor/io/hostBridge.ts',
    import.meta.url,
  ),
  'utf8',
);
const directorCanvas = readFileSync(
  new URL(
    '../renderer/src/vendor/storyai-3d-director-desk/src/editor/canvas/DirectorCanvas.tsx',
    import.meta.url,
  ),
  'utf8',
);
const directorScene = readFileSync(
  new URL(
    '../renderer/src/vendor/storyai-3d-director-desk/src/editor/canvas/SceneRoot.tsx',
    import.meta.url,
  ),
  'utf8',
);
const directorStore = readFileSync(
  new URL(
    '../renderer/src/vendor/storyai-3d-director-desk/src/editor/store/directorStore.ts',
    import.meta.url,
  ),
  'utf8',
);
const workbench = readFileSync(
  new URL('../renderer/src/app/ReactWorkbench.tsx', import.meta.url),
  'utf8',
);
const creationView = readFileSync(
  new URL('../renderer/src/app/views/CreationView.tsx', import.meta.url),
  'utf8',
);
const shell = readFileSync(new URL('../renderer/src/app/AppShell.tsx', import.meta.url), 'utf8');
const adapter = readFileSync(
  new URL('../renderer/src/app/adapters/canvasAdapter.ts', import.meta.url),
  'utf8',
);
const canvasHistory = readFileSync(
  new URL('../renderer/src/store/canvasHistoryStore.js', import.meta.url),
  'utf8',
);
const copilotAdapter = readFileSync(
  new URL('../renderer/src/app/adapters/copilotAdapter.ts', import.meta.url),
  'utf8',
);
const copilotPanel = readFileSync(
  new URL('../renderer/src/app/copilot/CopilotPanel.tsx', import.meta.url),
  'utf8',
);
const migrationStyles = readFileSync(
  new URL('../renderer/styles/react-migration.css', import.meta.url),
  'utf8',
);
test('React Flow 只渲染可见节点并在拖动结束后合并持久化', () => {
  assert.match(
    canvas,
    /onlyRenderVisibleElements=\{renderedNodes\.length > NODE_VIRTUALIZATION_THRESHOLD\}/,
  );
  assert.match(canvas, /draggingIds\.current/);
  assert.match(canvas, /change\.dragging === false[\s\S]*?controller\.moveNodes\(moved\)/);
  assert.doesNotMatch(canvas, /controller\.moveNodes\(moved, \{ recordHistory \}\)/);
  assert.match(canvas, /autoPanOnNodeDrag=\{false\}/);
  assert.doesNotMatch(canvas, /onMove=\{\(_event, next\) => setLiveViewport\(next\)\}/);
  assert.doesNotMatch(canvas, /useInternalNode/);
  assert.match(canvas, /selected && resizable && \([\s\S]*?<NodeResizer/);
  assert.match(canvas, /onResizeStart=\{\(\) => setResizing\(true\)\}/);
  assert.match(canvas, /function CanvasGrid\(\)/);
  assert.match(canvas, /requestAnimationFrame\(paint\)/);
  assert.match(canvas, /onMoveStart=\{onMoveStart\}/);
  assert.match(canvas, /data-viewport-layer=/);
  assert.match(canvas, /MEDIA_NODE_TYPES\.has\(node\.type\) \? "canvas-media-node"/);
  assert.match(
    migrationStyles,
    /viewport-moving\[data-viewport-layer="standard"\][\s\S]*?canvas-media-node/,
  );
  assert.match(canvas, /pendingNodeChanges\.current\.push/);
  assert.match(canvas, /requestAnimationFrame\(\(\) => \{[\s\S]*?applyNodeChanges\(pending/);
  assert.match(adapter, /saveViewport\(viewport\) \{\s*persistCanvasViewport\(viewport\)/);
  assert.match(project, /persistCanvasViewport[\s\S]*?toRaw\(store\.project\)/);
  assert.match(adapter, /recordCanvasPositionHistory\(positions\.map/);
  assert.match(canvasHistory, /kind: 'node-positions'/);
  assert.match(canvasHistory, /previous\.kind === 'node-positions'[\s\S]*?nodePositionSnapshot/);
});
test('大型画布保留完整数据并对可见媒体预览限流加载', () => {
  assert.doesNotMatch(canvas, /lodMode|data\.lod|canvas-lod-node/);
  assert.match(node, /useMediaPreviewCache/);
  assert.match(mediaCacheHook, /schedulePreviewLoad/);
  assert.match(previewQueue, /MAX_CONCURRENT_PREVIEWS = 2/);
  assert.match(previewQueue, /requestIdleCallback/);
  assert.match(
    project,
    /const project = persisted \? store\.project : projectPersistenceSnapshot\(\)/,
  );
  assert.match(mediaCacheHook, /convertFileSrc\(path\)/);
  assert.match(mediaCache, /kindBudgets: \{ image: 128 \* MIB, video: 192 \* MIB, audio: 64 \* MIB \}/);
  assert.match(mediaCache, /installMediaPreviewCacheMemoryPressureListener/);
});
test('节点内媒体控件不会被画布拖拽和缩放手势接管', () => {
  assert.match(node, /<video[\s\S]*?className="nodrag nopan nowheel"[\s\S]*?playsInline/);
  assert.match(node, /<audio[\s\S]*?className="nodrag nopan nowheel"/);
  assert.equal(node.match(/onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/g)?.length, 2);
});
test('本地媒体流地址加载失败时回退到带正确 MIME 的缓冲地址', () => {
  assert.match(mediaCacheHook, /bufferedPath === path/);
  assert.match(mediaCacheHook, /!buffered[\s\S]*?convertFileSrc\(path\)/);
  assert.match(mediaCache, /mp4: "video\/mp4"[\s\S]*?mov: "video\/quicktime"/);
  assert.equal(node.match(/if \(!bufferedPreview\) retryBufferedPreview\(\)/g)?.length, 2);
});
test('视频节点加载后主动解码首帧作为默认封面', () => {
  assert.match(node, /<video[\s\S]*?preload="auto"/);
  assert.match(
    node,
    /onLoadedData=\{\(event\) => \{[\s\S]*?video\.currentTime = Math\.min\([\s\S]*?1 \/ 30/,
  );
});
test('工作台只计算当前路由数据且素材选择器按需加载', () => {
  assert.match(workbench, /appRoute === "creation" \? canvasViewData\(\) : null/);
  assert.match(workbench, /\["assets", "materials"\]\.includes\(appRoute\)/);
  assert.match(workbench, /loadMaterials: resourceLibraryData/);
  assert.match(creationView, /controller\.loadMaterials\(\)/);
  assert.match(shell, /<section className="content">\{view\}<\/section>/);
  assert.doesNotMatch(workbench, /subscribeCopilot\(refresh\)/);
  assert.match(
    creationView,
    /function LiveCopilotPanel[\s\S]*?useSyncExternalStore\([\s\S]*?controller\.subscribe/,
  );
  assert.match(copilotAdapter, /toRaw\(active\(\)\)[\s\S]*?conversation\.messages/);
  assert.match(copilotAdapter, /source === textModelConfigSource/);
  assert.doesNotMatch(migrationStyles, /copilot-busy-shimmer/);
  assert.match(migrationStyles, /copilot-busy-pulse/);
  assert.doesNotMatch(copilotPanel, /}, 80\);/);
  assert.match(copilotPanel, /markdownByMessage = new WeakMap/);
  assert.match(copilotPanel, /__html: messageMarkdown\(item\)/);
  assert.match(migrationStyles, /\.forge-copilot \.copilot-message \{ content-visibility: auto/);
});
test('画布视图用索引关联素材且每个节点只保留两个 Loose 端口', () => {
  assert.match(adapter, /const materialsByNode = new Map/);
  assert.match(adapter, /const legacyBySource = new Map/);
  assert.match(adapter, /materialsByNode\.get\(node\.id\)/);
  assert.equal(node.match(/<Handle/g)?.length, 2);
});
test('节点与连线使用线性索引和稳定集合', () => {
  assert.match(canvas, /new Map\(current\.map/);
  assert.match(canvas, /const ids = useMemo\(\(\) => new Set/);
  assert.match(canvas, /\.filter\(\(edge\) => ids\.has\(edge\.source\)/);
});
test('画布坐标和 100% 视图保持清晰', () => {
  assert.match(canvas, /Math\.round\(Number\(node\.x\)/);
  assert.match(canvas, /Math\.abs\(next\.zoom - 1\) < 0\.015 \? 1/);
});
test('画布右键菜单把屏幕坐标换算为画布局部坐标并限制在视口内', () => {
  assert.match(canvas, /getBoundingClientRect\(\)/);
  assert.match(canvas, /clientX - bounds\.left/);
  assert.match(canvas, /clientY - bounds\.top/);
  assert.match(canvas, /bounds\.width - CANVAS_MENU_WIDTH/);
  assert.match(canvas, /bounds\.height - CANVAS_MENU_HEIGHT/);
});
test('连线使用 Loose 模式、点击连接和恒定屏幕吸附范围', () => {
  assert.match(canvas, /connectOnClick/);
  assert.match(canvas, /ConnectionMode\.Loose/);
  assert.match(canvas, /connectionRadius=\{64\}/);
});
test('连线按节点相对位置选择最近端口且不会折返回头', () => {
  assert.match(canvas, /const targetIsRight = targetCenter >= sourceCenter/);
  assert.match(canvas, /sourceHandle: targetIsRight \? "port-right" : "port-left"/);
  assert.match(canvas, /targetHandle: targetIsRight \? "port-left" : "port-right"/);
  assert.equal(node.match(/<Handle/g)?.length, 2);
});
test('3D 导演台随节点比例铺满，画布删除键删除当前节点选择', () => {
  assert.match(director, /const PREVIEW_WIDTH = 1440/);
  assert.match(director, /const PREVIEW_HEIGHT = 880/);
  assert.match(director, /workspace\.clientWidth \/ PREVIEW_WIDTH/);
  assert.match(director, /workspace\.clientHeight \/ PREVIEW_HEIGHT/);
  assert.match(director, /iframe\.style\.transform = `scale\(\$\{scale\}\)`/);
  assert.match(director, /width: PREVIEW_WIDTH/);
  assert.match(director, /height: PREVIEW_HEIGHT/);
  assert.match(director, /requestAnimationFrame/);
  assert.match(canvas, /keepAspectRatio=\{item\.type === "threeDDirector"\}/);
  assert.match(canvas, /resizing=\{resizing\}/);
  assert.doesNotMatch(director, /if \(resizing\) return/);
  assert.match(director, /resizing \? " resizing"/);
  assert.match(directorStyles, /\.director-node\.resizing[\s\S]*?pointer-events: none/);
  assert.match(canvas, /tabIndex=\{0\}/);
  assert.match(canvas, /event\.currentTarget\.focus\(\{ preventScroll: true \}\)/);
  assert.match(
    canvas,
    /event\.key === "Backspace" \|\| event\.key === "Delete"[\s\S]*?event\.preventDefault\(\);[\s\S]*?controller\.deleteSelection\(\)/,
  );
  assert.match(adapter, /selectNodes\(ids\) \{\s*store\.selectedEdgeId = null/);
  assert.match(adapter, /select\(id\) \{\s*store\.selectedEdgeId = null/);
});
test('3D 导演台的删除键优先删除内部对象，否则交给画布删除节点', () => {
  assert.match(directorApp, /event\.key === "Delete" \|\| event\.key === "Backspace"/);
  assert.match(directorApp, /hasObjectSelection[\s\S]*?state\.deleteSelectedObject\(\)/);
  assert.match(directorApp, /storyai:director-desk-delete-node/);
  assert.match(director, /storyai:director-desk-delete-node[\s\S]*?actions\.delete\(node\.id\)/);
});
test('3D 导演台默认整块可移动，双击后进入场景交互', () => {
  assert.doesNotMatch(canvas, /dragHandle: node\.type === "threeDDirector"/);
  assert.match(director, /className="director-node-drag-handle"/);
  assert.match(director, /interacting \? " nodrag" : ""/);
  assert.match(director, /onDoubleClick=[\s\S]*?setInteracting\(true\)/);
  assert.match(director, /event\.key === "Escape"[\s\S]*?setInteracting\(false\)/);
  assert.match(
    directorApp,
    /event\.key === "Escape"[\s\S]*?storyai:director-desk-exit-interaction/,
  );
  assert.match(director, /storyai:director-desk-exit-interaction[\s\S]*?setInteracting\(false\)/);
  assert.match(directorStyles, /\.director-node:not\(\.interacting\)[\s\S]*?pointer-events: none/);
  assert.match(directorStyles, /\.director-node-drag-handle[\s\S]*?cursor: grab/);
});
test('3D 导演台从真实上游连线同步当前图片输出', () => {
  assert.match(canvas, /inputRevision[\s\S]*?edge\.id[\s\S]*?source\?\.updatedAt/);
  assert.match(canvas, /inputRevision=\{data\.inputRevision\}/);
  assert.match(adapter, /edge\.target === id[\s\S]*?node\.generatedOutputs/);
  assert.match(adapter, /node\.selectedOutputNodeId[\s\S]*?outputs\.find/);
  assert.match(adapter, /edgeId: String\(edge\.id/);
  assert.match(director, /incomingImages\.at\(-1\)/);
  assert.match(director, /edgeId: image\.edgeId/);
  assert.match(director, /storyai:director-desk-panorama-clear/);
  assert.match(
    director,
    /storyai:director-desk-panorama-removed[\s\S]*?removeDirectorIncomingEdge/,
  );
  assert.match(directorBridge, /storyai:director-desk-panorama-clear[\s\S]*?clearHostPanorama/);
});
test('3D 导演台空闲时停止连续渲染且连续变换只持久化一次', () => {
  assert.equal(directorCanvas.match(/frameloop="demand"/g)?.length, 2);
  assert.match(directorCanvas, /dpr=\{0\.75\}/);
  assert.match(
    directorScene,
    /onMouseUp=\{\(\) => \{[\s\S]*?onObjectChange\(\);[\s\S]*?endUndoBatch\(\)/,
  );
  assert.doesNotMatch(directorScene, /onObjectChange=\{onObjectChange\}/);
  assert.match(directorStore, /batchingTransform[\s\S]*?persist && !batchingTransform/);
  assert.match(
    directorStore,
    /if \(shouldPushUndoEntry\)[\s\S]*?writePersistedDirectorState\(currentSnapshot\)/,
  );
});
test('并发任务轮询只在状态变化时触发合并持久化', () => {
  const update =
    task.match(/function applyRemoteTaskUpdate\(node, task, remote\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(update, /const changed =/);
  assert.match(update, /touchProject\(\{ sessionDelay: 500, coalesceSession: true \}\)/);
  assert.match(project, /if \(sessionPersistTimer && coalesce\) return/);
});
test('图片节点读取缓存缩略图且整个节点可选择', () => {
  assert.match(node, /useMediaPreviewCache\([\s\S]*?maxSize: 960/);
  assert.match(mediaCache, /readImagePreview\(input\.path, input\.maxSize \|\| 960\)/);
  assert.match(api, /activeImagePreviewReads < 4/);
  assert.match(node, /className="work-node-wrapper"[\s\S]*?actions\.select\(node\.id\)/);
});
