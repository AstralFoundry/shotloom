import assert from 'node:assert/strict';
import test from 'node:test';

import { renderProtocolTemplate } from '../renderer/src/utils/modelProtocol.ts';
import { loadModelCatalog } from './helpers/modelCatalog.mjs';
import { createRendererEnv } from './helpers/rendererSsr.mjs';
import { readSource } from './helpers/sourceContract.mjs';

const catalog = loadModelCatalog();
const adapterSource = readSource('renderer/src/domain/provider/adapters/minimax.ts');
const speechModes = ['minimax-speech-2.8-hd', 'minimax-speech-2.8-turbo']
  .map((id) => catalog.models.find((model) => model.id === id))
  .map((model) => ({ model, mode: model.modes[0] }));
const music = catalog.models.find((model) => model.id === 'minimax-music-3.0');
const musicMode = music.modes[0];

const speechParams = {
  voice: 'female-shaonv', speed: 1, volume: 1, pitch: 0,
  languageBoost: 'auto', sampleRate: 32000, bitrate: 128000,
};

test('MiniMax 适配器只有一个官方地址并覆盖视频与音频', () => {
  assert.match(adapterSource, /id: 'minimax'/);
  assert.match(adapterSource, /baseUrl: 'https:\/\/api\.minimax\.io'/);
});

test('MiniMax 直连和 StarRouter 的首尾帧与多模态参考按各自协议编译', async () => {
  // https://platform.minimax.io/docs/api-reference/video-generation-v2-create
  const env = await createRendererEnv();
  try {
    const { desktopApi } = await env.load('services/desktopApi');
    const { findProviderAdapter } = await env.load('domain/provider/adapters/index');
    const { resolveModelRuntimeContract, getGenerationInputModes } = await env.load('domain/catalog/ModelCatalog');
    const adapter = findProviderAdapter('minimax');
    const previous = desktopApi.model.videoGeneration;
    let sent;
    desktopApi.model.videoGeneration = async (body) => {
      sent = body;
      return { id: 'h3-task', task_id: 'h3-task' };
    };
    try {
      for (const id of ['MiniMax-H3', 'MiniMax-H3-Highspeed', 'MiniMax-H3-Lite', 'MiniMax-H3-Max',
        'starrouter-MiniMax-H3', 'starrouter-MiniMax-H3-Max']) {
        const model = catalog.models.find((item) => item.id === id);
        const upstream = model.upstreamModel || id;
        const starrouter = model.provider === 'starrouter';
        const modelAdapter = starrouter ? findProviderAdapter('starrouter') : adapter;
        assert.deepEqual(getGenerationInputModes(id).map((mode) => mode.value), ['firstFrame', 'firstLastFrame', 'reference']);
        for (const modeId of ['first-last-frame-to-video', 'omni-reference-to-video']) {
          const reference = modeId === 'omni-reference-to-video';
          const contract = resolveModelRuntimeContract('videoGeneration', id,
            reference ? ['referenceImage', 'inputVideo', 'referenceAudio'] : ['referenceImage', 'referenceImage'], modeId);
          assert.deepEqual(contract.inputConstraints.images.max, reference ? 9 : 2);
          if (reference) {
            assert.equal(contract.inputConstraints.videos.max, 3);
            assert.equal(contract.inputConstraints.audios.max, 3);
          }
          const mode = model.modes.find((item) => item.id === modeId);
          assert.deepEqual(mode.params.find((param) => param.key === 'resolution').options,
            upstream === 'MiniMax-H3' ? ['768P', '2K'] : ['480P', '768P']);
          assert.equal(mode.outputConstraints.durations[0], upstream === 'MiniMax-H3-Max' ? 5 : 4);
          const images = reference
            ? [{ url: 'https://example.com/ref.png', inputSlot: 'reference' }]
            : [{ url: 'https://example.com/first.png', inputSlot: 'firstFrame' },
              { url: 'https://example.com/last.png', inputSlot: 'lastFrame' }];
          const task = await modelAdapter.submit(modelAdapter.compileRequest({
            taskType: 'videoGeneration', model: id, prompt: '镜头推进', modelContract: contract,
            params: { duration: 5, resolution: '768P', aspectRatio: 'adaptive' },
            modelInputs: {
              images,
              videos: reference ? [{ url: 'https://example.com/ref.mp4', inputSlot: 'inputVideo' }] : [],
              audios: reference ? [{ url: 'https://example.com/ref.mp3', inputSlot: 'referenceAudio' }] : [],
            },
          }));
          assert.equal(task.remoteTaskId, 'h3-task');
          assert.equal(sent.model, upstream);
          assert.equal(starrouter ? sent.metadata.ratio : sent.ratio, 'adaptive');
          if (starrouter) {
            assert.equal(sent.__endpointPath, '/videos');
            assert.equal(sent.__endpointScope, 'root');
            assert.equal(sent.size, '768P');
            assert.equal(sent.content, undefined);
            assert.equal(contract.taskEndpoint.path, '/videos/{taskId}');
          }
          assert.deepEqual(starrouter ? sent.metadata.content : sent.content, [
            { type: 'text', text: '镜头推进' },
            ...images.map((image, index) => ({
              type: 'image_url', image_url: { url: image.url },
              role: reference ? 'reference_image' : index === 0 ? 'first_frame' : 'last_frame',
            })),
            ...(reference ? [
              { type: 'video_url', video_url: { url: 'https://example.com/ref.mp4' }, role: 'reference_video' },
              { type: 'audio_url', audio_url: { url: 'https://example.com/ref.mp3' }, role: 'reference_audio' },
            ] : []),
          ]);
        }
      }
    } finally {
      desktopApi.model.videoGeneration = previous;
    }
  } finally {
    await env.dispose();
  }
});

