import assert from 'node:assert/strict';
import test from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

// StarRouter MCP: get_public_docs(page=dashscope.post-v1-videos), 2026-11-03.
// Limits: https://help.aliyun.com/zh/model-studio/wan3-video-generation-api-reference
for (const [provider, id] of [
  ['starrouter', 'starrouter-wan3.0-video-prime'],
  ['qwen', 'wan3.0-video'], ['qwen', 'wan3.0-video-prime'],
]) test(`${id} 编译四种输入模式并处理任务结果`, async () => {
  const env = await createRendererEnv();
  try {
    const { desktopApi } = await env.load('services/desktopApi');
    const { findProviderAdapter } = await env.load('domain/provider/adapters/index');
    const { resolveModelRuntimeContract, getGenerationInputModes } = await env.load('domain/catalog/ModelCatalog');
    const official = provider === 'qwen';
    const adapter = findProviderAdapter(provider);
    assert.deepEqual(getGenerationInputModes(id).map((mode) => mode.value), ['firstFrame', 'firstLastFrame', 'reference']);
    const previousSubmit = desktopApi.model.videoGeneration;
    const previousPoll = desktopApi.model.videoTask;
    try {
      for (const [modeId, roles, media] of [
        ['text-to-video', [], []],
        ['first-frame-to-video', ['referenceImage'], [{ type: 'first_frame', url: 'https://example.com/first.png' }]],
        ['first-last-frame-to-video', ['referenceImage', 'referenceImage'], [
          { type: 'first_frame', url: 'https://example.com/first.png' },
          { type: 'last_frame', url: 'https://example.com/last.png' },
        ]],
        ['omni-reference-to-video', ['referenceImage', 'inputVideo', 'referenceAudio'], [
          { type: 'reference_image', url: 'https://example.com/image.png' },
          { type: 'reference_video', url: 'https://example.com/video.mp4' },
          { type: 'reference_audio', url: 'https://example.com/audio.mp3' },
        ]],
        ['omni-reference-to-video', ['referenceAudio'], [{ type: 'reference_audio', url: 'https://example.com/audio.mp3' }]],
      ]) {
        const contract = resolveModelRuntimeContract('videoGeneration', id, roles, modeId);
        assert.ok(contract);
        const modelInputs = { images: [], videos: [], audios: [] };
        for (const item of media) {
          const kind = item.type === 'reference_video' ? 'videos' : item.type === 'reference_audio' ? 'audios' : 'images';
          const inputSlot = ({ first_frame: 'firstFrame', last_frame: 'lastFrame', reference_image: 'reference',
            reference_video: 'inputVideo', reference_audio: 'referenceAudio' })[item.type];
          modelInputs[kind].push({ url: item.url, inputSlot });
        }
        for (const duration of [2, -1, 30]) {
          desktopApi.model.videoGeneration = async (body) => {
            const { __signal, __timeoutMs, __providerId, __endpointMethod, __endpointPath,
              __endpointScope, __headers, __auth, __responseEncoding, ...payload } = body;
            assert.equal(__providerId, provider);
            assert.equal(__endpointPath, official ? '/api/v1/services/aigc/video-generation/video-synthesis' : '/videos');
            assert.equal(__endpointScope, official ? 'origin' : 'root');
            if (official) assert.equal(__headers['X-DashScope-Async'], 'enable');
            assert.deepEqual(payload, official ? {
              model: id, input: { prompt: '参考素材生成视频', ...(media.length ? { media } : {}) },
              parameters: { resolution: '1080P', ratio: 'adaptive', duration, audio: false,
                prompt_extend: false, watermark: false, seed: 0 },
            } : {
              model: 'wan3.0-video-prime', prompt: '参考素材生成视频',
              ...(media.length ? { media } : {}), size: '1080P', ratio: 'adaptive', duration,
              audio: false, prompt_extend: false, watermark: false, seed: 0,
            });
            return official ? { output: { task_id: 'task_wan', task_status: 'PENDING' } } : { id: 'task_wan', status: 'queued' };
          };
          const task = await adapter.submit(adapter.compileRequest({
            taskType: 'videoGeneration', model: id, prompt: '参考素材生成视频', modelContract: contract,
            params: { duration, resolution: '1080P', aspectRatio: 'adaptive', generateAudio: false,
              promptExtend: false, watermark: false, seed: 0 }, modelInputs,
          }));
          assert.equal(task.remoteTaskId, 'task_wan');
          for (const [status, expected] of (official
            ? [['PENDING', 'running'], ['RUNNING', 'running'], ['SUCCEEDED', 'completed'], ['FAILED', 'failed'], ['CANCELED', 'cancelled'], ['UNKNOWN', 'failed']]
            : [['in_progress', 'running'], ['completed', 'completed'], ['failed', 'failed']])) {
            desktopApi.model.videoTask = async (query) => {
              assert.equal(query.providerId, provider);
              assert.equal(query.endpointPath, official ? '/api/v1/tasks/task_wan' : '/videos/task_wan');
              assert.equal(query.endpointScope, official ? 'origin' : 'root');
              if (official) return { output: { task_status: status, video_url: 'https://example.com/result.mp4', message: 'upstream failed' } };
              return { status, metadata: { url: 'https://example.com/result.mp4' }, error: { message: 'upstream failed' } };
            };
            const result = await adapter.poll(task, contract);
            assert.equal(result.status, expected);
            if (expected === 'completed') assert.equal(result.result.files[0].url, 'https://example.com/result.mp4');
            if (status === 'failed' || status === 'FAILED') assert.equal(result.error, 'upstream failed');
          }
        }
      }
      if (official) {
        const contract = resolveModelRuntimeContract('videoGeneration', id, [], 'text-to-video');
        desktopApi.model.videoGeneration = async () => ({ code: 'InvalidApiKey', message: 'No API-key provided.' });
        const failed = await adapter.submit(adapter.compileRequest({ taskType: 'videoGeneration',
          model: id, prompt: '测试', modelContract: contract, params: {} }));
        assert.equal(failed.status, 'failed');
        assert.equal(failed.error, 'No API-key provided.');
      }
    } finally {
      desktopApi.model.videoGeneration = previousSubmit;
      desktopApi.model.videoTask = previousPoll;
    }
  } finally {
    await env.dispose();
  }
});
