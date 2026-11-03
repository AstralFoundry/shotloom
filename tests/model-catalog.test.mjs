import { loadModelCatalog } from './helpers/modelCatalog.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { modelResponseError } from '../renderer/src/utils/modelResponseParsing.ts';
import { renderProtocolContentTemplate, renderProtocolTemplate } from '../renderer/src/utils/modelProtocol.ts';
import { optionLabel, sliderTrackDomain, sliderTrackPosition, sliderValueFromTrack } from '../renderer/src/utils/modelPresentation.ts';
import { readSource } from './helpers/sourceContract.mjs';

const catalog = loadModelCatalog();
const agentContract = JSON.parse(readSource('renderer/src/config/agent-action-contract.json'));

test('模型能力按厂商文件登记，索引不复制模型定义', () => {
  const manifest = JSON.parse(readSource('renderer/src/config/model-catalog-v2.json'));
  assert.equal(Object.hasOwn(manifest, 'models'), false);
  assert.equal(new Set(manifest.providers).size, manifest.providers.length);
  assert.equal(new Set(manifest.modelOrder).size, catalog.models.length);
  for (const provider of manifest.providers) {
    const file = JSON.parse(readSource(`../renderer/src/config/model-catalog-v2/${provider}.json`));
    assert.equal(file.provider, provider);
    assert.ok(file.models.length > 0);
    assert.ok(file.models.every((model) => model.provider === provider));
  }
});

test('内置模型使用统一模型定义结构', () => {
  assert.equal(catalog.schema, 'shotloom.model-catalog');
  assert.equal(catalog.modelDefinitionVersion, 2);
  for (const model of catalog.models) {
    assert.ok(model.id);
    assert.ok(model.provider);
    assert.ok(model.type);
    assert.ok(Array.isArray(model.modes) && model.modes.length > 0);
    assert.ok(model.modes.some((mode) => mode.id === model.defaultMode));
    for (const mode of model.modes) {
      assert.ok(mode.endpoint?.method);
      assert.ok(mode.endpoint?.path?.startsWith('/'));
      assert.ok(mode.requestTemplate && typeof mode.requestTemplate === 'object');
      assert.ok(mode.auth?.type);
      if (model.type === 'textGeneration') {
        if (mode.agent?.supportsTools) {
          assert.ok(['provider-default', 'openai-responses', 'anthropic-messages'].includes(mode.agent.transport));
          if (mode.agent.transport === 'anthropic-messages') {
            assert.equal(mode.requestTemplate.messages, '{{nonSystemMessages}}');
            assert.equal(mode.requestTemplate.system, '{{system}}');
          } else {
            assert.equal(mode.requestTemplate.messages, '{{messages}}');
            assert.equal(mode.requestTemplate.tools, '{{tools}}');
            assert.equal(mode.requestTemplate.tool_choice, '{{toolChoice}}');
          }
        }
      }
      assert.ok(Array.isArray(mode.params));
      if (mode.isAsync) {
        assert.ok(
          mode.taskEndpoint?.path?.includes('{taskId}')
            || JSON.stringify(mode.taskRequestTemplate || {}).includes('{{taskId}}'),
          `${model.id}/${mode.id} 的异步轮询请求缺少 taskId`,
        );
      }
      for (const param of mode.params) {
        if (!Array.isArray(param.options) || !param.options.length) continue;
        assert.ok(param.options.includes(param.default), `${model.id}/${mode.id}/${param.key} 默认值不在 options 中`);
      }
    }
  }
});

test('OpenAI 与 Gemini 文本模型按官方档位传递推理强度', () => {
  const expected = {
    'gpt-6-astra': ['low', 'medium', 'high', 'xhigh', 'max'],
    'gemini-3.8-flash': ['minimal', 'low', 'medium', 'high'],
    'gemini-3.1-pro-preview': ['low', 'medium', 'high'],
  };
  for (const [id, values] of Object.entries(expected)) {
    const model = catalog.models.find((item) => item.id === id);
    for (const mode of model.modes) {
      const param = mode.params.find((item) => item.key === 'reasoningEffort');
      assert.deepEqual(param.options, values);
      for (const value of values) assert.doesNotMatch(optionLabel(param, value), /[a-z]/i);
      assert.equal(mode.requestTemplate.reasoning_effort, '{{params.reasoningEffort}}');
      assert.equal(renderProtocolTemplate(mode.requestTemplate, {
        model: id, messages: [{ role: 'user', content: '测试' }],
        params: { reasoningEffort: values.at(-1) },
      }).reasoning_effort, values.at(-1));
    }
  }
});