test('StarRouter H3 使用公开任务 ID 轮询并解析结果和失败原因', async () => {
  // StarRouter MCP get_public_docs(page=minimax.post-v1-videos), 2026-11-03.
  const env = await createRendererEnv();
  try {
    const { desktopApi } = await env.load('services/desktopApi');
    const { findProviderAdapter } = await env.load('domain/provider/adapters/index');
    const { resolveModelRuntimeContract } = await env.load('domain/catalog/ModelCatalog');
    const adapter = findProviderAdapter('starrouter');
    const previous = desktopApi.model.videoTask;
    try {
      for (const upstream of ['MiniMax-H3', 'MiniMax-H3-Max']) {
        const id = `starrouter-${upstream}`;
        const contract = resolveModelRuntimeContract('videoGeneration', id, [], 'text-to-video');
        const request = adapter.compileRequest({
          taskType: 'videoGeneration', model: id, prompt: '镜头推进', modelContract: contract,
          params: { duration: 5, resolution: '768P', aspectRatio: '16:9' },
        });
        assert.deepEqual(renderProtocolTemplate(request.protocolTemplate, {
          ...request.protocolVariables, content: [{ type: 'text', text: '镜头推进' }],
        }), {
          model: upstream, prompt: '镜头推进', duration: 5, size: '768P',
          metadata: { content: [{ type: 'text', text: '镜头推进' }], ratio: '16:9' },
        });
        const task = { remoteTaskId: 'task_public', status: 'running', progress: 0, result: {}, error: '', raw: {} };
        for (const [status, expected] of [['queued', 'running'], ['in_progress', 'running'],
          ['completed', 'completed'], ['failed', 'failed']]) {
          desktopApi.model.videoTask = async (query) => {
            assert.equal(query.providerId, 'starrouter');
            assert.equal(query.endpointPath, '/videos/task_public');
            return { id: 'task_public', status, progress: 100,
              ...(status === 'completed' ? { metadata: { url: 'https://example.com/result.mp4' } } : {}),
              ...(status === 'failed' ? { error: { message: 'upstream failed' } } : {}),
            };
          };
          const polled = await adapter.poll(task, contract);
          assert.equal(polled.status, expected);
          if (status === 'completed') assert.equal(polled.result.files[0].url, 'https://example.com/result.mp4');
          if (status === 'failed') assert.equal(polled.error, 'upstream failed');
        }
      }
    } finally {
      desktopApi.model.videoTask = previous;
    }
  } finally {
    await env.dispose();
  }
});

