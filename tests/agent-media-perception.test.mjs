import * as productFacts from './helpers/productFacts.mjs';
/**
 * Agent 的"看得见"能力：图片节点的真实像素，和项目素材库的真实条目。
 * 两者都是纯读工具，但可见范围、回执真实性和"读不改项目"是必须守住的边界，
 * 所以这里跑真实注册表与真实工具实现，而不是比对源码文本。
 */
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env;
let projectStore;
let normalization;
let identity;
let toolRegistry;
let desktopApi;
let runFacts;

before(async () => {
  env = await createRendererEnv({ storage: new Map(), withWindow: true });
  projectStore = await env.load('store/projectStore');
  normalization = await env.load('store/projectNormalization');
  identity = await env.load('services/agentProjectIdentity');
  toolRegistry = await env.load('agent/core/toolRegistry');
  runFacts = await Promise.resolve(productFacts);
  desktopApi = (await env.load('services/desktopApi')).desktopApi;
  (await env.load('agent/tools/canvasTools')).registerCanvasTools();
  (await env.load('agent/tools/catalogTools')).registerCatalogTools();
});

after(async () => {
  await env?.dispose();
});

function resetProject() {
  const project = normalization.createProject('可见能力测试项目');
  projectStore.store.project = project;
  projectStore.store.projectDir = '/proj';
  return project;
}

function contextFor(agentId) {
  const current = identity.getAgentProjectIdentity();
  return {
    requestId: 'req-1', turnId: 'turn-1', conversationId: 'conv-1', agentId,
    projectKey: current.projectKey,
    projectInstanceId: current.instanceId,
    projectGeneration: current.generation,
    signal: new AbortController().signal,
    loadedSkillIds: new Set(),
    attachments: [],
    capabilities: { nodeExecution: true },
    run: runFacts.createAgentRunFacts(),
    state: runFacts.createAgentSessionState(),
    emit: () => {},
  };
}

async function call(agentId, toolId, args) {
  const context = contextFor(agentId);
  const prepared = toolRegistry.prepareAgentToolCall(toolId, JSON.stringify(args), context);
  return { result: await prepared.definition.execute(prepared.input, context), prepared };
}

test('画布和剪辑 Agent 可以读取画布媒体与素材库，文本 Agent 保持隔离', () => {
  resetProject();
  for (const agentId of ['canvas-primary', 'editor-primary']) {
    const visible = toolRegistry.listAgentTools(contextFor(agentId)).map((tool) => tool.id);
    assert.ok(visible.includes('canvas_media_image'), `${agentId} 应能读取图片节点画面`);
    assert.ok(visible.includes('inspect_assets'), `${agentId} 应能读取素材库`);
  }
  for (const agentId of ['text-primary']) {
    const visible = toolRegistry.listAgentTools(contextFor(agentId)).map((tool) => tool.id);
    assert.ok(!visible.includes('canvas_media_image'), `${agentId} 不应看见画布图片工具`);
    assert.ok(!visible.includes('inspect_assets'), `${agentId} 不应看见画布素材库`);
  }
});

test('canvas_media_image 把节点真实图片作为图片附件交给模型，并且不改动项目', async () => {
  const project = resetProject();
  project.nodes = [{
    id: 'node-img', type: 'imageGeneration', title: '雨夜街角',
    generatedOutputs: [{ id: 'm-1', filePath: '/proj/assets/night.png', resourceType: 'image', fileName: 'night.png', selected: true }],
  }];
  project.materials = [{ id: 'm-1', nodeId: 'node-img', filePath: '/proj/assets/night.png', resourceType: 'image' }];
  const before = JSON.stringify(project);
  const reads = [];
  const previous = desktopApi.file.readImagePreview;
  desktopApi.file.readImagePreview = async (path, maxSize) => {
    reads.push({ path, maxSize });
    return new Uint8Array([1, 2, 3, 250]).buffer;
  };
  try {
    const { result } = await call('canvas-primary', 'canvas_media_image', { nodeIds: ['node-img'] });
    assert.equal(result.success, true, JSON.stringify(result.images));
    assert.deepEqual(reads, [{ path: '/proj/assets/night.png', maxSize: 1280 }], '必须读节点真实输出文件本身');
    assert.equal(result.__toolAttachments.length, 1);
    assert.match(result.__toolAttachments[0].url, /^data:image\/jpeg;base64,/);
    assert.equal(result.images[0].path, '/proj/assets/night.png');
    assert.equal(JSON.stringify(project), before, '只读工具不得改动项目');
  } finally {
    desktopApi.file.readImagePreview = previous;
  }
});

