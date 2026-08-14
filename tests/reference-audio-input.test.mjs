import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

let server;
let generationUpstreamReadiness;
let buildGenerationPayload;
let resolveAgentInputRole;
let getGenerationInputModes;
let reconcileGenerationInputEdges;

before(async () => {
  server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  ({ generationUpstreamReadiness, buildGenerationPayload } = await server.ssrLoadModule(
    '/src/utils/generationPayload.js',
  ));
  ({ resolveAgentInputRole } = await server.ssrLoadModule('/src/services/agentInputRole.ts'));
  ({ getGenerationInputModes } = await server.ssrLoadModule('/src/domain/catalog/ModelCatalog.ts'));
  ({ reconcileGenerationInputEdges } = await server.ssrLoadModule(
    '/src/domain/graph/GenerationInputContract.ts',
  ));
});

test('音频节点和音频资源连线自动使用 referenceAudio', () => {
  const target = { id: 'target', type: 'videoGeneration' };
  const project = { nodes: [], edges: [] };
  assert.equal(resolveAgentInputRole(project, {
    id: 'generated-audio', type: 'audioGeneration',
  }, target), 'referenceAudio');
  assert.equal(resolveAgentInputRole(project, {
    id: 'audio-resource', type: 'resource', resourceType: 'audio',
  }, target), 'referenceAudio');
});

test('输入模式往返切换保留两个上游节点并恢复参考素材', () => {
  const first = { id: 'first-edge', data: { inputRole: 'referenceImage', inputSlot: 'firstFrame' } };
  const last = { id: 'last-edge', data: { inputRole: 'referenceImage', inputSlot: 'lastFrame' } };
  // Deliberately reverse persistence order: business slots, not array order,
  // determine which source is the first frame.
  const reversed = [last, first];
  const referenceMode = {
    value: 'reference', label: '参考素材', modeId: 'reference', slots: ['reference'],
    maxImages: 9, maxVideos: 0, maxAudios: 0,
  };
  const firstLastMode = {
    value: 'firstLastFrame', label: '首尾帧', modeId: 'first-last',
    slots: ['firstFrame', 'lastFrame'], maxImages: 2, maxVideos: 0, maxAudios: 0,
  };

  const references = reconcileGenerationInputEdges(reversed, referenceMode);
  assert.deepEqual(references.map((edge) => edge.id), ['first-edge', 'last-edge']);
  assert.deepEqual(references.map((edge) => edge.data.inputSlot), ['reference', 'reference']);

  const restored = reconcileGenerationInputEdges(references, firstLastMode);
  assert.deepEqual(restored.map((edge) => [edge.id, edge.data.inputSlot]), [
    ['first-edge', 'firstFrame'],
    ['last-edge', 'lastFrame'],
  ]);
});

test('切换到单首帧模式优先使用显式首帧并暂存第二个上游节点', () => {
  const edges = [
    { id: 'last-edge', data: { inputRole: 'referenceImage', inputSlot: 'lastFrame' } },
    { id: 'first-edge', data: { inputRole: 'referenceImage', inputSlot: 'firstFrame' } },
  ];
  const mode = {
    value: 'firstFrame', label: '首帧', modeId: 'first', slots: ['firstFrame'],
    maxImages: 1, maxVideos: 0, maxAudios: 0,
  };
  const reconciled = reconcileGenerationInputEdges(edges, mode);
  assert.deepEqual(reconciled.map((edge) => [edge.id, edge.data.inputSlot, edge.data.skipTaskInput === true]), [
    ['first-edge', 'firstFrame', false],
    ['last-edge', 'lastFrame', true],
  ]);

  const referenceMode = {
    value: 'reference', label: '参考素材', modeId: 'reference', slots: ['reference'],
    maxImages: 9, maxVideos: 0, maxAudios: 0,
  };
  const restored = reconcileGenerationInputEdges(reconciled, referenceMode);
  assert.deepEqual(restored.map((edge) => [edge.id, edge.data.inputSlot, edge.data.skipTaskInput === true]), [
    ['first-edge', 'reference', false],
    ['last-edge', 'reference', false],
  ]);
});

after(async () => {
  await server?.close();
});

function seedanceProject({ includeImage = true, audio = {} } = {}) {
  const image = {
    id: 'image', type: 'resource', title: '人物参考', status: 'completed',
    resourceType: 'image', mimeType: 'image/png', fileName: 'person.png',
    url: 'https://example.com/person.png',
  };
  const voice = {
    id: 'voice', type: 'resource', title: '音色参考', status: 'completed',
    resourceType: 'audio', mimeType: 'audio/wav', fileName: 'voice.wav',
    url: 'https://example.com/voice.wav', duration: 8, size: 1024,
    ...audio,
  };
  const target = {
    id: 'target', type: 'videoGeneration', title: 'Seedance 镜头',
    model: 'doubao-seedance-2-0-260128', inputMode: 'reference', prompt: '人物按参考音色说出台词', config: {},
  };
  return {
    target,
    project: {
      nodes: [...(includeImage ? [image] : []), voice, target],
      edges: [
        ...(includeImage ? [{ id: 'image-edge', source: image.id, target: target.id, data: { inputRole: 'referenceImage', inputSlot: 'reference' } }] : []),
        { id: 'audio-edge', source: voice.id, target: target.id, data: { inputRole: 'referenceAudio', inputSlot: 'referenceAudio' } },
      ],
      tasks: [], materials: [],
    },
  };
}