test('MiniMax 官方 Speech 2.8 走 t2a_v2 同步协议并取回 URL 结果', () => {
  assert.deepEqual(speechModes.map(({ model }) => [model.id, model.upstreamModel, model.sortOrder]), [
    ['minimax-speech-2.8-hd', 'speech-2.8-hd', 19],
    ['minimax-speech-2.8-turbo', 'speech-2.8-turbo', 20],
  ]);
  for (const { model, mode } of speechModes) {
    assert.equal(model.provider, 'minimax');
    assert.equal(model.type, 'audioGeneration');
    assert.equal(model.defaultMode, 'text-to-speech');
    assert.deepEqual(mode.endpoint, { method: 'POST', path: '/v1/t2a_v2', scope: 'root' });
    assert.equal(mode.taskEndpoint, undefined, 't2a_v2 是同步接口，不该有任务轮询');
    assert.equal(mode.isAsync, undefined);

    // 官方只有在 output_format=url 时才返回可下载的 data.audio；hex 需要单独的解码车道。
    const body = renderProtocolTemplate(mode.requestTemplate, {
      model: model.upstreamModel, prompt: '你好', params: speechParams,
    });
    assert.deepEqual(body, {
      model: model.upstreamModel,
      text: '你好',
      stream: false,
      output_format: 'url',
      language_boost: 'auto',
      voice_setting: { voice_id: 'female-shaonv', speed: 1, vol: 1, pitch: 0 },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
    });
    assert.equal(mode.resultUrlPath, 'data.audio');
    assert.equal(mode.resultMimeType, 'audio/mpeg');
    assert.equal(mode.resultFileExtension, 'mp3');
  }

  const { mode } = speechModes[0];
  const voice = mode.params.find((param) => param.key === 'voice');
  assert.equal(voice.presentation.control, 'voice');
  const speed = mode.params.find((param) => param.key === 'speed');
  assert.deepEqual([speed.presentation.min, speed.presentation.max], [0.5, 2]);
  const languageBoost = mode.params.find((param) => param.key === 'languageBoost');
  assert.equal(languageBoost.options.length, 41, '官方 language_boost 枚举必须完整公开');
  assert.deepEqual(
    mode.params.filter((param) => param.type === 'select' && param.numeric).map((param) => param.key),
    ['sampleRate', 'bitrate'],
  );
});

test('音频参数面板只用一套控件语言，倍率滑杆按对数轨道声明', () => {
  const controls = new Map();
  for (const audioMode of [...speechModes.map(({ mode }) => mode), musicMode]) {
    for (const param of audioMode.params || []) {
      const presentation = param.presentation || {};
      controls.set(param.key, presentation.control || '选项块');
      if (param.key === 'speed' || param.key === 'volume') {
        assert.equal(presentation.scale, 'log', `${param.key} 是倍率参数：线性轨道会把默认值 1 压在左端，看起来像空轨`);
      }
      if ((param.key === 'sampleRate' || param.key === 'bitrate') && (param.options || []).length <= 6) {
        assert.notEqual(presentation.control, 'select', `${param.key} 只有 ${param.options.length} 档，必须铺成选项块`);
      }
    }
  }
  assert.equal(controls.get('voice'), 'voice', '音色清单来自系统音色库，只能用选择器');
  assert.equal(controls.get('languageBoost'), 'select', '41 个语种铺不成选项块，只有它可以是下拉');
  assert.equal(controls.get('lyrics'), 'text');
});

test('MiniMax Music 3.0 只发出官方声明的参数，歌词是自由文本', () => {
  assert.equal(music.upstreamModel, 'music-3.0');
  assert.equal(music.type, 'audioGeneration');
  assert.deepEqual(musicMode.endpoint, { method: 'POST', path: '/v1/music_generation', scope: 'root' });
  assert.equal(musicMode.taskEndpoint, undefined);

  const body = renderProtocolTemplate(musicMode.requestTemplate, {
    model: 'music-3.0',
    prompt: '雨夜的爵士',
    params: { lyrics: '', instrumental: false, lyricsOptimizer: false, sampleRate: 44100, bitrate: 256000 },
  });
  assert.deepEqual(body, {
    model: 'music-3.0',
    prompt: '雨夜的爵士',
    lyrics: '',
    stream: false,
    output_format: 'url',
    is_instrumental: false,
    lyrics_optimizer: false,
    audio_setting: { sample_rate: 44100, bitrate: 256000, format: 'mp3' },
  });
  assert.equal(musicMode.params.find((param) => param.key === 'lyrics').presentation.control, 'text');
  assert.equal(musicMode.resultUrlPath, 'data.audio');
  assert.equal(musicMode.resultMimeType, 'audio/mpeg');
  assert.equal(musicMode.resultFileExtension, 'mp3');
});