test('GPT Image 2.5 两种官方模型支持生成、编辑和真实质量档位', () => {
  for (const id of ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare']) {
    const model = catalog.models.find((item) => item.id === id);
    assert.deepEqual(model.modes.map((mode) => mode.id), ['text-to-image', 'image-to-image']);
    for (const mode of model.modes) {
      assert.deepEqual(mode.params.find((param) => param.key === 'quality').options,
        ['auto', 'low', 'medium', 'high', 'xhigh', 'max']);
      const size = mode.params.find((param) => param.key === 'size');
      assert.equal(size.presentation, 'aspectRatio', 'size 用比例图形呈现，不铺开原始像素串');
      assert.equal(size.optionLabels['3840x2160'], '16:9 · 超清');
      const body = renderProtocolTemplate(mode.requestTemplate, {
        model: id, prompt: '测试',
        params: { size: '2048x1152', quality: 'xhigh', background: 'opaque', outputFormat: 'webp', generationCount: 2 },
      });
      assert.deepEqual([body.model, body.size, body.quality, body.output_format, body.n],
        [id, '2048x1152', 'xhigh', 'webp', 2]);
    }
    assert.equal(model.modes[1].inputFormat, 'multipart');
  }
});

test('Nano Banana 新型号按目录编译原生生图与多参考图请求', () => {
  for (const id of ['gemini-nano-banana-2.1', 'gemini-3.1-flash-lite-image', 'gemini-3-pro-image']) {
    const model = catalog.models.find((item) => item.id === id);
    assert.deepEqual(model.modes.map((mode) => mode.id), ['text-to-image', 'image-to-image']);
    const edit = model.modes[1];
    assert.equal(edit.inputMode, 'reference');
    assert.equal(edit.inputConstraints.images.max, 14);
    const content = renderProtocolContentTemplate(edit.contentTemplate, {
      text: '测试', images: [{ url: 'data:image/png;base64,QUJD' }, { url: 'data:image/jpeg;base64,REVG' }],
    });
    const params = { aspectRatio: '16:9', imageSize: '2K', thinkingLevel: 'high' };
    const body = renderProtocolTemplate(edit.requestTemplate, { content, params });
    assert.deepEqual(body.contents[0].parts, [
      { text: '测试' },
      { inlineData: { mimeType: 'image/png', data: 'QUJD' } },
      { inlineData: { mimeType: 'image/jpeg', data: 'REVG' } },
    ]);
    assert.equal(body.generationConfig.responseFormat.image.aspectRatio, '16:9');
    assert.equal(body.generationConfig.responseFormat.image.imageSize,
      id === 'gemini-3.1-flash-lite-image' ? undefined : '2K');
  }
});

test('像素尺寸只作为协议值，界面展示不含英文字母的比例标签', () => {
  const pixelSize = /^\d+[x*]\d+$/;
  for (const model of catalog.models) {
    for (const mode of model.modes) {
      const param = mode.params.find((item) => item.key === 'size');
      if (!param) continue;
      for (const value of param.options || []) {
        if (!pixelSize.test(String(value))) continue;
        assert.ok(param.optionLabels?.[value], `${model.id}/${mode.id}/${value} 缺少展示标签`);
        assert.doesNotMatch(optionLabel(param, value), pixelSize);
        assert.doesNotMatch(optionLabel(param, value), /[a-z]/i);
      }
    }
  }

});

test('StarRouter 图片参数显示中文，接口仍使用原始枚举值', () => {
  for (const id of ['starrouter-gpt-image-2.5-sunburst', 'starrouter-gpt-image-2.5-flare']) {
    const model = catalog.models.find((item) => item.id === id);
    for (const mode of model.modes) {
      for (const key of ['quality', 'background', 'outputFormat']) {
        const param = mode.params.find((item) => item.key === key);
        for (const value of param.options) {
          assert.match(optionLabel(param, value), /[\u4e00-\u9fff]/);
          assert.doesNotMatch(optionLabel(param, value), /[a-z]/i);
        }
      }
      const request = renderProtocolTemplate(mode.requestTemplate, {
        model: model.upstreamModel,
        prompt: '测试',
        params: { quality: 'medium', background: 'transparent', outputFormat: 'webp' },
      });
      assert.equal(request.quality, 'medium');
      assert.equal(request.background, 'transparent');
      assert.equal(request.output_format, 'webp');
    }
  }
});

