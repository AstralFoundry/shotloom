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
const styles = readFileSync(
  new URL('../renderer/styles/react-migration.css', import.meta.url),
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
const fileCommands = readFileSync(
  new URL('../src-tauri/src/commands/file.rs', import.meta.url),
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
const canvasDrag = await import('../renderer/src/utils/canvasNodeDrag.mjs');
const canvasDragSource = readFileSync(
  new URL('../renderer/src/utils/canvasNodeDrag.mjs', import.meta.url),
  'utf8',
);
const nodeChrome = await import('../renderer/src/utils/canvasNodeChrome.mjs');
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
test('React Flow 保持节点挂载并在拖动结束后合并持久化', () => {
  assert.match(canvas, /onlyRenderVisibleElements=\{false\}/);
  assert.doesNotMatch(canvas, /NODE_VIRTUALIZATION_THRESHOLD/);
  assert.doesNotMatch(canvas, /draggingIds|pendingPositionCommits|dragEnded/);
  assert.match(canvas, /useNodesState<FlowNode>/);
  assert.match(canvas, /reconcileCanvasNodes\(current, canonicalNodes, draggingNodeIds\.current\)/);
  assert.match(canvas, /flowNodeCache/);
  assert.match(canvas, /cached\.input === node[\s\S]*?return cached\.output/);
  assert.match(canvas, /const interactiveChanges = changes\.filter\(\(change\) => change\.type !== "remove"\)/);
  assert.match(canvas, /applyFlowNodeChanges\(interactiveChanges\)/);
  assert.match(canvas, /flowEdgeCache/);
  assert.match(canvas, /cached\?\.signature === signature[\s\S]*?return cached\.output/);
  assert.match(canvas, /__shotloomCanvasDebug/);
  assert.match(canvas, /traceCanvasEvent\("nodes-change"/);
  assert.doesNotMatch(canvas, /traceCanvasEvent\("dom-frame"/);
  assert.match(canvas, /traceCanvasEvent\("drag-stop"/);
  assert.match(adapter, /canvasViewNodeCache/);
  assert.match(adapter, /cached\?\.signature === signature[\s\S]*?return cached\.node/);
  assert.match(canvas, /const onNodeDragStart: OnNodeDrag<FlowNode>[\s\S]*?draggingNodeIds\.current\.add/);
  assert.match(canvas, /const onNodeDragStop: OnNodeDrag<FlowNode>[\s\S]*?draggedCanvasPositions[\s\S]*?controller\.moveNodes\(moved\)/);
  assert.match(canvas, /onNodeDragStop=\{onNodeDragStop\}/);
  assert.doesNotMatch(canvas, /controller\.moveNodes\(moved, \{ recordHistory \}\)/);
  assert.match(canvas, /autoPanOnNodeDrag=\{false\}/);
  assert.doesNotMatch(canvas, /onMove=\{\(_event, next\) => setLiveViewport\(next\)\}/);
  assert.doesNotMatch(canvas, /useInternalNode/);
  assert.match(canvas, /selected && resizable && \([\s\S]*?<NodeResizer/);
  assert.match(canvas, /onResizeStart=\{\(\) => setResizing\(true\)\}/);
  assert.doesNotMatch(canvas, /CanvasGrid|canvas-grid-layer/);
  assert.match(canvas, /onMoveStart=\{onMoveStart\}/);
  assert.match(canvas, /MEDIA_NODE_TYPES\.has\(node\.type\) \? "canvas-media-node"/);
  assert.doesNotMatch(migrationStyles, /viewport-moving[^\{]*react-flow__viewport/);
  assert.doesNotMatch(canvas, /pendingNodeChanges|nodeChangeFrame/);
  assert.match(adapter, /saveViewport\(viewport\) \{\s*persistCanvasViewport\(viewport\)/);
  assert.match(project, /persistCanvasViewport[\s\S]*?toRaw\(store\.project\)/);
  assert.match(adapter, /recordCanvasPositionHistory\(positions\.map/);
  assert.match(canvasHistory, /kind: 'node-positions'/);
  assert.match(canvasHistory, /previous\.kind === 'node-positions'[\s\S]*?nodePositionSnapshot/);
});
test('连续拖动回流时节点与连线端点不会从受控节点集合丢失', () => {
  let current = [
    { id: 'source', position: { x: 80, y: 60 }, data: { revision: 0 } },
    { id: 'target', position: { x: 360, y: 60 }, data: { revision: 0 } },
  ];
  const dragging = new Set(['source']);
  for (let revision = 1; revision <= 200; revision += 1) {
    current = current.map((node) => node.id === 'source'
      ? { ...node, dragging: true, position: { x: 80 + revision, y: 60 + revision } }
      : node);
    const canonical = [
      { id: 'source', position: { x: 80, y: 60 }, data: { revision } },
      { id: 'target', position: { x: 360, y: 60 }, data: { revision } },
    ];
    const activeDragNode = current[0];
    current = canvasDrag.reconcileCanvasNodes(current, canonical, dragging);
    assert.deepEqual(current.map((node) => node.id), ['source', 'target']);
    assert.equal(current[0], activeDragNode);
    assert.deepEqual(current[0].position, { x: 80 + revision, y: 60 + revision });
    assert.equal(current[0].data.revision, 0);
  }
  assert.deepEqual(
    canvasDrag.draggedCanvasPositions(current[0], [], 0.5),
    [{ id: 'source', x: 560, y: 520 }],
  );
});
test('外部画布快照短暂缺项时保留正在拖动的节点', () => {
  const current = [
    { id: 'dragging', dragging: true, position: { x: 180, y: 120 }, data: {} },
    { id: 'stable', position: { x: 420, y: 120 }, data: {} },
  ];
  const canonical = [
    { id: 'stable', position: { x: 420, y: 120 }, data: { revision: 1 } },
  ];
  const reconciled = canvasDrag.reconcileCanvasNodes(current, canonical, new Set(['dragging']));
  assert.deepEqual(reconciled.map((node) => node.id), ['stable', 'dragging']);
  assert.equal(reconciled[1], current[0]);
  assert.deepEqual(reconciled[1].position, { x: 180, y: 120 });
  assert.equal(reconciled[1].dragging, true);
});
test('拖动结束后才接收期间积累的外部节点更新', () => {
  const current = [
    { id: 'source', dragging: true, position: { x: 240, y: 180 }, data: { revision: 1 } },
  ];
  const canonical = [
    { id: 'source', position: { x: 80, y: 60 }, data: { revision: 2 } },
  ];
  const whileDragging = canvasDrag.reconcileCanvasNodes(
    current,
    canonical,
    new Set(['source']),
  );
  assert.equal(whileDragging[0], current[0]);

  const afterDrag = canvasDrag.reconcileCanvasNodes(whileDragging, canonical, new Set());
  assert.equal(afterDrag[0], canonical[0]);
  assert.equal(afterDrag[0].data.revision, 2);
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
test('视频画面可拖动节点且拖动期间保持播放', () => {
  assert.match(node, /<video[\s\S]*?className="nowheel"[\s\S]*?draggable=\{false\}[\s\S]*?playsInline/);
  assert.doesNotMatch(node, /preload="auto"\s*onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.doesNotMatch(node, /preload="auto"\s*onPointerDown=\{\(event\) => event\.currentTarget\.pause\(\)\}/);
  assert.match(node, /onPointerEnter=\{\(event\) => \{[\s\S]*?const video = event\.currentTarget;[\s\S]*?video\.play\(\)/);
  assert.match(node, /onPointerLeave=\{\(event\) => \{[\s\S]*?if \(event\.buttons\) return;[\s\S]*?video\.pause\(\)/);
  assert.doesNotMatch(node, /video\.pause\(\);\s*if \(video\.duration/);
  assert.match(node, /<audio[\s\S]*?className="nodrag nopan nowheel[^"]*"/);
  assert.match(node, /className="audio-waveform"[\s\S]*?audio\.currentTime =/);
  assert.match(node, /className="audio-waveform-player nowheel"/);
  assert.doesNotMatch(node, /className="audio-waveform-player nodrag/);
  assert.match(node, /audio-waveform-play nodrag nopan/);
  assert.match(node, /audio-waveform-download nodrag nopan/);
  assert.match(node, /formatAudioTime\(currentTime\)[\s\S]*?formatAudioTime\(duration\)/);
  assert.match(node, /audio-waveform-play[\s\S]*?playing \? <IconSymbol name="pause" \/> : <i className="audio-play-glyph"/);
  assert.match(node, /saveArrayBuffer\(fileName \|\| "audio\.m4a", buffer\)/);
  assert.match(node, /\(activeKind === "image" \|\| activeKind === "video"\) && previewUrl/);
  assert.match(node, /className="work-preview-download nodrag nopan"[\s\S]*?saveActiveMedia/);
  assert.match(node, /saveArrayBuffer\(activeFileName, buffer\)/);
  assert.match(migrationStyles, /\.work-preview-download \{[\s\S]*?opacity: 0;[\s\S]*?pointer-events: none/);
  assert.match(migrationStyles, /\.work-node:hover \.work-preview-download,[\s\S]*?\.work-preview-download:focus-visible[\s\S]*?opacity: \.88;[\s\S]*?pointer-events: auto/);
  assert.ok((node.match(/onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/g)?.length || 0) >= 1);
  assert.doesNotMatch(styles, /\.react-workflow-canvas \.react-flow__node\.dragging\s*\{[\s\S]*?will-change:\s*transform/);
});

test('拖动节点时隐藏上下浮层并在松手后由 React Flow 状态恢复', () => {
  assert.match(canvas, /function CanvasNode\(\{ data, selected, dragging \}/);
  assert.match(canvas, /nodeChromeHidden \? " canvas-node-selection-toolbar--hidden"/);
  assert.match(canvas, /isVisible=\{selected\}/);
  assert.doesNotMatch(canvas, /className="canvas-node-label-anchor"[\s\S]*?visibility: nodeChromeHidden/);
  assert.doesNotMatch(canvas, /<Renderer[\s\S]*?dragging=\{dragging\}/);
  assert.match(node, /labelRoot && createPortal\(nodeLabel/);
  assert.match(node, /<ScreenSpaceComposer nodeId=\{node\.id\}>/);
  assert.match(node, /state\.nodeLookup\.get\(nodeId\)\?\.dragging/);
  assert.match(styles, /\.work-composer-anchor--hidden \{[\s\S]*?opacity:\s*0;[\s\S]*?translate:\s*0 -10px;[\s\S]*?transition:\s*none;[\s\S]*?pointer-events:\s*none;/);
  assert.match(styles, /\.canvas-node-selection-toolbar--hidden \{[\s\S]*?opacity:\s*0;[\s\S]*?translate:\s*0 8px;[\s\S]*?transition:\s*none;[\s\S]*?pointer-events:\s*none;/);
});

test('松手后等待坐标提交完成再恢复浮层', () => {
  assert.match(canvas, /dragReleaseSettling/);
  assert.match(canvas, /const nodeChromeHidden = Boolean\(dragging \|\| dragReleaseSettling\)/);
  assert.match(canvas, /const settleFrame = requestAnimationFrame[\s\S]*?revealFrame = requestAnimationFrame[\s\S]*?setTimeout\(\(\) => setDragReleaseSettling\(false\), 64\)/);
  assert.match(node, /const hidden = dragging \|\| dragReleaseSettling/);
  assert.doesNotMatch(canvas, /pendingPositionCommits|committedIds/);
  assert.match(styles, /\.canvas-node-asset-scope-menu--hidden \{[\s\S]*?opacity:\s*0;[\s\S]*?translate:\s*0 -7px;[\s\S]*?transition:\s*none;[\s\S]*?pointer-events:\s*none;/);
  assert.match(styles, /\.work-composer-anchor \{[\s\S]*?opacity 150ms ease-out,[\s\S]*?translate 220ms cubic-bezier\(\.22, 1, \.36, 1\)/);
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
test('视频节点移除原生控件并在悬停预览时播放原始声音', () => {
  assert.doesNotMatch(node, /<video[^>]*\bcontrols\b/);
  assert.match(node, /useState\(false\)[\s\S]*?className="nowheel"[\s\S]*?muted=\{videoMuted\}[\s\S]*?loop[\s\S]*?onPointerEnter/);
  assert.match(node, /onPointerEnter=\{\(event\) => \{[\s\S]*?video\.muted = videoMuted;[\s\S]*?video\.volume = 1;[\s\S]*?video\.play\(\)/);
  assert.match(node, /onPointerLeave=\{\(event\) => \{[\s\S]*?video\.pause\(\)/);
  assert.match(migrationStyles, /\.work-preview > video \{ object-fit: cover; \}/);
});
test('视频节点显示时长并提供悬停声音开关', () => {
  assert.match(node, /muted=\{videoMuted\}/);
  assert.match(node, /onDurationChange=[\s\S]*?setVideoDuration[\s\S]*?onTimeUpdate=[\s\S]*?setVideoTime/);
  assert.match(node, /className="work-video-status"[\s\S]*?formatAudioTime\(videoTime\)[\s\S]*?formatAudioTime\(videoDuration\)/);
  assert.match(node, /className="work-video-sound nodrag nopan"[\s\S]*?nextMuted = !videoMuted[\s\S]*?volume-x[\s\S]*?volume/);
  assert.match(migrationStyles, /\.work-video-status \{[\s\S]*?backdrop-filter: blur\(9px\)/);
  assert.match(migrationStyles, /\.work-node:hover \.work-video-sound,[\s\S]*?opacity: 1/);
  assert.match(migrationStyles, /\.audio-play-glyph \{[\s\S]*?border-left: 6px solid #fff/);
  assert.match(migrationStyles, /\.work-preview \.audio-waveform-download svg \{ width: 14px; height: 14px; \}/);
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
  assert.equal(canvas.match(/<Handle/g)?.length, 2);
  assert.equal(node.match(/<Handle/g)?.length || 0, 0);
});
test('节点与连线使用线性索引和稳定集合', () => {
  assert.match(canvasDragSource, /new Map\(currentNodes\.map/);
  assert.match(canvas, /const ids = useMemo\(\(\) => new Set/);
  assert.match(canvas, /\.filter\(\(edge\) => ids\.has\(edge\.source\)/);
});
test('画布缩放使用最终布局尺寸并保持 React Flow 视口为 1x', () => {
  assert.match(canvas, /x: screenPixel\(\(Number\(node\.x\) \|\| 0\) \* semanticZoom\)/);
  assert.match(canvas, /width: dimensions\.width \* semanticZoom/);
  assert.match(canvas, /className="canvas-node-semantic-content"[\s\S]*?zoom: semanticZoom/);
  assert.doesNotMatch(canvas, /className="canvas-node-semantic-content"[\s\S]{0,220}?transform: `scale/);
  assert.match(styles, /\.canvas-node-semantic-content \{[^}]*-webkit-text-size-adjust:\s*none;[^}]*text-size-adjust:\s*none/);
  assert.match(canvas, /defaultViewport=\{\{ x: viewport\.x, y: viewport\.y, zoom: 1 \}\}/);
  assert.match(canvas, /minZoom=\{1\}[\s\S]*?maxZoom=\{1\}/);
  assert.match(canvas, /zoomOnScroll=\{false\}[\s\S]*?zoomOnPinch=\{false\}/);
});
test('语义缩放时端口与节点边缘使用同一屏幕坐标', () => {
  for (const zoom of [0.55, 1, 1.8]) {
    const width = 240 * zoom;
    const height = 160 * zoom;
    const [left, right] = nodeChrome.canvasNodePortBounds(width, height);
    assert.equal(left.x, 0);
    assert.equal(right.x + right.width, width);
    assert.equal(left.y + left.height / 2, height / 2);
    assert.equal(right.y + right.height / 2, height / 2);
  }
  assert.match(canvas, /handles: canvasNodePortBounds\(screenWidth, screenHeight\)/);
  assert.match(canvas, /width: screenWidth,[\s\S]*?height: screenHeight/);
  assert.match(styles, /\.canvas-flow-port-in \{ left: 0;/);
  assert.match(styles, /\.canvas-flow-port-out \{ right: 0;/);
  assert.match(styles, /\.canvas-flow-port-out::before \{ left: 100%;/);
});
test('低倍率画布降低连线与节点操作的信息密度', () => {
  assert.doesNotMatch(canvas, /label:.*roleLabel/);
  assert.doesNotMatch(canvas, /const roleLabel/);
  assert.match(canvas, /strokeWidth: Math\.min\(1\.35, Math\.max\(0\.5, semanticZoom\)\)/);
  assert.match(canvas, /opacity: semanticZoom < 0\.55 \? 0\.48 : 0\.72/);
  assert.match(canvas, /canvas-zoom-compact[\s\S]*?canvas-zoom-distant[\s\S]*?canvas-zoom-overview/);
  assert.match(canvas, /const renderedSemanticZoom = renderedNodes\[0\]\?\.data\.semanticZoom \?\? semanticZoom/);
  assert.match(canvas, /className="canvas-node-label-anchor"[\s\S]*?top: -CANVAS_NODE_LABEL_HEIGHT \* semanticZoom,[\s\S]*?width: dimensions\.width \* semanticZoom/);
  assert.match(canvas, /CanvasNodeLabelRootContext\.Provider value=\{labelRoot\}/);
  assert.match(canvas, /Math\.round\(renderedSemanticZoom \* 100\) <= 20 \? " canvas-zoom-overview"/);
  assert.doesNotMatch(canvas, /--canvas-label-scale/);
  assert.doesNotMatch(migrationStyles, /--canvas-label-scale/);
  assert.match(migrationStyles, /canvas-zoom-overview \.work-node-kicker \{[\s\S]*?display: none/);
  assert.match(migrationStyles, /canvas-zoom-compact \.work-node-kicker \{[\s\S]*?opacity: \.68;[\s\S]*?pointer-events: none/);
  assert.doesNotMatch(migrationStyles, /canvas-zoom-compact \.work-node-kicker \{[^}]*?inset:/);
  assert.doesNotMatch(migrationStyles, /canvas-zoom-compact \.work-node-kicker > span/);
  assert.match(migrationStyles, /canvas-zoom-distant \.work-node-kicker \{ opacity: \.42; \}/);
  assert.match(migrationStyles, /canvas-zoom-overview :is\([\s\S]*?\.director-node-head,[\s\S]*?\.resource-meta,[\s\S]*?display: none !important/);
  assert.match(migrationStyles, /canvas-zoom-overview \.canvas-flow-port[\s\S]*?pointer-events: none/);
});
test('节点使用完整设计尺寸且旧画布只换算一次', () => {
  assert.match(project, /import \{[\s\S]*?CANVAS_NODE_SIZE_SCALE,[\s\S]*?\} from '@\/domain\/graph\/CanvasNodeDimensions'/);
  assert.match(project, /canvasNodeSizeScale: CANVAS_NODE_SIZE_SCALE/);
  assert.match(project, /canvasNodeSizingVersion: CANVAS_NODE_SIZING_VERSION/);
  assert.match(project, /storedNodeSizingVersion < CANVAS_NODE_SIZING_VERSION[\s\S]*?delete next\.canvasWidth;[\s\S]*?delete next\.canvasHeight/);
  assert.match(project, /storedNodeSizingVersion < CANVAS_NODE_SIZING_VERSION[\s\S]*?next\.type === 'audioGeneration'[\s\S]*?delete next\.canvasWidth;[\s\S]*?delete next\.canvasHeight/);
  assert.match(project, /CANVAS_NODE_SIZE_SCALE \/ storedNodeSizeScale/);
  assert.match(project, /usedOldGenericDefault[\s\S]*?delete next\.canvasWidth;[\s\S]*?delete next\.canvasHeight/);
  assert.match(project, /next\.canvasWidth = Math\.round\(next\.canvasWidth \* nodeSizeRatio\)/);
  assert.match(project, /next\.canvasHeight = Math\.round\(next\.canvasHeight \* nodeSizeRatio\)/);
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
  assert.match(canvas, /const sourceHandle = targetIsRight \? "port-right" : "port-left"/);
  assert.match(canvas, /const targetHandle = targetIsRight \? "port-left" : "port-right"/);
  assert.equal(canvas.match(/<Handle/g)?.length, 2);
  assert.match(canvas, /className="canvas-flow-port canvas-flow-port-in"[\s\S]*?className="canvas-flow-port canvas-flow-port-out"/);
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
test('图片节点按最终屏幕尺寸读取缓存预览且整个节点可选择', () => {
  assert.match(node, /canvasPreviewMaxSize\(semanticZoom\)/);
  assert.match(node, /350 \* Math\.max\(1, semanticZoom\) \* dpr[\s\S]*?return 2048[\s\S]*?return 1536[\s\S]*?return 960/);
  assert.match(mediaCache, /readImagePreview\(input\.path, input\.maxSize \|\| 960\)/);
  assert.match(fileCommands, /jpeg-preview-v3/);
  assert.match(fileCommands, /JpegEncoder::new_with_quality\(&mut encoded, 92\)/);
  assert.match(api, /activeImagePreviewReads < 4/);
  assert.match(node, /className="work-node-wrapper"[\s\S]*?actions\.select\(node\.id\)/);
});
