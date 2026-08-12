import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

let server;
let generationUpstreamReadiness;
let buildGenerationPayload;
let resolveAgentInputRole;

before(async () => {
  server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  ({ generationUpstreamReadiness, buildGenerationPayload } = await server.ssrLoadModule(
    '/src/utils/generationPayload.js',
  ));
  ({ resolveAgentInputRole } = await server.ssrLoadModule('/src/services/agentInputRole.ts'));
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
    model: 'doubao-seedance-2-0-260128', prompt: '人物按参考音色说出台词', config: {},
  };
  return {
    target,
    project: {
      nodes: [...(includeImage ? [image] : []), voice, target],
      edges: [
        ...(includeImage ? [{ id: 'image-edge', source: image.id, target: target.id, data: { inputRole: 'referenceImage' } }] : []),
        { id: 'audio-edge', source: voice.id, target: target.id, data: {} },
      ],
      tasks: [], materials: [],
    },
  };
}

test('Seedance 2.0 收集图片与参考音频并选择全模态模式', () => {
  const { target, project } = seedanceProject();
  const readiness = generationUpstreamReadiness(target, project);
  assert.deepEqual(readiness.issues, []);
  assert.equal(target.config.mode, 'omni-reference-to-video');

  const payload = buildGenerationPayload(target, project);
  assert.equal(payload.modelContract.modeId, 'omni-reference-to-video');
  assert.equal(payload.modelInputs.images[0].url, 'https://example.com/person.png');
  assert.equal(payload.modelInputs.audios[0].url, 'https://example.com/voice.wav');
  assert.equal(payload.modelInputs.audios[0].inputRole, 'referenceAudio');
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
