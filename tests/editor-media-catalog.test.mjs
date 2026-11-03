import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';
import { readSource } from './helpers/sourceContract.mjs';

/**
 * 剪辑台「添加媒体」的候选契约：画布加入剪辑、宿主资源选择器和 Agent 的
 * video_project_media 必须共用 services/editorMediaCatalog 这一份枚举与同一套稳定 key。
 * key 一旦两侧算法不同，选择器的「已添加」就会漏判已经播种进工程的素材并重复导入。
 */
let env;
let store;
let touchProject;
let desktopApi;
let catalog;

before(async () => {
  env = await createRendererEnv({ withWindow: true, realTimers: false });
  ({ store, touchProject } = await env.load('store/projectStore'));
  ({ desktopApi } = await env.load('services/desktopApi'));
  catalog = await env.load('services/editorMediaCatalog');
});

after(async () => {
  await env.dispose();
});

beforeEach(() => {
  store.project = {
    id: 'project-1',
    nodes: [
      {
        id: 'cat',
        type: 'videoGeneration',
        title: '绿幕猫',
        x: 0,
        y: 0,
        canvasWidth: 350,
        canvasHeight: 280,
        resourceType: 'video',
        generatedOutputs: [
          {
            id: 'out-1',
            name: 'comfy_cat.mp4',
            filePath: '/project/assets/comfy_cat.mp4',
            resourceType: 'video',
            duration: 3.5,
          },
        ],
      },
    ],
    edges: [],
    materials: [],
    assets: [],
    tasks: [],
  };
  store.projectDir = '/project';
  touchProject();
  desktopApi.file.probeMedia = async () => ({ duration: 3.5, width: 1280, height: 720 });
});


test('同一个文件既是节点产物又是项目素材时只出一个候选', () => {
  store.project.materials = [
    {
      id: 'm-1',
      nodeId: 'cat',
      name: 'comfy_cat.mp4',
      filePath: '/project/assets/comfy_cat.mp4',
      resourceType: 'video',
    },
  ];
  touchProject();

  const keys = catalog.listEditorMediaCandidates().map((item) => item.key);
  assert.equal(new Set(keys).size, keys.length, '候选不能出现重复项');
  assert.equal(keys.length, 1, `只留一条来源，实际是 ${keys.join(', ')}`);
});


test('本地上传的素材按真实文件路径认已添加', () => {
  const candidate = catalog.editorCanvasCandidate('cat');
  const project = {
    assets: [{ id: 'local:/project/assets/comfy_cat.mp4', sourceFile: '/project/assets/comfy_cat.mp4' }],
    tracks: [],
  };
  assert.equal(catalog.editorMediaUsage(project).has(candidate), true);
  assert.equal(catalog.editorMediaUsage(null).has(candidate), false);
});

test('片段引用着的资产 id 是回滚判定的依据', () => {
  const usage = catalog.editorMediaUsage({
    assets: [{ id: 'canvas:cat:out-1' }],
    tracks: [{ id: 't1', clips: [{ id: 'c1', assetId: 'canvas:cat:out-1' }] }],
  });
  assert.equal(usage.assetIds().has('canvas:cat:out-1'), true);
  assert.equal(usage.referencedByClips().has('canvas:cat:out-1'), true);
});

/**
 * 断线回滚是删除动作，四个条件各自挡掉一类误删：
 * 没被同步导入过（用户手动加的）、时间线还在引用、已经不在工程里、仍然连着线。
 */

test('标签来自素材库条目，不写死参考实现的标签名', () => {
  store.project.materials = [
    { id: 'm-9', name: '大殿.mp4', filePath: '/project/assets/hall.mp4', resourceType: 'video' },
  ];
  store.project.assets = [
    { id: 'a-9', materialId: 'm-9', category: '场景', tags: ['最终版'] },
  ];
  touchProject();

  const [material] = catalog.listEditorMediaCandidates().filter((item) => item.origin === 'material');
  assert.deepEqual(material.tags, ['最终版', '场景']);
});

test('没有任何可播放地址的来源不会成为候选', () => {
  store.project.nodes.push({
    id: 'broken',
    type: 'videoGeneration',
    title: '还没产物',
    generatedOutputs: [{ id: 'out-x', name: 'x.mp4' }],
  });
  touchProject();
  assert.equal(catalog.editorCanvasCandidate('broken'), null);
  assert.equal(
    catalog.listEditorMediaCandidates().some((item) => item.nodeId === 'broken'),
    false,
  );
});

test('按 key 取不回当前仍然存在的候选就是不可导入', () => {
  assert.equal(catalog.findEditorMediaCandidate('canvas:cat:gone'), null);
  assert.equal(catalog.findEditorMediaCandidate(''), null);
});