test('canvas_media_image 对非图片、无文件和已消失节点分别返回可恢复回执，且不触碰文件读取', async () => {
  const project = resetProject();
  project.nodes = [
    { id: 'node-vid', type: 'videoGeneration', title: '片头', generatedOutputs: [{ id: 'm-2', filePath: '/proj/assets/intro.mp4', resourceType: 'video', selected: true }] },
    { id: 'node-empty', type: 'imageGeneration', title: '还没出图', generatedOutputs: [] },
  ];
  project.materials = [];
  let touched = 0;
  const previous = desktopApi.file.readImagePreview;
  desktopApi.file.readImagePreview = async () => { touched += 1; return new Uint8Array([1]).buffer; };
  try {
    const { result } = await call('canvas-primary', 'canvas_media_image', {
      nodeIds: ['node-vid', 'node-empty', 'node-gone'],
    });
    assert.equal(result.success, false, '一个都没读到就不能声称成功');
    assert.equal(touched, 0, '判定不是图片时不得去读文件');
    assert.deepEqual(result.images.map((item) => item.nodeId), ['node-vid', 'node-empty', 'node-gone']);
    assert.match(result.images[0].error, /不是图片素材/);
    assert.match(result.images[1].error, /没有可读取的本地图片文件/);
    assert.match(result.images[2].error, /不存在/);
  } finally {
    desktopApi.file.readImagePreview = previous;
  }
});

test('canvas_media_frame 可从本地文件路径逐张读取，并保留原有节点方式', async () => {
  const project = resetProject();
  project.nodes = [{ id: 'video-1', type: 'videoGeneration', title: '镜头', generatedOutputs: [
    { filePath: '/proj/assets/shot.mp4', resourceType: 'video', selected: true },
  ] }];
  const captures = [];
  const previousCapture = desktopApi.file.captureVideoFrameToProject;
  const previousRead = desktopApi.file.readImagePreview;
  desktopApi.file.captureVideoFrameToProject = async (source, seconds) => {
    captures.push({ source, seconds });
    return { filePath: `/proj/assets/frame-${seconds}.jpg` };
  };
  desktopApi.file.readImagePreview = async () => new Uint8Array([255, 216, 255, 217]).buffer;
  try {
    const fromFile = await call('director-primary', 'canvas_media_frame', {
      filePath: '/tmp/uploaded.mp4', timesSec: [0, 2.5], outputMode: 'frames',
    });
    assert.equal(fromFile.result.success, true);
    assert.equal(fromFile.result.__toolAttachments.length, 2);
    assert.deepEqual(captures, [{ source: '/tmp/uploaded.mp4', seconds: 0 }, { source: '/tmp/uploaded.mp4', seconds: 2.5 }]);
    const fromNode = await call('director-primary', 'canvas_media_frame', { nodeId: 'video-1', timesSec: [1] });
    assert.equal(fromNode.result.success, true);
    assert.equal(captures.at(-1).source, '/proj/assets/shot.mp4');
    const ambiguous = await call('director-primary', 'canvas_media_frame', { nodeId: 'video-1', filePath: '/tmp/uploaded.mp4', timesSec: [0] });
    assert.equal(ambiguous.result.success, false);
    assert.equal(captures.length, 3);
  } finally {
    desktopApi.file.captureVideoFrameToProject = previousCapture;
    desktopApi.file.readImagePreview = previousRead;
  }
});