test('StarRouter 内置模型使用上游真实模型 ID 和已声明的图片编辑能力', () => {
  const text = catalog.models.find((item) => item.id === 'starrouter-gpt-5.4');
  assert.equal(text.provider, 'starrouter');
  assert.equal(text.upstreamModel, 'gpt-5.4');
  assert.equal(text.modes[0].endpoint.path, '/chat/completions');

  // 中转站实测的 gpt-image-2.5 与官方同参数，档位直接对齐 openai.json。
  const image = catalog.models.find((item) => item.id === 'starrouter-gpt-image-2.5-sunburst');
  assert.equal(image.provider, 'starrouter');
  assert.equal(image.upstreamModel, 'gpt-image-2.5-sunburst');
  assert.deepEqual(image.modes.map((mode) => mode.endpoint.path), [
    '/images/generations',
    '/images/edits',
  ]);
  const edit = image.modes.find((mode) => mode.id === 'image-to-image');
  assert.equal(edit.inputMode, 'reference');
  assert.deepEqual(edit.inputSlots, ['reference']);
  assert.equal(edit.inputConstraints.images.max, 16);
  assert.equal(edit.inputFormat, 'multipart');
  assert.equal(edit.requestFields.multipartImage, 'image');
  assert.deepEqual(edit.params.find((param) => param.key === 'quality').options, [
    'auto', 'low', 'medium', 'high', 'xhigh', 'max',
  ]);
  assert.deepEqual(edit.params.find((param) => param.key === 'outputFormat').options, [
    'png', 'jpeg', 'webp',
  ]);
  assert.deepEqual(edit.inputConstraints.images.formats, ['png', 'jpeg', 'webp']);
  assert.equal(Object.hasOwn(edit.requestTemplate, 'input_fidelity'), false);
});

test('StarRouter 的 GPT Image 2.5 与官方同参数档位', () => {
  // 2026-10-21 核对：中转站的 gpt-image-2.5 接受与官方一致的尺寸与质量档位。
  const official = catalog.models.find((item) => item.id === 'gpt-image-2.5-sunburst');
  const mirrored = catalog.models.find((item) => item.id === 'starrouter-gpt-image-2.5-sunburst');
  assert.equal(mirrored.modes.length, official.modes.length);
  for (const [index, mode] of mirrored.modes.entries()) {
    const source = official.modes[index];
    assert.equal(mode.endpoint.path, source.endpoint.path, `${mode.id} 接口路径`);
    assert.deepEqual(mode.params, source.params, `${mode.id} 参数档位`);
    assert.deepEqual(mode.requestTemplate, source.requestTemplate, `${mode.id} 请求模板`);
    assert.deepEqual(mode.outputConstraints, source.outputConstraints, `${mode.id} 输出约束`);
  }
});

test('OpenAI GPT 画布文本请求使用 max_completion_tokens', () => {
  const models = catalog.models.filter((item) => (
    item.provider === 'openai' && item.type === 'textGeneration'
  ));
  assert.ok(models.length > 0);
  for (const model of models) {
    for (const mode of model.modes) {
      assert.equal(mode.requestTemplate.max_completion_tokens, '{{params.maxTokens}}');
      assert.equal(Object.hasOwn(mode.requestTemplate, 'max_tokens'), false);
      const body = renderProtocolTemplate(mode.requestTemplate, {
        model: model.id,
        messages: [{ role: 'user', content: '测试' }],
        params: { maxTokens: 8192 },
      });
      assert.equal(body.max_completion_tokens, 8192);
      assert.equal(Object.hasOwn(body, 'max_tokens'), false);
    }
  }
});