test('MiniMax 把失败写在 HTTP 200 的响应体里，提交回执必须带真实原因', async () => {
  const env = await createRendererEnv();
  try {
    const { desktopApi } = await env.load('services/desktopApi');
    const { findProviderAdapter } = await env.load('domain/provider/adapters/index');
    const { resolveModelRuntimeContract } = await env.load('domain/catalog/ModelCatalog');
    const adapter = findProviderAdapter('minimax');
    const speechContract = resolveModelRuntimeContract('audioGeneration', 'minimax-speech-2.8-hd', [], 'text-to-speech');
    const videoContract = resolveModelRuntimeContract('videoGeneration', 'MiniMax-H3', [], 'text-to-video');

    const previousChat = desktopApi.model.chatCompletion;
    const previousVideo = desktopApi.model.videoGeneration;
    const previousTask = desktopApi.model.videoTask;
    try {
      desktopApi.model.chatCompletion = async () => ({
        base_resp: { status_code: 2013, status_msg: 'invalid params, voice not found' },
      });
      const failed = await adapter.submit(adapter.compileRequest({
        taskType: 'audioGeneration', model: 'minimax-speech-2.8-hd', prompt: '你好',
        modelContract: speechContract, params: speechParams,
      }));
      assert.equal(failed.status, 'failed');
      assert.equal(failed.error, 'invalid params, voice not found');

      desktopApi.model.chatCompletion = async () => ({
        base_resp: { status_code: 0 },
        data: { audio: 'https://file.minimax.io/result.mp3' },
      });
      const succeeded = await adapter.submit(adapter.compileRequest({
        taskType: 'audioGeneration', model: 'minimax-speech-2.8-hd', prompt: '你好',
        modelContract: speechContract, params: speechParams,
      }));
      assert.equal(succeeded.status, 'completed');
      assert.deepEqual(succeeded.result.files, [
        { url: 'https://file.minimax.io/result.mp3', mimeType: 'audio/mpeg', name: 'result.mp3' },
      ]);

      // 异步视频提交失败时同样要报原因，而不是"缺少任务 ID 路径"。
      desktopApi.model.videoGeneration = async () => ({
        base_resp: { status_code: 1004, status_msg: 'login fail: Please check the API Key' },
      });
      const videoFailed = await adapter.submit(adapter.compileRequest({
        taskType: 'videoGeneration', model: 'MiniMax-H3', prompt: '镜头推进',
        modelContract: videoContract, params: { duration: 5, resolution: '768P', aspectRatio: '16:9' },
      }));
      assert.equal(videoFailed.status, 'failed');
      assert.equal(videoFailed.error, 'login fail: Please check the API Key');

      desktopApi.model.videoTask = async () => ({
        base_resp: { status_code: 1002, status_msg: 'quota exceeded' },
      });
      const polled = await adapter.poll(
        { remoteTaskId: 'task-1', status: 'running', progress: 0, result: {}, error: '', raw: {} },
        videoContract,
      );
      assert.equal(polled.status, 'failed');
      assert.equal(polled.error, 'quota exceeded');
    } finally {
      desktopApi.model.chatCompletion = previousChat;
      desktopApi.model.videoGeneration = previousVideo;
      desktopApi.model.videoTask = previousTask;
    }
  } finally {
    await env.dispose();
  }
});

test('没有声明 errorCodePath 的厂商不受 body 内错误判定影响', async () => {
  const env = await createRendererEnv();
  try {
    const { desktopApi } = await env.load('services/desktopApi');
    const { findProviderAdapter } = await env.load('domain/provider/adapters/index');
    const { resolveModelRuntimeContract } = await env.load('domain/catalog/ModelCatalog');
    const contract = resolveModelRuntimeContract('textGeneration', 'deepseek-flash', [], undefined);
    assert.equal(contract.errorCodePath, undefined, '文本模型不该被 body 内错误码判定拦下');
    const previousChat = desktopApi.model.chatCompletion;
    try {
      desktopApi.model.chatCompletion = async () => ({ choices: [{ message: { content: 'ok' } }] });
      const task = await findProviderAdapter(contract.provider).submit(
        findProviderAdapter(contract.provider).compileRequest({
          taskType: 'textGeneration', model: contract.modelId, prompt: 'hi', modelContract: contract, params: {},
        }),
      );
      assert.equal(task.status, 'completed');
      assert.equal(task.result.text, 'ok');
    } finally {
      desktopApi.model.chatCompletion = previousChat;
    }
  } finally {
    await env.dispose();
  }
});
