import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { modelResponseError } from '../renderer/src/utils/modelResponseParsing.mjs';
import { renderProtocolTemplate } from '../renderer/src/utils/modelProtocol.mjs';

const catalog = JSON.parse(readFileSync(new URL('../renderer/src/config/model-catalog-v2.json', import.meta.url), 'utf8'));
const agentContract = JSON.parse(readFileSync(new URL('../renderer/src/config/agent-action-contract.json', import.meta.url), 'utf8'));

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
        if (mode.outputConstraints.supportsToolCalls) {
          assert.equal(mode.requestTemplate.messages, '{{messages}}');
          assert.equal(mode.requestTemplate.tools, '{{tools}}');
          assert.equal(mode.requestTemplate.tool_choice, '{{toolChoice}}');
        } else {
          assert.equal(model.provider, 'anthropic');
          assert.equal(mode.requestTemplate.messages, '{{nonSystemMessages}}');
          assert.equal(mode.requestTemplate.system, '{{system}}');
        }
      }
      assert.ok(Array.isArray(mode.params));
      if (mode.isAsync) assert.ok(mode.taskEndpoint?.path?.includes('{taskId}'));
      for (const param of mode.params) {
        if (!Array.isArray(param.options) || !param.options.length) continue;
        assert.ok(param.options.includes(param.default), `${model.id}/${mode.id}/${param.key} 默认值不在 options 中`);
      }
    }
  }
});

test('GPT 5.6 的工具请求显式关闭 Chat Completions 推理', () => {
  const model = catalog.models.find((item) => item.id === 'gpt-5.6');
  assert.ok(model);
  for (const mode of model.modes) {
    assert.equal(mode.requestTemplate.reasoning_effort, '{{reasoningEffort}}');
    assert.equal(renderProtocolTemplate(mode.requestTemplate, {
      model: model.id,
      messages: [{ role: 'user', content: '测试' }],
      reasoningEffort: 'none',
      tools: [{ type: 'function', function: { name: 'test' } }],
      toolChoice: 'auto',
      params: {},
    }).reasoning_effort, 'none');
    assert.equal(Object.hasOwn(renderProtocolTemplate(mode.requestTemplate, {
      model: model.id,
      messages: [{ role: 'user', content: '测试' }],
      tools: undefined,
      params: {},
    }), 'reasoning_effort'), false);
  }
});