test('内置目录只保留每条产品线最新一代的模型', () => {
  const ids = new Set(catalog.models.map((model) => model.id));
  for (const id of [
    'gpt-6-astra', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare',
    'starrouter-gpt-image-2.5-sunburst', 'starrouter-gpt-image-2.5-flare',
    'gemini-3.8-flash', 'gemini-3.1-pro-preview',
    'gemini-nano-banana-2.1', 'gemini-3.1-flash-lite-image', 'gemini-3-pro-image',
    'grok-4.7', 'grok-imagine-image-2.0', 'grok-imagine-video-1.5',
    'claude-opus-5-5', 'claude-sonnet-5-5',
    'deepseek-v4-pro', 'deepseek-flash',
    'qwen3.8-max', 'qwen3.8-flash', 'qwen-image-3.0-pro',
    'kimi-k3', 'glm-5.3', 'glm-image', 'cogvideox-3',
    'MiniMax-H3-Max', 'MiniMax-H3',
    'doubao-seedance-2-5-260628',
    'kling-3.0-turbo', 'kling-3.0', 'kling-3.0-omni',
  ]) assert.equal(ids.has(id), true, `缺少内置模型 ${id}`);
  // ai.google.dev/gemini-api/docs/deprecations：三个 Veo 3.1 preview 于 2026-10-22 关停，
  // gemini-2.5-flash-image 已排关停，gemini-3.1-flash-image 由官方指向 gemini-nano-banana-2.1；
  // docs.x.ai/developers/migration/imagine-image-quality-nov-2：grok-imagine-image-quality 于 2026-11-02 退役。
  for (const retired of [
    'veo-3.1-generate-preview', 'veo-3.1-fast-generate-preview', 'veo-3.1-lite-generate-preview',
    'gemini-2.5-flash-image', 'gemini-3.1-flash-image', 'grok-imagine-image-quality',
  ]) assert.equal(ids.has(retired), false, `仍保留官方已弃用的模型 ${retired}`);
  // 2026-10-19 各厂商官方模型页核对：同一产品线只留最新一代，被取代的旧代不进目录。
  for (const superseded of [
    'gpt-5.6', 'gpt-5.4', 'gpt-image-2',
    // 2026-10-21：中转站也有 gpt-image-2.5，图片线在 StarRouter 侧同样只留最新一代。
    'starrouter-gpt-image-2', 'starrouter-gpt-image-2-t8',
    'claude-sonnet-5', 'claude-opus-4-8',
    'grok-4.5', 'grok-imagine-video',
    'gemini-3.6-flash', 'qwen3.7-plus', 'qwen-image-2.0-pro', 'glm-5.2',
    'doubao-seedance-2-0-260128', 'doubao-seedance-2-0-fast-260128', 'doubao-seedance-2-0-mini-260615',
  ]) assert.equal(ids.has(superseded), false, `仍保留被新一代取代的旧模型 ${superseded}`);
  for (const removed of ['gpt-5.5', 'gemini-3.1-pro', 'kling-v3', 'happyhorse-1.1-t2v', 'deepseek-v4-flash']) {
    assert.equal(ids.has(removed), false, `仍保留未经本轮官方核实的旧模型 ${removed}`);
  }
});