test('canvas_media_frame 拼图模式只返回一张带逐帧秒数的图', async () => {
  resetProject();
  const previousCapture = desktopApi.file.captureVideoFrameToProject;
  const previousRead = desktopApi.file.readImagePreview;
  const previousSave = desktopApi.file.saveDataUrlToProject;
  const previousImage = globalThis.Image;
  const previousDocument = globalThis.document;
  const labels = [];
  const timesSec = Array.from({ length: 24 }, (_, index) => index);
  const contactSheet = {
    getContext: () => ({ fillRect() {}, drawImage() {}, measureText(value) { return { width: value.length * 7 }; }, fillText(value) { labels.push(value); } }),
    toDataURL: () => 'data:image/jpeg;base64,/9j/',
  };
  desktopApi.file.captureVideoFrameToProject = async (_source, seconds) => ({ filePath: `/proj/assets/frame-${seconds}.jpg` });
  desktopApi.file.readImagePreview = async () => new Uint8Array([255, 216, 255, 217]).buffer;
  desktopApi.file.saveDataUrlToProject = async () => ({ filePath: '/proj/assets/contact-sheet.jpg' });
  globalThis.Image = class {
    naturalWidth = 640;
    naturalHeight = 360;
    set src(_value) { queueMicrotask(() => this.onload?.()); }
  };
  globalThis.document = { createElement: () => contactSheet };
  try {
    const { result, prepared } = await call('director-primary', 'canvas_media_frame', {
      filePath: '/tmp/uploaded.mp4', timesSec, outputMode: 'contact_sheet',
    });
    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal(result.__toolAttachments.length, 1);
    assert.deepEqual(labels, timesSec.map(seconds => `${seconds}s`));
    assert.equal(result.frames.length, 24);
    assert.equal(contactSheet.width, 1324);
    assert.equal(contactSheet.height, 508);
    assert.equal(result.contactSheetPath, '/proj/assets/contact-sheet.jpg');
    assert.deepEqual(prepared.definition.summarizeResult(result).previews, [{ path: '/proj/assets/contact-sheet.jpg', label: '24 frames' }]);
  } finally {
    desktopApi.file.captureVideoFrameToProject = previousCapture;
    desktopApi.file.readImagePreview = previousRead;
    desktopApi.file.saveDataUrlToProject = previousSave;
    if (previousImage === undefined) delete globalThis.Image; else globalThis.Image = previousImage;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});

test('inspect_assets 返回素材库真实条目与可引用标识，库外文件如实标出', async () => {
  const project = resetProject();
  project.materials = [
    { id: 'm-hero', name: '林澈-常服.png', path: '/proj/assets/hero.png', resourceType: 'image', size: 10 },
    { id: 'm-voice', name: 'theme.wav', path: '/tmp/theme.wav', resourceType: 'audio' },
  ];
  project.assets = [
    { id: 'a-hero', materialId: 'm-hero', name: '林澈·常服', category: 'characters', resourceType: 'image', nodeType: 'imageGeneration', note: '黑色风衣，左脸有疤', tags: ['主角'] },
    { id: 'a-voice', materialId: 'm-voice', name: '主题音乐', category: 'styles', resourceType: 'audio' },
    { id: 'a-phantom', name: '没有绑定文件的设定', category: 'scenes', resourceType: 'image' },
  ];
  const before = JSON.stringify(project);
  const { result } = await call('canvas-primary', 'inspect_assets', {});
  assert.equal(JSON.stringify(project), before, '只读工具不得改动项目');
  assert.equal(result.libraryTotal, 2, '没有绑定真实文件的条目不算可用素材');
  assert.ok(!result.assets.some((item) => item.assetId === 'a-phantom'));
  const hero = result.assets.find((item) => item.assetId === 'a-hero');
  assert.equal(hero.materialId, 'm-hero', '必须给出 place_asset_on_canvas 可用的标识');
  assert.equal(hero.name, '林澈·常服');
  assert.equal(hero.path, '/proj/assets/hero.png');
  assert.equal(hero.inProjectAssets, true);
  assert.equal(hero.hasLocalFile, true);
  assert.equal(hero.categoryLabel, '角色');
  assert.deepEqual(hero.tags, ['主角']);
  assert.equal(result.assets.find((item) => item.assetId === 'a-voice').inProjectAssets, false, '库外文件必须如实标出');
});

test('inspect_assets 的分类、类型与关键词过滤取自素材库真实字段', async () => {
  const project = resetProject();
  project.materials = [
    { id: 'm-hero', name: 'hero.png', path: '/proj/assets/hero.png', resourceType: 'image' },
    { id: 'm-scene', name: 'street.jpg', path: '/proj/assets/street.jpg', resourceType: 'image' },
    { id: 'm-theme', name: 'theme.wav', path: '/proj/assets/theme.wav', resourceType: 'audio' },
  ];
  project.assets = [
    { id: 'a-hero', materialId: 'm-hero', name: '林澈·常服', category: 'characters', resourceType: 'image' },
    { id: 'a-scene', materialId: 'm-scene', name: '雨夜街角', category: 'scenes', resourceType: 'image' },
    { id: 'a-theme', materialId: 'm-theme', name: '主题音乐', category: 'styles', resourceType: 'audio' },
  ];
  const characters = await call('canvas-primary', 'inspect_assets', { category: 'characters' });
  assert.deepEqual(characters.result.assets.map((item) => item.assetId), ['a-hero']);
  // actors 是角色设定的既有别名，界面与工具共用同一份分类表。
  const alias = await call('canvas-primary', 'inspect_assets', { category: 'actors' });
  assert.deepEqual(alias.result.assets.map((item) => item.assetId), ['a-hero']);
  const audio = await call('canvas-primary', 'inspect_assets', { resourceType: 'audio' });
  assert.deepEqual(audio.result.assets.map((item) => item.assetId), ['a-theme']);
  const keyword = await call('canvas-primary', 'inspect_assets', { keyword: '街角' });
  assert.deepEqual(keyword.result.assets.map((item) => item.assetId), ['a-scene']);
  assert.equal(keyword.result.libraryTotal, 3, '过滤条件不得伪装成库的规模');
});