test('Seedance 2.0 收集图片与参考音频并选择全模态模式', () => {
  const { target, project } = seedanceProject();
  const readiness = generationUpstreamReadiness(target, project);
  assert.deepEqual(readiness.issues, []);

  const payload = buildGenerationPayload(target, project);
  assert.equal(payload.modelContract.modeId, 'omni-reference-to-video');
  assert.equal(payload.modelInputs.images[0].url, 'https://example.com/person.png');
  assert.equal(payload.modelInputs.audios[0].url, 'https://example.com/voice.wav');
  assert.equal(payload.modelInputs.audios[0].inputRole, 'referenceAudio');
  assert.equal(payload.modelInputs.audios[0].inputSlot, 'referenceAudio');
});

test('Seedance 2.0 拒绝没有图片或视频搭配的单独参考音频', () => {
  const { target, project } = seedanceProject({ includeImage: false });
  const readiness = generationUpstreamReadiness(target, project);
  assert.equal(readiness.ready, false);
  assert.match(readiness.issues.join('；'), /必须同时搭配至少一张图片或至少一个视频/);
});

test('Seedance 2.0 按目录约束校验参考音频格式与时长', () => {
  const { target, project } = seedanceProject({
    audio: { fileName: 'voice.flac', mimeType: 'audio/flac', duration: 18 },
  });
  const readiness = generationUpstreamReadiness(target, project);
  assert.equal(readiness.ready, false);
  assert.match(readiness.issues.join('；'), /flac 格式不受当前模型支持/);
  assert.match(readiness.issues.join('；'), /时长不能超过 15 秒/);
});

test('首帧模式通过显式槽位选择供应商 mode 并保留输入顺序', () => {
  const image = {
    id: 'frame', type: 'resource', title: '首帧', status: 'completed',
    resourceType: 'image', mimeType: 'image/png', fileName: 'first.png',
    url: 'https://example.com/first.png',
  };
  const target = {
    id: 'video', type: 'videoGeneration', title: 'H3 镜头', model: 'MiniMax-H3',
    inputMode: 'firstFrame', prompt: '镜头向前推进', config: {},
  };
  const project = {
    nodes: [image, target],
    edges: [{
      id: 'first-frame-edge', source: image.id, target: target.id,
      data: { inputRole: 'referenceImage', inputSlot: 'firstFrame' },
    }],
    tasks: [], materials: [],
  };
  assert.deepEqual(generationUpstreamReadiness(target, project).issues, []);
  const payload = buildGenerationPayload(target, project);
  assert.equal(payload.modelContract.modeId, 'first-frame-to-video');
  assert.equal(payload.modelInputs.images[0].inputSlot, 'firstFrame');

  project.edges[0].data.inputSlot = 'reference';
  assert.match(generationUpstreamReadiness(target, project).issues.join('\n'), /槽位 reference 不属于\s*首帧\s*模式/);
});

test('Seedance 向画布和 Agent 同时公开参考素材与首尾帧模式', () => {
  const modes = getGenerationInputModes('doubao-seedance-2-0-260128');
  assert.deepEqual(modes.map((mode) => mode.value), ['reference', 'firstLastFrame']);

  const first = { id: 'first', type: 'resource', title: '首帧', status: 'completed', resourceType: 'image', url: 'https://example.com/first.png' };
  const last = { id: 'last', type: 'resource', title: '尾帧', status: 'completed', resourceType: 'image', url: 'https://example.com/last.png' };
  const target = { id: 'target', type: 'videoGeneration', title: '首尾帧视频', model: 'doubao-seedance-2-0-260128', inputMode: 'firstLastFrame', prompt: '昼夜过渡', config: {} };
  const project = {
    nodes: [first, last, target],
    edges: [
      { id: 'first-edge', source: first.id, target: target.id, data: { inputRole: 'referenceImage', inputSlot: 'firstFrame' } },
      { id: 'last-edge', source: last.id, target: target.id, data: { inputRole: 'referenceImage', inputSlot: 'lastFrame' } },
    ],
    tasks: [], materials: [],
  };
  assert.deepEqual(generationUpstreamReadiness(target, project).issues, []);
  const payload = buildGenerationPayload(target, project);
  assert.equal(payload.modelContract.inputMode, 'firstLastFrame');
  assert.equal(payload.modelContract.requestFields.firstFrameImageContentRole, 'first_frame');
  assert.equal(payload.modelContract.requestFields.lastFrameImageContentRole, 'last_frame');
  assert.deepEqual(payload.modelInputs.images.map((image) => image.inputSlot), ['firstFrame', 'lastFrame']);
});