test('MiniMax H3 使用官方 Video Generation V2 任务协议', () => {
  const model = catalog.models.find((item) => item.id === 'MiniMax-H3');
  assert.equal(model.provider, 'minimax');
  assert.deepEqual(model.modes.map((mode) => mode.id), ['text-to-video', 'first-frame-to-video', 'first-last-frame-to-video', 'omni-reference-to-video']);
  for (const mode of model.modes) {
    assert.deepEqual(mode.endpoint, { method: 'POST', path: '/v2/video_generation', scope: 'root' });
    assert.deepEqual(mode.taskEndpoint, { method: 'GET', path: '/v2/query/video_generation/{taskId}', scope: 'root' });
    assert.equal(mode.taskIdPath, 'task_id');
    assert.equal(mode.statusPath, 'task.status');
    assert.equal(mode.errorPath, 'task.error.message');
    assert.equal(mode.resultUrlPath, 'task.content.url');
    assert.deepEqual(mode.params.find((param) => param.key === 'resolution').options, ['768P', '2K']);
    assert.deepEqual(mode.outputConstraints.durations, [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  }

  const textMode = model.modes.find((mode) => mode.id === 'text-to-video');
  assert.deepEqual(textMode.inputConstraints.images, { min: 0, max: 0 });
  assert.deepEqual(textMode.params.find((param) => param.key === 'aspectRatio').options, [
    '21:9', '16:9', '4:3', '1:1', '3:4', '9:16',
  ]);

  const imageMode = model.modes.find((mode) => mode.id === 'first-frame-to-video');
  assert.deepEqual(imageMode.inputConstraints.images, {
    min: 1, max: 1, roles: ['referenceImage'], formats: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'],
  });
  assert.equal(imageMode.requestFields.imageContentRole, 'first_frame');
  assert.equal(imageMode.requestTemplate.ratio, 'adaptive');
});

test('MiniMax H3 Max 用官方列出的时长与清晰度而不是照抄 H3', () => {
  const h3max = catalog.models.find((item) => item.id === 'MiniMax-H3-Max');
  assert.equal(h3max.name, 'MiniMax H3 Max');
  for (const mode of h3max.modes) {
    assert.deepEqual(mode.endpoint, { method: 'POST', path: '/v2/video_generation', scope: 'root' });
    assert.deepEqual(mode.outputConstraints.durations, [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    assert.deepEqual(mode.params.find((param) => param.key === 'resolution').options, ['480P', '768P']);
  }
});

test('Kling 3.0 系列使用官方 API 2.0 视频任务协议', () => {
  const turbo = catalog.models.find((item) => item.id === 'kling-3.0-turbo');
  const standard = catalog.models.find((item) => item.id === 'kling-3.0');
  const omni = catalog.models.find((item) => item.id === 'kling-3.0-omni');

  assert.deepEqual(turbo.modes.map((mode) => mode.endpoint.path), [
    '/text-to-video/kling-3.0-turbo',
    '/image-to-video/kling-3.0-turbo',
  ]);
  assert.deepEqual(standard.modes.map((mode) => mode.endpoint.path), [
    '/text-to-video/kling-3.0',
    '/image-to-video/kling-3.0',
  ]);
  assert.equal(omni.modes[0].endpoint.path, '/omni-video/kling-3.0-omni');

  for (const model of [turbo, standard, omni]) {
    assert.equal(model.provider, 'kling');
    for (const mode of model.modes) {
      assert.deepEqual(mode.auth, { type: 'bearer' });
      assert.deepEqual(mode.taskEndpoint, { method: 'GET', path: '/tasks?task_ids={taskId}', scope: 'root' });
      assert.equal(mode.taskIdPath, 'data.id');
      assert.equal(mode.statusPath, 'data.0.status');
      assert.equal(mode.resultUrlPath, 'data.0.outputs.*.url');
      assert.deepEqual(mode.outputConstraints.durations, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    }
  }

  const turboImage = turbo.modes.find((mode) => mode.id === 'image-to-video');
  assert.deepEqual(turboImage.inputConstraints.images, {
    min: 1, max: 1, roles: ['referenceImage'], formats: ['jpg', 'jpeg', 'png'],
  });
  assert.deepEqual(turboImage.contentTemplate, {
    text: { type: 'prompt', text: '{{text}}' },
    image: { type: 'first_frame', url: '{{url}}' },
  });
  assert.equal(turboImage.requestTemplate.contents, '{{content}}');
  assert.equal(Object.hasOwn(turboImage, 'requestFields'), false);
  assert.deepEqual(renderProtocolTemplate(turboImage.requestTemplate, {
    content: [
      { type: 'prompt', text: '让人物转头' },
      { type: 'first_frame', url: 'https://example.com/first.png' },
    ],
    resolution: '1080p', duration: 5, params: { watermark: false },
  }).contents, [
    { type: 'prompt', text: '让人物转头' },
    { type: 'first_frame', url: 'https://example.com/first.png' },
  ]);

  const omniMode = omni.modes[0];
  assert.deepEqual(omniMode.inputConstraints.images, {
    min: 0, max: 7, roles: ['referenceImage'], formats: ['jpg', 'jpeg', 'png'],
  });
  assert.deepEqual(omniMode.contentTemplate, {
    text: { type: 'prompt', text: '{{text}}' },
    image: { type: 'refer_image', url: '{{url}}', id: 'image_{{index}}' },
  });
  assert.equal(omniMode.requestTemplate.contents, '{{content}}');
  assert.deepEqual(renderProtocolTemplate(omniMode.requestTemplate, {
    content: [
      { type: 'prompt', text: '让 image_1 和 image_2 同框' },
      { type: 'refer_image', url: 'https://example.com/a.png', id: 'image_1' },
      { type: 'refer_image', url: 'https://example.com/b.png', id: 'image_2' },
    ],
    resolution: '720p', aspectRatio: '16:9', duration: 5,
    params: { audio: 'off', multiShot: true, watermark: false },
  }).contents[2], { type: 'refer_image', url: 'https://example.com/b.png', id: 'image_2' });
});

test('Seedance 2.5 用方舟官方视频任务协议与官方列出的时长、素材上限', () => {
  const model = catalog.models.find((item) => item.id === 'doubao-seedance-2-5-260628');
  assert.equal(model.provider, 'bytedance');
  assert.equal(model.name, 'Doubao Seedance 2.5');
  assert.deepEqual(model.modes.map((mode) => mode.id), ['text-to-video', 'omni-reference-to-video']);
  for (const mode of model.modes) {
    assert.deepEqual(mode.endpoint, { method: 'POST', path: '/contents/generations/tasks', scope: 'root' });
    assert.deepEqual(mode.taskEndpoint, { method: 'GET', path: '/contents/generations/tasks/{taskId}', scope: 'root' });
    assert.equal(mode.requestTemplate.content, '{{content}}');
    assert.equal(mode.taskIdPath, 'id');
    assert.equal(mode.statusPath, 'status');
    assert.equal(mode.resultUrlPath, 'content.video_url');
    assert.deepEqual(mode.outputConstraints.durations,
      Array.from({ length: 27 }, (_, index) => 4 + index), '官方输出时长 4~30 秒');
    assert.deepEqual(mode.outputConstraints.formats, ['mp4', 'mov']);
    assert.deepEqual(mode.params.find((param) => param.key === 'resolution').options,
      ['480p', '720p', '1080p'], '2.5 的输出分辨率上限是 1080p，没有 4k');
  }
  const reference = model.modes.find((mode) => mode.id === 'omni-reference-to-video');
  assert.deepEqual(reference.inputVariants.map((variant) => variant.inputMode), ['firstLastFrame']);
  assert.equal(reference.inputConstraints.images.max, 30);
  assert.equal(reference.inputConstraints.videos.max, 10);
  assert.equal(reference.inputConstraints.videos.maxBytes, 209715200);
  assert.equal(reference.inputConstraints.audios.max, 10);
  assert.equal(reference.inputConstraints.audios.maxTotalDuration, 30);
  assert.equal(reference.inputConstraints.audios.requiresAnyOf, undefined,
    '2.5 支持纯音频参考生视频，不再强制搭配图片或视频');
  assert.deepEqual(reference.inputVariants[0].inputConstraints.images,
    { min: 1, max: 2, roles: ['referenceImage'] }, '首尾帧仍然只吃两张图');
  assert.equal(reference.requestFields.imageContentRole, 'reference_image');
  assert.equal(reference.requestFields.videoContentRole, 'reference_video');
  assert.equal(reference.requestFields.audioContentRole, 'reference_audio');
});

test('StarRouter Seedance 从站点根路径调用专用火山协议', () => {
  for (const id of [
    'starrouter-doubao-seedance-2-0-260128',
    'starrouter-doubao-seedance-2-0-fast-260128',
    'starrouter-doubao-seedance-2-0-mini-260615',
  ]) {
    const model = catalog.models.find((item) => item.id === id);
    assert.equal(model.provider, 'starrouter');
    for (const mode of model.modes) {
      assert.equal(mode.endpoint.scope, 'origin');
      assert.equal(mode.taskEndpoint.scope, 'origin');
      assert.match(mode.endpoint.path, /^\/volcengine\/doubao\//);
    }
  }
});

test('Grok Imagine Video 1.5 编译纯文本与单图生视频两种输入', () => {
  const grok = catalog.models.find((item) => item.id === 'grok-imagine-video-1.5');
  const grokMode = grok.modes.find((mode) => mode.id === 'text-or-image-to-video');
  assert.deepEqual(grokMode.inputConstraints.images, { min: 0, max: 1, roles: ['referenceImage'] },
    '官方在 1.5 上支持纯文本生成视频，删除 1.0 后文生视频能力不得丢失');
  assert.deepEqual(grokMode.params.find((param) => param.key === 'resolution').options,
    ['480p', '720p', '1080p'], '1.5 的文生/图生视频原生支持 1080p');
  const textOnly = renderProtocolTemplate(grokMode.requestTemplate, {
    model: grok.id, prompt: '纯文本', duration: 8, aspectRatio: '16:9', resolution: '720p',
    params: { generateAudio: false },
  });
  assert.equal(Object.hasOwn(textOnly, 'image'), false, '没有输入图时不得携带 image 字段');
  assert.deepEqual([textOnly.aspect_ratio, textOnly.resolution, textOnly.generate_audio], ['16:9', '720p', false]);
  assert.deepEqual(renderProtocolTemplate(grokMode.requestTemplate, {
    model: grok.id, prompt: '图生视频', imageObject: { url: 'https://example.com/input.png' },
    duration: 8, aspectRatio: '16:9', resolution: '1080p', params: { generateAudio: true },
  }).image, { url: 'https://example.com/input.png' });
});

test('Grok Imagine Image 2.0 编译官方新增的清晰度与质量档位', () => {
  const model = catalog.models.find((item) => item.id === 'grok-imagine-image-2.0');
  const mode = model.modes.find((item) => item.id === 'text-to-image');
  assert.deepEqual(mode.params.find((param) => param.key === 'imageSize').options, ['1k', '2k']);
  assert.deepEqual(mode.params.find((param) => param.key === 'quality').options, ['low', 'medium', 'auto'],
    '官方用 2.0 的 quality 档位替代已退役的 grok-imagine-image-quality');
  assert.deepEqual(mode.params.find((param) => param.key === 'aspectRatio').options,
    ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9', '5:2']);
  const body = renderProtocolTemplate(mode.requestTemplate, {
    model: model.id, prompt: '测试',
    params: { aspectRatio: '21:9', imageSize: '2k', quality: 'low', generationCount: 1 },
  });
  assert.deepEqual([body.aspect_ratio, body.resolution, body.quality], ['21:9', '2k', 'low']);
});

test('内置模型只使用唯一声明式执行协议', () => {
  const serialized = JSON.stringify(catalog);
  for (const legacyField of ['requestEnvelope', 'paramFields', 'resultFieldMap']) {
    assert.equal(serialized.includes(`"${legacyField}"`), false, `仍包含旧执行字段 ${legacyField}`);
  }
  for (const model of catalog.models) {
    for (const mode of model.modes) {
      assert.ok(mode.requestTemplate, `${model.id}/${mode.id} 缺少 requestTemplate`);
      assert.ok(
        mode.resultTextPath || mode.resultUrlPath || mode.resultBase64Path || mode.resultHexPath || mode.resultBody || mode.resultEndpoint,
        `${model.id}/${mode.id} 缺少结果路径`,
      );
      if (mode.isAsync) {
        assert.ok(mode.taskIdPath, `${model.id}/${mode.id} 缺少 taskIdPath`);
        assert.ok(mode.statusPath, `${model.id}/${mode.id} 缺少 statusPath`);
      }
    }
  }
});

test('媒体角色与首尾帧业务槽位保持分离', () => {
  const serializedCatalog = JSON.stringify(catalog);
  const serializedContract = JSON.stringify(agentContract);
  assert.equal(Object.hasOwn(agentContract.inputRoles, 'firstFrame'), false);
  assert.equal(Object.hasOwn(agentContract.inputRoles, 'lastFrame'), false);
  assert.ok(agentContract.commonProperties.inputMode.enum.includes('firstLastFrame'));
  assert.ok(agentContract.commonProperties.slot.enum.includes('firstFrame'));
  assert.ok(agentContract.commonProperties.slot.enum.includes('lastFrame'));
  assert.equal(serializedCatalog.includes('referenceCandidate'), false);
  assert.equal(serializedContract.includes('referenceCandidate'), false);
});

test('每个可接收素材的视频供应商 mode 显式声明画布输入语义', () => {
  for (const model of catalog.models.filter((item) => item.type === 'videoGeneration')) {
    for (const mode of model.modes) {
      const input = mode.inputConstraints || {};
      const hasMedia = (input.images?.max || 0) > 0 || (input.videos?.max || 0) > 0 || (input.audios?.max || 0) > 0;
      if (!hasMedia) continue;
      assert.ok(mode.inputMode, `${model.id}/${mode.id} 缺少 inputMode`);
      assert.ok(Array.isArray(mode.inputSlots) && mode.inputSlots.length, `${model.id}/${mode.id} 缺少 inputSlots`);
    }
  }
});

test('同一图片模型按输入模式使用独立接口契约', () => {
  const model = catalog.models.find((item) => item.id === 'gpt-image-2.5-sunburst');
  const textToImage = model.modes.find((mode) => mode.id === 'text-to-image');
  const imageToImage = model.modes.find((mode) => mode.id === 'image-to-image');
  assert.equal(textToImage.endpoint.path, '/images/generations');
  assert.equal(imageToImage.endpoint.path, '/images/edits');
  assert.equal(imageToImage.inputFormat, 'multipart');
  assert.equal(imageToImage.requestFields.multipartImage, 'image');
});

test('Agent 生成节点契约只使用顶层 prompt/model', () => {
  const spec = agentContract.actions.create_gen_node;
  assert.ok(spec.required.includes('prompt'));
  assert.ok(spec.required.includes('model'));
  assert.equal(spec.required.includes('recipeId'), false);
  assert.equal(spec.required.includes('config'), false);
  assert.ok(spec.fields.includes('prompt'));
  assert.ok(spec.fields.includes('model'));
  assert.ok(spec.fields.includes('recipeId'));
  assert.match(agentContract.commonProperties.config.description, /不得包含 prompt 或 model/);
});

test('模型地区限制错误转换为可操作的中文提示', () => {
  assert.equal(
    modelResponseError({ error: { message: 'Country, region, or territory not supported' } }, 403),
    '模型厂商不支持当前国家或地区，请切换其他已配置模型后重试',
  );
  assert.equal(
    modelResponseError({ error: { message: 'User location is not supported for the API use.' } }, 400),
    '模型厂商不支持当前国家或地区，请切换其他已配置模型后重试',
  );
});

test('请求模板里的 params 占位符都有同名目录参数', () => {
  // 未声明的参数会渲染成 undefined 并被静默丢弃，等于发了一个缺字段的请求。
  const orphan = [];
  const walk = (node, keys, where) => {
    if (typeof node === 'string') {
      for (const match of node.matchAll(/\{\{params\.([A-Za-z0-9_]+)\}\}/g)) {
        if (!keys.has(match[1])) orphan.push(`${where} → ${match[1]}`);
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item) => walk(item, keys, where));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) walk(value, keys, `${where}.${key}`);
    }
  };
  for (const model of catalog.models) {
    for (const mode of model.modes || []) {
      walk(mode.requestTemplate, new Set((mode.params || []).map((param) => param.key)), `${model.id}/${mode.id}`);
    }
  }
  assert.deepEqual(orphan, [], '模板引用了目录里不存在的参数，界面无法设置、请求里会被丢弃');
});

test('倍率型滑杆按目录声明的对数轨道映射，写回值仍是 step 量化后的真实值', () => {
  const volume = { key: 'volume', presentation: { control: 'slider', min: 0.1, max: 10, step: 0.1, scale: 'log' } };
  assert.deepEqual(sliderTrackDomain(volume), { min: 0, max: 1000, step: 1 });
  // 默认值 1 是 0.1–10 的几何中点：线性轨道上它停在 9%，看起来像一条空轨。
  assert.equal(sliderTrackPosition(volume, 1), 500);
  assert.equal(sliderTrackPosition(volume, 0.1), 0);
  assert.equal(sliderTrackPosition(volume, 10), 1000);
  assert.equal(sliderValueFromTrack(volume, 0), 0.1);
  assert.equal(sliderValueFromTrack(volume, 500), 1);
  assert.equal(sliderValueFromTrack(volume, 1000), 10);
  let previous = -1;
  for (let position = 0; position <= 1000; position += 1) {
    const value = sliderValueFromTrack(volume, position);
    assert.ok(value >= 0.1 && value <= 10, `轨道位置 ${position} 写出了越界值 ${value}`);
    assert.equal(Number((value * 10).toFixed(6)) % 1, 0, `轨道位置 ${position} 写出了 step 之外的 ${value}`);
    assert.ok(value >= previous, `轨道位置 ${position} 的值比上一格还小`);
    previous = value;
  }

  const pitch = { key: 'pitch', presentation: { control: 'slider', min: -12, max: 12, step: 1 } };
  assert.deepEqual(sliderTrackDomain(pitch), { min: -12, max: 12, step: 1 });
  assert.equal(sliderTrackPosition(pitch, 0), 0);
  assert.equal(sliderValueFromTrack(pitch, 7), 7);
  // min<=0 时取不了对数，即使误声明 scale:'log' 也必须退回线性轨道，不能算出 NaN。
  const wrong = { key: 'wrong', presentation: { control: 'slider', min: -12, max: 12, step: 1, scale: 'log' } };
  assert.deepEqual(sliderTrackDomain(wrong), { min: -12, max: 12, step: 1 });
  assert.ok(Number.isFinite(sliderTrackPosition(wrong, 0)));
});