test('GPT Image 2 用真实 size 参数提供统一比例选项', () => {
  const model = catalog.models.find((item) => item.id === 'gpt-image-2');
  for (const mode of model.modes) {
    const size = mode.params.find((param) => param.key === 'size');
    assert.equal(size.presentation, 'aspectRatio');
    assert.equal(size.optionLabels['1536x864'], '16:9');
    assert.ok(size.options.includes('1536x864'));
    assert.equal(mode.requestTemplate.size, '{{params.size}}');
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

test('内置目录只包含已按官方接口核实的当前模型', () => {
  const ids = new Set(catalog.models.map((model) => model.id));
  for (const id of [
    'gpt-5.6', 'gpt-image-2', 'gemini-3.6-flash', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-image',
    'veo-3.1-generate-preview', 'grok-4.5', 'grok-imagine-image-quality',
    'veo-3.1-fast-generate-preview', 'veo-3.1-lite-generate-preview',
    'grok-imagine-video', 'grok-imagine-video-1.5', 'claude-sonnet-5',
    'qwen3.7-plus', 'qwen-image-2.0-pro',
    'deepseek-v4-pro', 'kimi-k3', 'glm-5.2', 'glm-image', 'cogvideox-3',
    'doubao-seedance-2-0-260128', 'doubao-seedance-2-0-fast-260128',
    'doubao-seedance-2-0-mini-260615',
    'MiniMax-H3',
    'kling-3.0-turbo', 'kling-3.0', 'kling-3.0-omni',
  ]) assert.equal(ids.has(id), true, `缺少内置模型 ${id}`);
  for (const removed of ['gpt-5.5', 'gemini-3.5-flash', 'gemini-3.1-pro', 'kling-v3', 'happyhorse-1.1-t2v']) {
    assert.equal(ids.has(removed), false, `仍保留未经本轮官方核实的旧模型 ${removed}`);
  }
});

test('MiniMax H3 使用官方 Video Generation V2 任务协议', () => {
  const model = catalog.models.find((item) => item.id === 'MiniMax-H3');
  assert.equal(model.provider, 'minimax');
  assert.deepEqual(model.modes.map((mode) => mode.id), ['text-to-video', 'first-frame-to-video']);
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
  assert.equal(turboImage.requestFields.imageContentFormat, 'kling-first-frame');
  assert.deepEqual(renderProtocolTemplate(turboImage.requestTemplate, {
    klingContents: [
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
  assert.equal(omniMode.requestFields.imageContentFormat, 'kling-references');
  assert.deepEqual(renderProtocolTemplate(omniMode.requestTemplate, {
    klingContents: [
      { type: 'prompt', text: '让 image_1 和 image_2 同框' },
      { type: 'refer_image', url: 'https://example.com/a.png', id: 'image_1' },
      { type: 'refer_image', url: 'https://example.com/b.png', id: 'image_2' },
    ],
    resolution: '720p', aspectRatio: '16:9', duration: 5,
    params: { audio: 'off', multiShot: true, watermark: false },
  }).contents[2], { type: 'refer_image', url: 'https://example.com/b.png', id: 'image_2' });
});

test('Seedance 2.0 Fast/Mini 按官方规格限制为 480p/720p', () => {
  for (const id of ['doubao-seedance-2-0-fast-260128', 'doubao-seedance-2-0-mini-260615']) {
    const model = catalog.models.find((item) => item.id === id);
    assert.equal(model.provider, 'bytedance');
    const mode = model.modes.find((item) => item.id === 'text-or-reference-image-to-video');
    assert.deepEqual(mode.inputConstraints.images, { min: 0, max: 9, roles: ['referenceImage'] });
    assert.deepEqual(mode.inputConstraints.videos, {
      min: 0, max: 3, roles: ['inputVideo'], formats: ['mp4', 'mov'],
    });
    assert.deepEqual(mode.inputConstraints.audios, {
      min: 0, max: 3, roles: ['referenceAudio'], formats: ['wav', 'mp3'],
      minDuration: 2, maxDuration: 15, maxTotalDuration: 15, maxBytes: 15728640,
      requiresAnyOf: ['images', 'videos'],
    });
    assert.deepEqual(mode.outputConstraints.durations, [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    assert.deepEqual(mode.params.find((param) => param.key === 'resolution').options, ['480p', '720p']);
    assert.equal(mode.requestFields.imageContentRole, 'reference_image');
    assert.equal(mode.resultUrlPath, 'content.video_url');
  }
});

test('Seedance 2.0 使用方舟官方视频任务协议', () => {
  const model = catalog.models.find((item) => item.id === 'doubao-seedance-2-0-260128');
  assert.equal(model.provider, 'bytedance');
  assert.deepEqual(model.modes.map((mode) => mode.id), ['text-to-video', 'omni-reference-to-video']);
  for (const mode of model.modes) {
    assert.deepEqual(mode.endpoint, { method: 'POST', path: '/contents/generations/tasks', scope: 'root' });
    assert.deepEqual(mode.taskEndpoint, { method: 'GET', path: '/contents/generations/tasks/{taskId}', scope: 'root' });
    assert.equal(mode.requestTemplate.content, '{{content}}');
    assert.equal(mode.taskIdPath, 'id');
    assert.equal(mode.statusPath, 'status');
    assert.equal(mode.resultUrlPath, 'content.video_url');
  }
  const referenceMode = model.modes.find((mode) => mode.id === 'omni-reference-to-video');
  assert.deepEqual(referenceMode.inputVariants.map((variant) => variant.inputMode), ['firstLastFrame']);
  assert.deepEqual(referenceMode.inputConstraints.images, { min: 0, max: 9, roles: ['referenceImage'] });
  assert.deepEqual(referenceMode.inputConstraints.videos, {
    min: 0, max: 3, roles: ['inputVideo'], formats: ['mp4', 'mov'],
  });
  assert.deepEqual(referenceMode.inputConstraints.audios, {
    min: 0, max: 3, roles: ['referenceAudio'], formats: ['wav', 'mp3'],
    minDuration: 2, maxDuration: 15, maxTotalDuration: 15, maxBytes: 15728640,
    requiresAnyOf: ['images', 'videos'],
  });
  assert.equal(referenceMode.requestFields.imageContentRole, 'reference_image');
  assert.equal(referenceMode.requestFields.videoContentRole, 'reference_video');
  assert.equal(referenceMode.requestFields.audioContentRole, 'reference_audio');
});

test('Grok Imagine Video 和全部 Veo 3.1 模型实际编译单图生视频', () => {
  const grok = catalog.models.find((item) => item.id === 'grok-imagine-video');
  const grokMode = grok.modes.find((mode) => mode.id === 'text-or-image-to-video');
  assert.deepEqual(grokMode.inputConstraints.images, { min: 0, max: 1, roles: ['referenceImage'] });
  assert.equal(grokMode.requestTemplate.image, '{{imageObject}}');
  assert.equal(Object.hasOwn(renderProtocolTemplate(grokMode.requestTemplate, {
    model: grok.id, prompt: '纯文本', duration: 8, aspectRatio: '16:9', resolution: '720p',
  }), 'image'), false);
  assert.deepEqual(renderProtocolTemplate(grokMode.requestTemplate, {
    model: grok.id, prompt: '图生视频', imageObject: { url: 'https://example.com/input.png' },
    duration: 8, aspectRatio: '16:9', resolution: '720p',
  }).image, { url: 'https://example.com/input.png' });

  for (const id of [
    'veo-3.1-generate-preview',
    'veo-3.1-fast-generate-preview',
    'veo-3.1-lite-generate-preview',
  ]) {
    const model = catalog.models.find((item) => item.id === id);
    const mode = model.modes.find((item) => item.id === 'text-or-image-to-video');
    assert.deepEqual(mode.inputConstraints.images, { min: 0, max: 1, roles: ['referenceImage'] });
    assert.equal(mode.requestFields.imageContentFormat, 'google-inline');
    assert.equal(mode.requestTemplate.instances[0].image, '{{inlineImage}}');
    assert.deepEqual(renderProtocolTemplate(mode.requestTemplate, {
      prompt: '纯文本', duration: 8, aspectRatio: '16:9',
    }).instances, [{ prompt: '纯文本' }]);
    assert.deepEqual(renderProtocolTemplate(mode.requestTemplate, {
      prompt: '图生视频', duration: 8, aspectRatio: '16:9',
      inlineImage: { bytesBase64Encoded: 'aGVsbG8=', mimeType: 'image/png' },
    }).instances[0].image, { bytesBase64Encoded: 'aGVsbG8=', mimeType: 'image/png' });
  }
});

test('内置模型只使用唯一声明式执行协议', () => {
  const serialized = JSON.stringify(catalog);
  for (const legacyField of ['requestEnvelope', 'paramFields', 'resultFieldMap']) {
    assert.equal(serialized.includes(`"${legacyField}"`), false, `仍包含旧执行字段 ${legacyField}`);
  }
  for (const model of catalog.models) {
    for (const mode of model.modes) {
      assert.ok(mode.requestTemplate, `${model.id}/${mode.id} 缺少 requestTemplate`);
      assert.ok(mode.resultTextPath || mode.resultUrlPath || mode.resultBase64Path, `${model.id}/${mode.id} 缺少结果路径`);
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
  const model = catalog.models.find((item) => item.id === 'gpt-image-2');
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
  assert.ok(spec.required.includes('recipeId'));
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