/**
 * 摘要里的资产一旦只剩 id、来源是空串，重放快照时就必须按 key 回查真实文件：
 * 猜出来的空路径会让下次导入读不到字节，整个剪辑工程都打不开。
 * 回查只认候选目录与 project.materials 这两份真实数据，查不到就返回 null。
 */
test('无来源的资产 id 按目录回查真实文件，查不到不猜', () => {
  assert.deepEqual(catalog.findEditorMediaSource('canvas:cat:out-1'), {
    sourceFile: '/project/assets/comfy_cat.mp4',
    sourceUrl: catalog.editorCanvasCandidate('cat').previewUrl,
  });

  // 节点重新生成后旧产物不再是当前候选，但文件仍登记在素材库里。
  store.project.nodes = [];
  store.project.materials = [
    { id: 'm-1', nodeId: 'cat', name: 'comfy_cat.mp4', path: '/project/assets/comfy_cat.mp4', remoteUrl: 'https://cdn/m-1.mp4' },
  ];
  touchProject();
  assert.equal(catalog.findEditorMediaCandidate('canvas:cat:material:m-1'), null, '旧产物已经不在当前目录里');
  assert.equal(catalog.findEditorMediaSource('canvas:cat:material:m-1').sourceFile, '/project/assets/comfy_cat.mp4');
  assert.equal(catalog.findEditorMediaSource('material:m-1').sourceFile, '/project/assets/comfy_cat.mp4');

  store.project.materials = [];
  touchProject();
  assert.equal(catalog.findEditorMediaSource('canvas:cat:material:m-1'), null, '素材库里没有这条就不编一个路径出来');
  assert.equal(catalog.findEditorMediaSource(''), null);
});

test('重放快照时按 key 补回来源，不再写死空串', async () => {
  const bridge = await env.load('app/editor/openReel/projectBridge');
  const state = {
    canUndo: false,
    canRedo: false,
    duration: 0,
    playhead: 0,
    selectedClipIds: [],
    native: {
      settings: { width: 1920, height: 1080, frameRate: 30 },
      mediaLibrary: {
        items: [
          {
            id: 'media-1',
            name: 'comfy_cat.mp4',
            type: 'video',
            shotloomAssetId: 'canvas:cat:out-1',
            metadata: { duration: 3.5, width: 1280, height: 720 },
          },
        ],
      },
      timeline: { tracks: [] },
    },
  };
  // base 里没有这条资产：正是「快照先落盘、导入没记下来源」那一幕。
  const base = { schema: 'shotloom.video-edit', version: 2, name: 'x', settings: { width: 1920, height: 1080, fps: 30, backgroundColor: '#000' }, assets: [], tracks: [] };
  const [asset] = bridge.summaryFromNative(state, base).assets;
  assert.equal(asset.id, 'canvas:cat:out-1');
  assert.equal(asset.sourceFile, '/project/assets/comfy_cat.mp4', '必须从目录恢复真实路径');
});

/**
 * 摘要写入是这条损坏链的源头：同 id 已经有一条坏记录时，原来那份实现直接丢弃这次真实
 * 导入的路径，空来源就永久留在工程里。
 */
test('原生变换使用像素偏移和角度，摘要往返保持居中与旋转', async () => {
  const bridge = await env.load('app/editor/openReel/projectBridge');
  const base = { schema: 'shotloom.video-edit', version: 2, name: 'x', settings: { width: 640, height: 360, fps: 30 }, assets: [], tracks: [] };
  const state = {
    duration: 4, playhead: 0, selectedClipIds: [], canUndo: false, canRedo: false,
    native: {
      settings: { width: 640, height: 360, frameRate: 30 },
      mediaLibrary: { items: [{ id: 'm', type: 'image', name: 'cat.png', shotloomAssetId: 'a', metadata: {} }] },
      timeline: { tracks: [{ id: 't', type: 'image', clips: [{ id: 'c', mediaId: 'm', startTime: 0, duration: 4, transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 30 } }] }] },
    },
  };
  const summary = bridge.summaryFromNative(state, base);
  const clip = summary.tracks.flatMap(track => track.clips)[0];
  assert.deepEqual([clip.transform.x, clip.transform.y, clip.transform.angle], [0, 0, 30]);
  const { payload } = await bridge.buildLoadPayload(summary);
  assert.equal(payload.tracks[0].type, 'image', '图片轨道必须实际送进原生编辑器');
  assert.equal(payload.tracks[0].clips[0].duration, 4);
  assert.deepEqual(payload.tracks[0].clips[0].transform, { x: 0, y: 0, width: 640, height: 360, opacity: 1, angle: 30, fit: 'fit' });
});

