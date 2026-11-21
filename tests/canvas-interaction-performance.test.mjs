import assert from 'node:assert/strict';
import test from 'node:test';
import { readGenerationNodeSource } from './helpers/generationNodeSource.mjs';
import { readLocalizedSource as readSource, readSource as readRawSource } from './helpers/sourceContract.mjs';
const canvas = readSource('renderer/src/app/canvas/CanvasNodeToolbar.tsx') + readSource('renderer/src/app/canvas/WorkflowCanvas.tsx');
const node = readGenerationNodeSource();
const audioPreview = readSource('renderer/src/app/canvas/GenerationAudioPreview.tsx');
const canvasGeometry = readSource('renderer/src/app/canvas/canvasScreenGeometry.ts');
const styles = readSource('renderer/styles/canvas.css');
const task = readSource('renderer/src/store/taskStore.ts');
const project = readSource('renderer/src/store/projectStore.ts') + readSource('renderer/src/store/projectNormalization.ts');
const api = readSource('renderer/src/services/tauriApi.ts');
const previewQueue = readSource('renderer/src/app/canvas/previewLoadQueue.ts');
const mediaCacheHook = readSource('renderer/src/app/canvas/useMediaPreviewCache.ts');
const mediaCache = readSource('renderer/src/services/mediaPreviewCache.ts');
const mediaCommands = readSource('electron/ipc/commands/media.ts') + readSource('electron/core/media.ts');
const director = readSource('renderer/src/app/canvas/PrevisWorldNode.tsx');
const directorRaw = readRawSource('renderer/src/app/canvas/PrevisWorldNode.tsx');
const directorStyles = readSource('renderer/src/app/canvas/PrevisWorldNode.css');
const directorHost = readSource('renderer/src/app/adapters/previsBridge.ts');
const workbench = readSource('renderer/src/app/ReactWorkbench.tsx');
const creationView = readSource('renderer/src/app/views/CreationView.tsx');
const shell = readSource('renderer/src/app/AppShell.tsx');
const adapter = readSource('renderer/src/app/adapters/canvasAdapter.ts') + readSource('renderer/src/app/adapters/canvas/canvasViewData.ts');
const canvasHistory = readSource('renderer/src/store/canvasHistoryStore.ts');
const canvasDrag = await import('../renderer/src/utils/canvasNodeDrag.ts');
const { zoomViewportAt } = await import('../renderer/src/app/canvas/canvasWheelZoom.ts');
const canvasDragSource = readSource('renderer/src/utils/canvasNodeDrag.ts');
const nodeChrome = await import('../renderer/src/utils/canvasNodeChrome.ts');
const migrationStyles = readSource('renderer/styles/canvas.css');
test('React Flow 保持节点挂载并在拖动结束后合并持久化', () => {
  assert.match(canvas, /proOptions=\{\{ hideAttribution: true \}\}/);
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
  assert.match(canvas, /onResize=\{onResize\}/);
  assert.match(canvas, /onResizeEnd=\{onResizeEnd\}/);
  assert.match(canvas, /positionCanvasPattern\(patternLayer\.current, next\)/);
  assert.match(canvas, /onMove=\{onCameraMove\}/);
  assert.match(canvas, /onMoveEnd=\{onMoveEnd\}/);
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
  assert.match(node, /onPointerEnter=\{\(\) => \{[\s\S]*?video\.muted = videoMuted;[\s\S]*?video\.play\(\)/);
  assert.match(node, /onPointerLeave=\{\(event\) => \{[\s\S]*?event\.buttons\) return;[\s\S]*?videoPreviewRef\.current\?\.pause\(\)/);
  assert.doesNotMatch(node, /video\.pause\(\);\s*if \(video\.duration/);
  assert.match(audioPreview, /<audio[\s\S]*?className="nodrag nopan nowheel[^"]*"/);
  assert.match(audioPreview, /className="audio-waveform"[\s\S]*?audio\.currentTime =/);
  assert.match(audioPreview, /className="audio-waveform-player nowheel"/);
  assert.doesNotMatch(audioPreview, /className="audio-waveform-player nodrag/);
  assert.match(audioPreview, /audio-waveform-play nodrag nopan/);
  assert.match(audioPreview, /audio-waveform-download nodrag nopan/);
  assert.match(audioPreview, /formatMediaTime\(currentTime\)[\s\S]*?formatMediaTime\(duration\)/);
  assert.match(audioPreview, /audio-waveform-play[\s\S]*?playing \? <IconSymbol name="pause" \/> : <i className="audio-play-glyph"/);
  assert.match(audioPreview, /saveArrayBuffer\(fileName \|\| "audio\.m4a", buffer\)/);
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
  assert.match(canvas, /isVisible=\{selected && !imageAnnotationOpen\}/);
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
  assert.match(styles, /\.work-composer-anchor \{[\s\S]*?opacity var\(--duration-fast\) var\(--ease-out\),[\s\S]*?translate var\(--duration-enter\) var\(--ease-sheet\)/);
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
test('视频节点移除原生控件并在悬停预览区域播放原始声音', () => {
  assert.doesNotMatch(node, /<video[^>]*\bcontrols\b/);
  assert.match(node, /onPointerEnter=\{\(\) => \{[\s\S]*?video\.muted = videoMuted;[\s\S]*?video\.volume = 1;[\s\S]*?video\.play\(\)/);
  assert.match(node, /onPointerLeave=\{\(event\) => \{[\s\S]*?videoPreviewRef\.current\?\.pause\(\)/);
  assert.match(migrationStyles, /\.work-preview > video \{ object-fit: cover; \}/);
});
test('视频节点持续显示时长并提供声音开关', () => {
  assert.match(node, /muted=\{videoMuted\}/);
  assert.match(node, /onDurationChange=[\s\S]*?setVideoDuration[\s\S]*?onTimeUpdate=[\s\S]*?setVideoTime/);
  assert.match(node, /className="work-video-status"[\s\S]*?formatMediaTime\(videoTime\)[\s\S]*?formatMediaTime\(videoDuration\)/);
  assert.match(node, /className="work-video-controls nodrag nopan"[\s\S]*?videoPlaying[\s\S]*?requestFullscreen/);
  assert.doesNotMatch(node, /10 \* Math\.min\(1, semanticZoom\)/);
  assert.match(node, /className="work-video-control-button"[\s\S]*?nextMuted = !videoMuted[\s\S]*?volume-x[\s\S]*?volume/);
  assert.match(migrationStyles, /\.work-video-status \{[\s\S]*?border-radius: var\(--radius-sm\)[\s\S]*?background: var\(--overlay-chip\)[\s\S]*?opacity: 1/);
  assert.match(migrationStyles, /\.work-preview:hover \.work-video-status \{[\s\S]*?opacity: 0[\s\S]*?visibility: hidden/);
  assert.match(migrationStyles, /\.work-video-controls \{[\s\S]*?background: linear-gradient\(180deg, transparent, var\(--overlay-fade\)\)/);
  assert.match(migrationStyles, /\.audio-play-glyph \{[\s\S]*?border-left: 6px solid var\(--overlay-ink\)/);
  assert.match(migrationStyles, /\.work-preview \.audio-waveform-download svg \{ width: var\(--canvas-node-icon-size\); height: var\(--canvas-node-icon-size\); \}/);
});
test('工作台只计算当前路由数据且素材选择器按需加载', () => {
  assert.match(workbench, /appRoute === "creation" \? canvasViewData\(\) : null/);
  assert.match(workbench, /\["assets", "materials"\]\.includes\(appRoute\)/);
  assert.match(workbench, /loadMaterials: resourceLibraryData/);
  assert.match(creationView, /picker && <AssetLibraryModal/);
  assert.match(readSource('renderer/src/app/components/AssetLibraryBrowser.tsx'), /controller\.loadMaterials\(\)/);
  assert.match(shell, /<section className="content">\s*\{view\}/);
  assert.doesNotMatch(workbench, /agentSession\.subscribe\(refresh\)/);
  // Chat subscriptions and message rendering belong to the isolated official client.
  assert.match(creationView, /<HarnessChatPanel/);
});
test('画布视图用索引关联素材且每个节点只保留两个 Loose 端口', () => {
  const media = readSource('renderer/src/utils/nodeMedia.ts');
  assert.match(media, /const related = new Map/);
  assert.match(media, /related\.get\(String\(node\.id/);
  assert.match(adapter, /createNodeMediaCatalog\(store\.project\)/);
  assert.equal(canvas.match(/<Handle/g)?.length, 2);
  assert.equal(node.match(/<Handle/g)?.length || 0, 0);
});
test('节点与连线使用线性索引和稳定集合', () => {
  assert.match(canvasDragSource, /new Map\(currentNodes\.map/);
  assert.match(canvas, /const ids = useMemo\(\(\) => new Set/);
  assert.match(canvas, /\.filter\(\(edge\) => ids\.has\(edge\.source\)/);
});
test('画布缩放只更新视口，缩放结束后无需重算节点坐标', () => {
  assert.match(canvas, /position: \{\s*x: Number\(node\.x\) \|\| 0,\s*y: Number\(node\.y\) \|\| 0/);
  assert.match(canvas, /toFlowNodes\(visible, edges, flowNodeCache\.current\),\s*\[edges, visible\]/);
  assert.match(canvas, /defaultViewport=\{\{ x: viewport\.x, y: viewport\.y, zoom: initialZoom \}\}/);
  assert.match(canvas, /minZoom=\{MIN_CANVAS_ZOOM\}[\s\S]*?maxZoom=\{MAX_CANVAS_ZOOM\}/);
  assert.match(canvas, /zoomOnScroll=\{false\}[\s\S]*?zoomOnPinch=\{false\}/);
  assert.match(canvas, /if \(zooming\) \{[\s\S]*?wheelZoom\.enqueue/);
  assert.match(canvas, /instance\.setViewport\(next\)/);
  assert.match(canvas, /applyCanvasViewport\(zoomViewportAt\(current, zoom, center\)\)/);
  assert.match(canvas, /createCanvasWheelPan\(\{[\s\S]*?applyCanvasViewport\(\{ \.\.\.position, zoom: instance\.getZoom\(\) \}\)/);
  assert.doesNotMatch(canvas, /setSemanticZoom|finishViewportPreview/);
  assert.match(canvas, /wheelPan\.enqueue\(dx, dy, event\.deltaMode, event\.deltaMode === 2 \? root\.clientHeight : 0\)/);
  assert.match(canvas, /panOnDrag=\{panMode \? \[0, 1, 2\] : \[1, 2\]\}/);
});
test('连续缩放保留鼠标下的画布坐标', () => {
  const anchor = { x: 217.25, y: 432.5 };
  let viewport = { x: -183.75, y: 72.5, zoom: 0.63 };
  const canvasX = (anchor.x - viewport.x) / viewport.zoom;
  const canvasY = (anchor.y - viewport.y) / viewport.zoom;
  for (const zoom of [0.615, 0.552, 0.913, 2.21, 0.1, 4, 0.637]) {
    viewport = zoomViewportAt(viewport, zoom, anchor);
    assert.ok(Math.abs(viewport.x + canvasX * zoom - anchor.x) < 1e-9);
    assert.ok(Math.abs(viewport.y + canvasY * zoom - anchor.y) < 1e-9);
  }
});
test('节点文字、图标和错误态共享语义尺寸并沿同一缩放轨道', () => {
  // 画布只按角色命名尺寸，值和字体阶梯/图标刻度仍归 tokens.css 所有。
  assert.match(styles, /--canvas-node-title-size: var\(--text-body-12\)/);
  assert.match(styles, /--canvas-node-body-size: var\(--text-body-12\)/);
  assert.match(styles, /--canvas-node-error-size: var\(--text-body-12\)/);
  assert.match(styles, /--canvas-node-icon-size: var\(--icon-xs\)/);
  assert.match(styles, /--canvas-node-head-height: 24px/);
  assert.match(styles, /\.work-error \{[\s\S]*?font-size: var\(--canvas-node-error-size\)[\s\S]*?word-break: break-word/);
  assert.match(styles, /\.audio-waveform-download \{[\s\S]*?width: var\(--canvas-node-action-size\)[\s\S]*?height: var\(--canvas-node-action-size\)/);
  // 文字和图标与节点共享视口缩放。
  assert.doesNotMatch(canvas, /--node-semantic-zoom/);
  assert.doesNotMatch(styles, /--node-semantic-zoom/);
  assert.doesNotMatch(directorStyles, /--node-semantic-zoom/);
});
test('导演台名称使用画布外部标签并和语义缩放同步', () => {
  assert.match(director, /CanvasNodeLabelRootContext/);
  assert.match(director, /className="previs-node-label"/);
  assert.match(directorStyles, /\.previs-node-label > svg \{\s*width: var\(--canvas-node-icon-size\)/);
  assert.match(directorStyles, /\.previs-node-workspace \{[\s\S]*?height: 100%;/);
  assert.match(canvas, /<CanvasNodeContent width=\{dimensions\.width\} height=\{dimensions\.height\}/);
  assert.match(directorStyles, /\.previs-card-title \{[\s\S]*?font-size: var\(--text-body-15\)/);
  assert.match(directorStyles, /\.previs-card-shot \{[\s\S]*?font-size: var\(--text-caption-11\)/);
  assert.doesNotMatch(migrationStyles, /canvas-zoom-overview :is\([\s\S]*?\.previs-card-title/);
  assert.doesNotMatch(migrationStyles, /canvas-zoom-overview :is\([\s\S]*?\.previs-card-preview/);
  assert.match(canvas, /function CanvasNodeContent/);
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
  assert.match(canvas, /handles: canvasNodePortBounds\(width, height\)/);
  assert.match(canvas, /measured: \{ width, height \}/);
  assert.match(styles, /\.canvas-flow-port-in \{ left: 0;/);
  assert.match(styles, /\.canvas-flow-port-out \{ right: 0;/);
  assert.match(styles, /\.canvas-flow-port-out::before \{ left: 100%;/);
});
test('画布倍率变化不隐藏内容也不给连线单独降透明度', () => {
  assert.doesNotMatch(canvas, /label:.*roleLabel/);
  assert.doesNotMatch(canvas, /const roleLabel/);
  assert.doesNotMatch(canvas, /opacity: semanticZoom|strokeWidth:/);
  assert.doesNotMatch(canvas, /canvas-zoom-(compact|distant|overview)/);
  assert.match(canvas, /className="canvas-node-label-anchor"[\s\S]*?top: -CANVAS_NODE_LABEL_OFFSET,[\s\S]*?width: dimensions\.width/);
  assert.match(canvas, /CanvasNodeLabelRootContext\.Provider value=\{labelRoot\}/);
  assert.match(canvas, /className="react-workflow-canvas"/);
  assert.doesNotMatch(canvas, /--canvas-label-scale/);
  assert.doesNotMatch(migrationStyles, /--canvas-label-scale/);
  assert.doesNotMatch(migrationStyles, /canvas-zoom-overview/);
  assert.doesNotMatch(migrationStyles, /--node-label-zoom/);
  assert.doesNotMatch(migrationStyles, /canvas-zoom-compact \.work-node-kicker \{[^}]*?inset:/);
  assert.doesNotMatch(migrationStyles, /canvas-zoom-compact \.work-node-kicker > span/);
  assert.match(migrationStyles, /inset: -28px 0 auto;/);
  // 入口和节点名称随卡片等比缩小。
  assert.doesNotMatch(canvas, /nodeActionCounterScale|--node-action-scale|--node-logical-width/);
  assert.doesNotMatch(migrationStyles, /(^|\n)\s*zoom:/);
  assert.doesNotMatch(migrationStyles, /canvas-zoom-compact[^{]*\.text-result-starters/);
  assert.doesNotMatch(migrationStyles, /canvas-zoom-overview :is/);
  assert.doesNotMatch(migrationStyles, /canvas-zoom-overview \.canvas-flow-port/);
});
test('画布缩放时连线保持屏幕线宽', () => {
  assert.match(migrationStyles, /--xy-edge-stroke-width: var\(--canvas-edge-width\);/);
  assert.match(migrationStyles, /\.react-workflow-canvas \.react-flow__connection-path \{ fill: none; stroke-width: var\(--canvas-edge-width\); \}/);
  assert.match(migrationStyles, /\.react-flow__edge-path, \.react-flow__edge-interaction,[^}]*vector-effect: non-scaling-stroke/);
  assert.doesNotMatch(migrationStyles, /--canvas-semantic-zoom/);
  assert.doesNotMatch(canvas, /markerWidth|markerUnits|strokeWidth/);
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
  assert.match(canvasGeometry, /clientX - bounds\.left/);
  assert.match(canvasGeometry, /clientY - bounds\.top/);
  assert.match(canvasGeometry, /bounds\.width - CANVAS_MENU_WIDTH/);
  assert.match(canvasGeometry, /menuHeight = CANVAS_MENU_HEIGHT/);
  assert.match(canvasGeometry, /bounds\.height - menuHeight/);
});
test('连线使用 Loose 模式、点击连接和恒定屏幕吸附范围', () => {
  assert.match(canvas, /connectOnClick/);
  assert.match(canvas, /ConnectionMode\.Loose/);
  assert.match(canvas, /connectionRadius=\{64 \/ Math\.max\(MIN_CANVAS_ZOOM, zoomPercent \/ 100\)\}/);
});
test('连线按节点相对位置选择最近端口且不会折返回头', () => {
  assert.match(canvas, /const targetIsRight = targetCenter >= sourceCenter/);
  assert.match(canvas, /: targetIsRight \? "port-right" : "port-left"/);
  assert.match(canvas, /: targetIsRight \? "port-left" : "port-right"/);
  assert.equal(canvas.match(/<Handle/g)?.length, 2);
  assert.match(canvas, /className="canvas-flow-port canvas-flow-port-in"[\s\S]*?className="canvas-flow-port canvas-flow-port-out"/);
});
test('3D 导演台随节点比例铺满，画布删除键删除当前节点选择', () => {
  assert.match(director, /className="previs-card"/);
  assert.match(director, /className="previs-card-preview nodrag"/);
  assert.match(directorRaw, /t\("ui\.previsWorld\.open"\)/);
  assert.match(canvas, /keepAspectRatio=\{item\.type === "threeDDirector"\}/);
  assert.match(canvas, /resizing=\{resizing\}/);
  assert.doesNotMatch(director, /if \(resizing\) return/);
  assert.match(director, /resizing \? " resizing"/);
  assert.match(directorStyles, /\.previs-node\.resizing[\s\S]*?pointer-events: none/);
  assert.match(canvas, /tabIndex=\{0\}/);
  assert.match(canvas, /event\.currentTarget\.focus\(\{ preventScroll: true \}\)/);
  assert.equal(canvas.match(/if \(!isCanvasDomEvent\(event\.nativeEvent, event\.currentTarget\)\) return;/g)?.length, 2);
  assert.match(canvas, /root\.addEventListener\('wheel', onWheel, \{ passive: false, capture: true \}\)/);
  assert.match(canvas, /if \(!isCanvasDomEvent\(event, root\)\) return;/);
  assert.match(canvas, /const editable = isEditableCanvasEvent\(event\.nativeEvent\)/);
  assert.match(
    canvas,
    /event\.key === "Backspace" \|\| event\.key === "Delete"[\s\S]*?event\.preventDefault\(\);[\s\S]*?controller\.deleteSelection\(\)/,
  );
  assert.match(adapter, /selectNodes\(ids\) \{\s*store\.selectedEdgeId = null/);
  assert.match(adapter, /select\(id\) \{\s*store\.selectedEdgeId = null/);
});
test('3D 导演台的删除键只删除内部对象，不删除画布节点', () => {
  assert.doesNotMatch(directorHost, /onDeleteNode/);
  assert.doesNotMatch(director, /onDeleteNode/);
  assert.match(directorRaw, /title=\{t\("ui\.previsWorld\.delete"\)\}[\s\S]*?actions\.delete\(node\.id\)/);
});
test('3D 导演台默认整块可移动，双击后进入场景交互', () => {
  assert.doesNotMatch(canvas, /dragHandle: node\.type === "threeDDirector"/);
  assert.match(director, /className="previs-node-drag-handle"/);
  assert.match(director, /interacting \? " nodrag" : ""/);
  assert.match(director, /onDoubleClick=[\s\S]*?setInteracting\(true\)/);
  assert.match(director, /event\.key === "Escape"[\s\S]*?setInteracting\(false\)/);
  assert.match(director, /onClose: \(\) => \{[\s\S]*?setInteracting\(false\)/);
  assert.match(directorRaw, /className="previs-card-preview nodrag"[\s\S]*?ui\.previsWorld\.open/);
  assert.match(directorStyles, /\.previs-node-drag-handle[\s\S]*?cursor: grab/);
});
test('3D 导演台从真实上游连线同步当前图片输出', () => {
  assert.match(readSource('renderer/src/app/canvas/canvasInputIndex.ts'), /edge\.id[\s\S]*?source\?\.updatedAt/);
  assert.match(canvas, /inputRevision=\{data\.inputRevision\}/);
  assert.match(adapter, /edge\.target === id[\s\S]*?selectedNodeMedia\(node, store\.project\)/);
  assert.match(adapter, /edgeId: String\(edge\.id/);
  assert.match(director, /toImageNodes\(incomingImages\)/);
  assert.match(director, /sendPrevisImages\(detailIframeRef\.current, toImageNodes\(incomingImages\)\)/);
  assert.match(directorHost, /\$\{PREFIX\}-images/);
});

test('vendored 导演台只通过宿主适配层通信', () => {
  // 上游私有协议在产品侧只有一个拥有者：消息名与 iframe 入口都写在宿主适配层里。
  assert.match(directorHost, /const PREFIX = "shotloom:previs"/);
  assert.match(directorHost, /\$\{PREFIX\}-scene-changed/);
  assert.match(directorHost, /previs-world-app\/index\.html\?instanceId=\$\{encodeURIComponent\(instanceId\)\}&theme=\$\{theme\}/);
  // 来源校验属于协议：别的窗口发来的同名消息不能被当成导演台回执。
  assert.match(
    directorHost,
    /event\.origin !== window\.location\.origin \|\| event\.source !== getFrame\(\)\?\.contentWindow/,
  );
  // 画布组件只消费类型化回调，不再自己比较协议字符串。
  assert.doesNotMatch(director, /shotloom:previs/);
  assert.doesNotMatch(director, /previs-world-app/);
  assert.match(director, /subscribePrevisWorld\(getFrame, \{/);
  assert.match(director, /src=\{previsWorldFrameSrc\(node\.id, "light"\)\}/);
});
test('并发任务轮询只在状态变化时触发合并持久化', () => {
  const update =
    task.match(/function applyRemoteTaskUpdate\(node: AnyRecord, task: AnyRecord, remote: AnyRecord\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(update, /const changed =/);
  assert.match(update, /touchProject\(\{ sessionDelay: 500, coalesceSession: true \}\)/);
  assert.match(project, /if \(sessionPersistTimer && coalesce\) return/);
});
test('图片预览在缩放稳定后升级清晰度且视频不订阅预览尺寸', () => {
  assert.match(canvas, /MEDIA_PREVIEW_ZOOM_SETTLE_MS = 220/);
  assert.match(canvas, /setTimeout\(\(\) => \{[\s\S]*?setPreviewZoom\(next\.zoom\)[\s\S]*?MEDIA_PREVIEW_ZOOM_SETTLE_MS/);
  assert.match(canvas, /toFlowNodes\(visible, edges, flowNodeCache\.current\)/);
  assert.match(canvas, /CanvasPreviewZoomContext\.Provider value=\{previewZoom\}/);
  assert.doesNotMatch(canvas, /data: \{ node, inputRevision, incomingInputs, semanticZoom, previewZoom \}/);
  assert.match(node, /const previewZoom = useContext\(CanvasPreviewZoomContext\)/);
  assert.match(node, /kind === "image" \? canvasPreviewMaxSize\(previewZoom\) : undefined/);
  assert.match(node, /350 \* Math\.max\(1, semanticZoom\) \* dpr[\s\S]*?return 2048[\s\S]*?return 1536[\s\S]*?return 960/);
  assert.match(mediaCache, /readImagePreview\(input\.path, input\.maxSize \|\| 960\)/);
  assert.match(mediaCommands, /jpeg-preview-v3/);
  // 预览统一走一次 JPEG 编码（mjpeg q=2，接近 Rust 的 quality 92）。
  assert.match(mediaCommands, /'-c:v', 'mjpeg', '-q:v', '2'/);
  assert.match(api, /activeImagePreviewReads < 4/);
  assert.match(node, /className="work-node-wrapper"[\s\S]*?actions\.select\(node\.id\)/);
});
test('连线与端点只在 CSS 主题变量里取色，缩放不再重建连线对象', () => {
  assert.match(styles, /--xy-edge-stroke: var\(--canvas-edge\);/);
  assert.match(styles, /--xy-edge-stroke-width: var\(--canvas-edge-width\);/);
  assert.match(styles, /--xy-edge-stroke-selected: var\(--canvas-edge-selected\);/);
  assert.match(styles, /--xy-connectionline-stroke: var\(--canvas-edge-flow\);/);
  assert.match(styles, /\.canvas-connection-decoration circle \{ fill: var\(--canvas-edge\); \}/);
  assert.match(styles, /\.canvas-connection-beam \{[\s\S]*?stroke: var\(--canvas-edge-flow\);/);
  assert.match(canvas, /edgeTypes=\{canvasEdgeTypes\}/);
  assert.doesNotMatch(canvas, /stroke: "#|strokeWidth: 1\.5|color: "#c4c4c4"/);
  assert.match(canvas, /\[edges, ids, visibleById, selectedEdgeId\]/);
});


test('缩放时外部快照保留正在拖动的尺寸与锚点，松手后接收已保存的尺寸', () => {
  const live = { id: 'script', resizing: true, position: { x: 60, y: 80 }, width: 760, height: 520, measured: { width: 760, height: 520 }, data: { revision: 1 } };
  let current = [live];
  for (let revision = 2; revision <= 5; revision++) {
    const reconciled = canvasDrag.reconcileCanvasNodes(current, [{ id: 'script', position: { x: 100, y: 80 }, width: 920, height: 440, data: { revision } }], new Set());
    assert.equal(reconciled, current);
    current = reconciled;
    assert.equal(current[0], live);
    assert.equal(current[0].width, 760);
    assert.equal(current[0].position.x, 60);
  }
  assert.equal(canvasDrag.reconcileCanvasNodes(current, [], new Set())[0], live);
  const saved = { id: 'script', position: { x: 60, y: 80 }, width: 760, height: 520, data: { revision: 6 } };
  const released = [{ ...live, resizing: false }];
  assert.equal(canvasDrag.reconcileCanvasNodes(released, [saved], new Set())[0], saved);
});
