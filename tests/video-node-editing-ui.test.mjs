import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
test('图片、视频和音频节点共用直接加入剪辑入口', async () => {
  const [source, adapter] = await Promise.all([
    readFile(new URL('../renderer/src/app/canvas/GenerationNode.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../renderer/src/app/adapters/canvasAdapter.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(source, /className="video-export-trigger"/);
  assert.match(source, /\["image", "video", "audio"\]\.includes\(activeKind\)/);
  assert.match(source, /加入剪辑/);
  assert.match(source, /actions\.addToVideoEditor/);
  assert.match(adapter, /activeVideoEditorNodeId/);
  assert.match(adapter, /appendEditorMediaAsset/);
  assert.match(adapter, /sourceNodeId: id/);
  assert.doesNotMatch(source, /亮度|对比度|饱和度|trimStart|trimEnd/);
});
test('画布左侧视频剪辑入口直接打开空白工程并在编辑器内选择素材来源', async () => {
  const [sidebar, shell, workbench, workspace, adapter] = await Promise.all([
    readFile(new URL('../renderer/src/app/layout/SideBar.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../renderer/src/app/AppShell.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../renderer/src/app/ReactWorkbench.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../renderer/src/app/editor/VideoEditorWorkspace.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../renderer/src/app/adapters/canvasAdapter.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(sidebar, /onVideoEdit/);
  assert.match(sidebar, /<span>视频剪辑<\/span>/);
  assert.match(sidebar, /projectWorkspaceItems\.map[\s\S]*?route === "creation"[\s\S]*?<span>视频剪辑<\/span>[\s\S]*?<\/div>/);
  assert.doesNotMatch(sidebar, /<div className="side-title">剪辑<\/div>/);
  assert.doesNotMatch(sidebar, /nodeTypes\.map|onAddNode/);
  assert.match(shell, /onVideoEdit=\{onVideoEdit\}/);
  assert.match(workbench, /onVideoEdit=\{\(\) => canvasCommands\.openBlankVideoEditor\(\)\}/);
  assert.match(workbench, /editorNode\s*\?\s*\{/);
  assert.match(adapter, /openBlankVideoEditor\(\)/);
  assert.match(adapter, /addNode\("videoGeneration"\)/);
  assert.match(adapter, /videoEditorOpener\(node\.id\)/);
  assert.match(workspace, /选择素材来源/);
  assert.match(workspace, /项目素材/);
  assert.match(workspace, /通用素材库/);
  assert.match(workspace, /素材文件/);
  assert.match(workspace, /本地文件/);
  assert.match(workspace, /空白剪辑工程/);
});
test('桌面发布包携带对应平台的 FFmpeg sidecar', async () => {
  const [manifest, packageJson, prepare, release, native] = await Promise.all([
    readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/prepare-media-sidecar.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'),
    readFile(new URL('../src-tauri/src/commands/file.rs', import.meta.url), 'utf8'),
  ]);
  assert.match(manifest, /"binaries\/ffmpeg"/);
  assert.match(manifest, /FFmpeg-GPL-3\.0\.txt/);
  assert.match(manifest, /FFmpeg-SOURCE\.txt/);
  assert.match(packageJson, /"ffmpeg-static"/);
  assert.match(packageJson, /"prepare:media"/);
  assert.match(prepare, /ffmpeg-\$\{triple\}/);
  assert.match(prepare, /spawnSync\(source, \['-version'\]/);
  assert.match(release, /npm run prepare:media/);
  assert.match(release, /npm rebuild ffmpeg-static --foreground-scripts/);
  assert.doesNotMatch(native, /media_tool\("ffprobe"\)/);
});
test('独立剪辑工作区接入真实桌面导出', async () => {
  const workspace = await readFile(
    new URL('../renderer/src/app/editor/VideoEditorWorkspace.tsx', import.meta.url),
    'utf8',
  );
  const root = await readFile(
    new URL('../renderer/src/app/ReactWorkbench.tsx', import.meta.url),
    'utf8',
  );
  const runtime = await readFile(
    new URL('../renderer/src/services/openVideoRuntime.js', import.meta.url),
    'utf8',
  );
  const tauri = await readFile(
    new URL('../renderer/src/services/tauriApi.js', import.meta.url),
    'utf8',
  );
  for (const pattern of [
    /splitSelected/,
    /deleteSelected/,
    /dragRef/,
    /undo/,
    /redo/,
    /createOpenVideoRuntime/,
    /playbackStructureSignature/,
    /onSelection/,
    /onTransformEnd/,
    /framePrev/,
    /frameNext/,
    /runCanvasAction/,
    /constrainTransformToCanvas/,
    /clip\.id === selectedId/,
    /activeTextClips/,
    /ov-text-preview-layer/,
    /importAssets/,
    /builtInStickers/,
    /transitions/,
    /effects/,
  ])
    assert.match(workspace, pattern);
  assert.match(root, /desktopApi\.file\.exportVideoProject/);
  assert.match(tauri, /prepared = JSON\.parse\(JSON\.stringify\(project\)\)/);
  assert.doesNotMatch(tauri, /structuredClone\(project\)/);
  assert.match(
    runtime,
    /updateClip\(id, updates\) \{\s*return studio\.updateClip\(id, updates\);\s*\}/,
  );
  assert.doesNotMatch(runtime, /updateClip\(id, updates\) \{\s*core\.clip\.update/);
  assert.match(
    workspace,
    /const normalizedStyle = findEditorClip\(next, selectedId\)\?\.clip\.style;\s*Object\.assign\(runtimeUpdates, normalizedStyle \|\| updates\.style\)/,
  );
  assert.doesNotMatch(workspace, /runtimeUpdates\.style = updates\.style/);
  assert.match(
    workspace,
    /runtimeMutationRef\.current = true;\s*void runtime\.updateClip\(selectedId, runtimeUpdates\)/,
  );
  assert.match(
    workspace,
    /playbackStructureSignature,[\s\S]*?preferFallbackPreview,[\s\S]*?sourceState/,
  );
  assert.match(workspace, /const usesNativeSequencePreview = directPreviewClips\.length > 1/);
  assert.match(workspace, /function continueNativeSequence\(clipId: string\)/);
  assert.match(workspace, /src=\{usesNativeSequencePreview \? nativePreviewUrl : playbackUrl\}/);
  assert.match(workspace, /onEnded=\{\(\) => \{[\s\S]*?continueNativeSequence/);
});
test('剪辑工作区用真实媒体元数据补齐主轨并提供本地文件回退', async () => {
  const workspace = await readFile(
    new URL('../renderer/src/app/editor/VideoEditorWorkspace.tsx', import.meta.url),
    'utf8',
  );
  const styles = await readFile(
    new URL('../renderer/src/app/editor/VideoEditorWorkspace.css', import.meta.url),
    'utf8',
  );
  assert.match(workspace, /hydrateSourceProject/);
  assert.match(workspace, /onLoadedMetadata/);
  assert.match(workspace, /desktopApi\.file\.readArrayBuffer\(activeSourceFile\)/);
  assert.match(workspace, /runtimeBlobUrlsRef/);
  assert.match(workspace, /runtimeMediaUrls\[asset\.id\]/);
  assert.match(workspace, /desktopApi\.file\.readArrayBuffer\(sourceFile\)/);
  assert.match(
    workspace,
    /primaryVideoAssetId = project\.tracks[\s\S]*?clip\.type === "video"\)\?\.assetId/,
  );
  assert.match(workspace, /primaryVideoAsset\?\.sourceUrl \|\| sourceUrl/);
  assert.match(workspace, /window\.setTimeout\(\(\) => void sourceFailed\(\), 3500\)/);
  assert.match(
    workspace,
    /runtimeMediaUrls\[asset\.id\] \|\|[\s\S]*?asset\.id === primaryVideoAssetId \? playbackUrl : asset\.sourceUrl/,
  );
  assert.match(workspace, /const video = fallbackRef\.current/);
  assert.match(styles, /--ov-bg: #f7f7f8/);
  assert.match(styles, /same restrained, light workspace language/);
  assert.match(workspace, /createPortal/);
  assert.match(styles, /position: fixed/);
  assert.match(
    styles,
    /grid-template-columns: 42px minmax\(230px, \.95fr\) minmax\(440px, 2fr\) minmax\(260px, 1fr\)/,
  );
  assert.match(styles, /flex-direction: column/);
  assert.match(styles, /font-family:\s*inherit/);
  assert.match(styles, /\.ov-track\.type-video,\s*\.ov-track\.type-audio \{ height: 55px; \}/);
  assert.match(styles, /grid-template-columns: 112px 1fr/);
  assert.match(styles, /\.ov-ruler \{ height: 22px/);
  assert.match(styles, /\.ov-clip i \{ font-size: 11\.5px/);
  assert.match(workspace, /ov-clip-media/);
  assert.match(styles, /--ov-text:\s*var\(--type-primary\)/);
  assert.match(styles, /--ov-panel:\s*var\(--surface\)/);
  assert.match(styles, /--ov-workspace:\s*var\(--window-shell\)/);
  assert.match(styles, /--ov-accent:\s*var\(--accent\)/);
  assert.match(styles, /\.ov-clip\.has-media/);
});

test('剪辑工作区主动解码首帧并提供可编辑的中文文字预设', async () => {
  const workspace = await readFile(
    new URL('../renderer/src/app/editor/VideoEditorWorkspace.tsx', import.meta.url),
    'utf8',
  );
  const styles = await readFile(
    new URL('../renderer/src/app/editor/VideoEditorWorkspace.css', import.meta.url),
    'utf8',
  );
  assert.match(workspace, /preload="auto"/);
  assert.match(workspace, /function primeSourcePreview/);
  assert.match(workspace, /video\.currentTime = frameTime/);
  assert.match(workspace, /Math\.max\(time, 0\)/);
  assert.doesNotMatch(workspace, /video\.duration \* \.08/);
  assert.match(
    workspace,
    /start=\{Math\.max\(0, Number\(clip\.trimStart\) \|\| 0\)\}/,
  );
  assert.match(workspace, /function VideoFilmstripThumbnail/);
  assert.match(workspace, /const sampleCount = visibleEnd > visibleStart \? lastSlot - firstSlot : 0/);
  assert.match(workspace, /sampleIndex \* sampleWidth/);
  assert.match(styles, /\.ov-clip-frame-loading/);
  assert.match(styles, /\.ov-clip-media \.ov-clip-filmstrip \{ object-fit: fill; \}/);
  assert.match(workspace, /Math\.max\(180, project\.settings\.fps \* 88\)/);
  assert.match(workspace, /Math\.round\(unalignedTarget \* fps\) \/ fps/);
  assert.match(workspace, /viewportLeft=\{Math\.max\(0, timelineViewport\.left - 112\)\}/);
  assert.match(workspace, /112 \+ duration \* zoom \+ 24/);
  assert.match(workspace, /const availableWidth = Math\.max\(1, timelineWidth - 112 - 24\)/);
  assert.match(workspace, /zoomTouchedRef\.current = true/);
  assert.match(workspace, /await runtime\.seek/);
  assert.match(workspace, /const textPresets = \[/);
  assert.match(workspace, /清晰字幕/);
  assert.match(workspace, /银幕标题/);
  assert.match(workspace, /章节标题/);
  assert.match(workspace, />字体<\/span>/);
  assert.match(workspace, />字重<\/span>/);
  assert.match(workspace, />对齐<\/span>/);
  assert.match(styles, /\.ov-text-presets/);
  assert.match(workspace, /background:\s*\{\s*color: "#000000",\s*opacity: 0/);
  assert.match(workspace, /stroke: \{ color: "#000000", width: 0 \}/);
  assert.doesNotMatch(workspace, /strokeWidth:/);
  assert.match(workspace, /\{activeTextClips\.length > 0 && \(/);
  assert.match(styles, /\.ov-text-preview-item \{[^}]*background:\s*transparent !important/);
  assert.match(workspace, /<IconSymbol name="copy" \/>复制/);
  assert.match(styles, /\.ov-inspector \{[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto/);
  assert.match(
    styles,
    /\.ov-inspector-section input,[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*100%/,
  );
  assert.match(styles, /\.ov-edit-buttons button:nth-child\(2\) \{ font-size: 0; \}/);
  assert.match(workspace, /function deleteAsset\(assetId: string\)/);
  assert.match(
    workspace,
    /clips: track\.clips\.filter\(\(clip: any\) => clip\.assetId !== assetId\)/,
  );
  assert.match(workspace, /className="ov-asset-delete"/);
  assert.match(workspace, /if \(found\?\.track\.locked\)/);
  assert.match(workspace, /updateEditorTrack\(source, found\.track\.id, \{ locked: false \}\)/);
  assert.match(workspace, /asset\.id === primaryVideoAssetId && sourceThumbnail/);
  assert.match(workspace, /preload="auto"/);
  assert.match(styles, /\.ov-history \{[^}]*display:\s*flex/);
  assert.match(styles, /\.ov-asset-delete/);
  assert.match(styles, /--ov-ui-font-size:\s*13px/);
  assert.match(
    styles,
    /\.ov-inspector-section label,[\s\S]*?font-size:\s*var\(--ov-ui-font-size\)/,
  );
  assert.match(styles, /\.ov-inspector-section input,[\s\S]*?min-height:\s*32px/);
  assert.match(
    styles,
    /\.ov-inspector-section input,[\s\S]*?\.ov-inspector-section textarea \{\s*font-size:\s*12px/,
  );
  assert.match(styles, /\.ov-ruler span \{[\s\S]*?font-size:\s*11px/);
  assert.match(workspace, /className="ov-inspector-section ov-transform-section"/);
  assert.match(
    styles,
    /\.ov-transform-section input \{[^}]*min-height:\s*28px[^}]*font-size:\s*11px/,
  );
  assert.match(
    styles,
    /\.ov-transform-presets button,[\s\S]*?\.ov-inspector-actions button \{[^}]*font-size:\s*12px/,
  );
  assert.match(
    styles,
    /\.ov-inspector-section \.ov-check input\[type="checkbox"\] \{[^}]*width:\s*14px[^}]*height:\s*14px[^}]*min-height:\s*0/,
  );
  assert.match(workspace, /disabled=\{videoClips\.length < 2\}/);
  assert.match(workspace, /转场需要连接两段视频/);
  assert.match(workspace, /当前画面可直接预览/);
  assert.match(styles, /\.ov-tool-notice/);
  assert.match(workspace, /muted=\{previewAudio\.muted\}/);
  assert.match(workspace, /video\.volume = previewAudio\.volume/);
  assert.match(workspace, /const stickerAssets = useMemo/);
  assert.match(workspace, /const imageStart = duration > 0/);
  assert.match(workspace, /const videoStart = asset\.type === "video"/);
  assert.match(workspace, /timelineStart: videoStart/);
  assert.match(workspace, /已追加到视频轨末尾/);
  assert.match(workspace, /function activateAsset\(asset: VideoEditorAsset\)/);
  assert.match(workspace, /function clipFocusTime\(clip: EditorClip\)/);
  assert.match(workspace, /start \+ 1 \/ projectRef\.current\.settings\.fps/);
  assert.match(workspace, /onClick=\{\(\) => activateAsset\(asset\)\}/);
  assert.doesNotMatch(workspace, /onDoubleClick=\{\(\) => addAsset\(asset\)\}/);
  assert.match(workspace, /已定位到“\$\{asset\.name\}”在时间线中的片段/);
  assert.match(workspace, /runtimeMediaUrls\[clipAsset\?\.id\]/);
  assert.match(workspace, /x: \(canvasWidth - imageWidth\) \/ 2/);
  assert.match(workspace, /已添加到画面中央/);
  assert.match(workspace, /导入图片/);
  assert.match(workspace, /stickerStarUrl/);
  assert.match(workspace, /applyBuiltInStickerSources/);
  assert.doesNotMatch(workspace, /data:image\/svg\+xml/);
  assert.match(workspace, /const activeImageClips = useMemo/);
  assert.match(workspace, /className="ov-image-preview-layer"/);
  assert.match(styles, /\.ov-image-preview-layer \{[^}]*position:\s*absolute;[^}]*z-index:\s*3/);
  assert.match(styles, /\.ov-image-preview-item\.selected/);
  assert.match(workspace, /function beginVisualTransform/);
  assert.match(workspace, /mode: "move" \| "resize" \| "rotate"/);
  assert.match(workspace, /className="ov-transform-rotate-handle"/);
  assert.match(workspace, /className="ov-transform-resize-handle"/);
  assert.match(styles, /\.ov-image-preview-item \{[^}]*cursor:\s*move/);
  assert.match(styles, /\.ov-transform-resize-handle \{[^}]*nwse-resize/);
  assert.match(workspace, /className=\{`ov-text-preview-item/);
  assert.match(workspace, /拖动缩放文字/);
  assert.match(workspace, /gesture\.fontSize \* transform\.width \/ gesture\.transform\.width/);
  assert.match(styles, /\.ov-text-preview-item\.selected/);
});