test('同 id 的无来源记录会被这次真实导入的路径补回来', async () => {
  const bridge = await env.load('app/editor/openReel/projectBridge');
  const broken = {
    schema: 'shotloom.video-edit',
    version: 2,
    name: 'x',
    settings: { width: 1920, height: 1080, fps: 30, backgroundColor: '#000' },
    assets: [{ id: 'canvas:cat:out-1', type: 'video', name: 'comfy_cat.mp4', sourceFile: '', sourceUrl: '' }],
    tracks: [],
  };
  const fresh = { id: 'canvas:cat:out-1', type: 'video', name: 'comfy_cat.mp4', sourceFile: '/project/assets/comfy_cat.mp4', sourceUrl: 'asset://comfy' };

  const repaired = bridge.withSummaryAssets(broken, [fresh]);
  assert.equal(repaired.assets[0].sourceFile, '/project/assets/comfy_cat.mp4');
  assert.equal(repaired.assets[0].name, 'comfy_cat.mp4', '只补来源，摘要里已有的字段不重写');

  const unchanged = bridge.withSummaryAssets(repaired, [{ ...fresh, sourceFile: '/other/place.mp4' }]);
  assert.equal(unchanged, repaired, '已有来源时保持同一引用，不做无意义的改写');

  const appended = bridge.withSummaryAssets(broken, [{ ...fresh, id: 'material:m-2' }]);
  assert.equal(appended.assets.length, 2, '新 id 仍然追加');
});

test('单条素材读不到只回 warning，不再抛掉整批导入', async () => {
  const bridge = await env.load('app/editor/openReel/projectBridge');
  const asset = (id) => ({ id, type: 'video', name: `${id}.mp4`, sourceFile: `/project/assets/${id}.mp4`, sourceUrl: '', duration: 3, width: 1280, height: 720 });
  const project = (ids, clipAsset) => ({
    schema: 'shotloom.video-edit',
    version: 2,
    name: 'x',
    settings: { width: 1920, height: 1080, fps: 30, backgroundColor: '#000' },
    assets: ids.map(asset),
    tracks: clipAsset
      ? [{ id: 't1', type: 'video', name: '主画面', locked: false, hidden: false, muted: false, clips: [{ id: 'c1', type: 'video', assetId: clipAsset, timelineStart: 0, trimStart: 0, trimEnd: 3, duration: 3 }] }]
      : [],
  });
  const native = (keys) => ({
    settings: {},
    mediaLibrary: { items: keys.map((key, index) => ({ id: `m${index}`, type: 'video', shotloomAssetId: key })) },
    timeline: { tracks: [] },
  });

  // 模拟磁盘上读不到任何文件。
  const realRead = desktopApi.file.readArrayBuffer;
  desktopApi.file.readArrayBuffer = async () => {
    throw new Error('文件不存在');
  };
  try {
    const mediaOnly = await bridge.buildLoadPayload(project(['used', 'library-only'], null), [], native(['used', 'library-only']));
    assert.deepEqual(mediaOnly.payload.assets.map((item) => item.key), [], '读不到的资产不进载荷');
    assert.equal(mediaOnly.warnings.length, 2, '每条被跳过的资产都要如实告诉用户');
    assert.match(mediaOnly.warnings.join(''), /library-only/);

    // 片段引用的素材同样只标占位：导入失败会让 loaded 永远不成立，节点就此砖化，
    // 用户在剪辑台里连删除或替换这个缺失片段的机会都没有。
    const referenced = await bridge.buildLoadPayload(project(['used'], 'used'), [], native(['used']));
    assert.deepEqual(referenced.payload.tracks[0].clips.map((clip) => clip.mediaKey), ['used'], '片段本身必须保留');
    assert.equal(referenced.warnings.length, 1);
  } finally {
    desktopApi.file.readArrayBuffer = realRead;
  }
});

test('宿主选择器与 Agent 共用同一份目录，添加媒体不再默认弹原生文件框', () => {
  const tool = readSource('renderer/src/agent/tools/videoEditorTools.ts');
  const bridge = readSource('renderer/src/app/editor/openReel/useOpenReelBridge.ts');
  const workspace = readSource('renderer/src/app/editor/VideoEditorWorkspace.tsx');

  assert.match(tool, /from '@\/services\/editorMediaCatalog\.ts'/, 'Agent 读的是共享目录');
  assert.doesNotMatch(tool, /generatedOutputs/, 'Agent 不得再自己枚举节点产物');
  assert.match(bridge, /requestImport: async \(\) => \{ callbacksRef\.current\.openMediaPicker\(\)/);
  assert.doesNotMatch(bridge, /controller\.importAssets\??\.\(/, '默认路径不再直接开原生文件框');
  assert.match(workspace, /<AssetPickerDialog/, '添加媒体由宿主资源选择器承接');
});
