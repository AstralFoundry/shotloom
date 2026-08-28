import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const registrySource = readFileSync(
  new URL('../renderer/src/domain/provider/ProviderRegistry.ts', import.meta.url),
  'utf8',
);
const catalogSource = readFileSync(
  new URL('../renderer/src/domain/catalog/ModelCatalog.ts', import.meta.url),
  'utf8',
);
const transportSource = readFileSync(
  new URL('../renderer/src/domain/provider/TransportRegistry.ts', import.meta.url),
  'utf8',
);
const runtimeSource = readFileSync(
  new URL('../renderer/src/agent/runtime/OpenCodeRuntime.ts', import.meta.url),
  'utf8',
);

test('StarRouter 是使用官方 /v1 地址和模型发现端点的内置供应商', () => {
  assert.match(registrySource, /id: 'starrouter'[\s\S]*defaultBaseUrl: 'https:\/\/starrouter\.io\/v1'/);
  assert.match(registrySource, /id: 'starrouter'[\s\S]*modelsPath: '\/models'/);
});

test('画布和 Agent 请求均使用目录声明的上游模型 ID', () => {
  assert.match(catalogSource, /upstreamModel: model\.upstreamModel \|\| model\.id/);
  assert.match(transportSource, /model: contract\.upstreamModel/);
  assert.match(runtimeSource, /id: info\.upstreamModel/);
});

test('StarRouter 内置目录覆盖文本、图片、视频和音频生成', () => {
  const catalog = JSON.parse(readFileSync(
    new URL('../renderer/src/config/model-catalog-v2.json', import.meta.url),
    'utf8',
  ));
  const models = catalog.models.filter((model) => model.provider === 'starrouter');
  const byType = Object.groupBy(models, (model) => model.type);
  assert.equal(byType.textGeneration.length, 8);
  assert.equal(byType.imageGeneration.length, 5);
  assert.equal(byType.videoGeneration.length, 6);
  assert.equal(byType.audioGeneration.length, 2);

  const openAiVideoModels = byType.videoGeneration.filter((model) => model.upstreamModel.startsWith('grok-imagine-video'));
  for (const model of openAiVideoModels) {
    const mode = model.modes[0];
    assert.equal(mode.endpoint.path, '/videos');
    assert.equal(mode.taskEndpoint.path, '/videos/{taskId}');
    assert.equal(mode.requestTemplate.input_reference, '{{imageInputReference}}');
    assert.equal(mode.resultEndpoint.path, '/videos/{taskId}/content');
    assert.equal(mode.resultDownloadAuth, true);
  }
  for (const model of byType.audioGeneration) {
    const mode = model.modes[0];
    assert.equal(mode.endpoint.path, '/audio/speech');
    assert.deepEqual(mode.resultBody, {
      encoding: 'binary', mimeType: 'audio/mpeg', fileExtension: 'mp3',
    });
  }
});

test('StarRouter GPT 5.5 使用官方上下文、输出长度和推理强度', () => {
  const catalog = JSON.parse(readFileSync(
    new URL('../renderer/src/config/model-catalog-v2.json', import.meta.url),
    'utf8',
  ));
  const model = catalog.models.find((candidate) => candidate.id === 'starrouter-gpt-5.5');
  const mode = model.modes[0];

  assert.equal(model.upstreamModel, 'gpt-5.5');
  assert.equal(mode.endpoint.path, '/chat/completions');
  assert.equal(mode.inputConstraints.text.maxTokens, 1_050_000);
  assert.equal(mode.outputConstraints.maxTokens, 128_000);
  assert.deepEqual(
    mode.params.find((param) => param.key === 'reasoningEffort').options,
    ['none', 'low', 'medium', 'high', 'xhigh'],
  );
  assert.equal(mode.requestTemplate.reasoning_effort, '{{params.reasoningEffort}}');
});

test('StarRouter Grok 图片模型只公开已验证可用的文生图协议', () => {
  const catalog = JSON.parse(readFileSync(
    new URL('../renderer/src/config/model-catalog-v2.json', import.meta.url),
    'utf8',
  ));
  const models = catalog.models.filter((model) => [
    'starrouter-grok-imagine-image',
    'starrouter-grok-imagine-image-quality',
  ].includes(model.id));

  assert.deepEqual(models.map((model) => model.upstreamModel), [
    'grok-imagine-image',
    'grok-imagine-image-quality',
  ]);
  for (const model of models) {
    assert.equal(model.defaultMode, 'text-to-image');
    assert.deepEqual(model.modes.map((mode) => mode.id), ['text-to-image']);
    assert.equal(model.modes[0].endpoint.path, '/images/generations');
    assert.equal(model.modes[0].inputConstraints.images.max, 0);
  }
});

test('StarRouter Seedance 保留显式输入槽位并使用火山中转任务端点', () => {
  const catalog = JSON.parse(readFileSync(
    new URL('../renderer/src/config/model-catalog-v2.json', import.meta.url),
    'utf8',
  ));
  const models = catalog.models.filter((model) => model.id.startsWith('starrouter-doubao-seedance-2-0'));

  assert.deepEqual(models.map((model) => model.upstreamModel), [
    'doubao-seedance-2-0-260128',
    'doubao-seedance-2-0-fast-260128',
    'doubao-seedance-2-0-mini-260615',
  ]);
  for (const model of models) {
    for (const mode of model.modes) {
      assert.equal(mode.endpoint.path, '/volcengine/doubao/contents/generations/tasks');
      assert.equal(mode.taskEndpoint.path, '/volcengine/doubao/contents/generations/tasks/{taskId}');
    }
    const referenceMode = model.modes.find((mode) => mode.inputMode === 'reference');
    assert.deepEqual(referenceMode.inputSlots, ['reference', 'inputVideo', 'referenceAudio']);
    assert.deepEqual(referenceMode.inputVariants[0].inputSlots, ['firstFrame', 'lastFrame']);
    assert.equal(referenceMode.inputVariants[0].requestFields.firstFrameImageContentRole, 'first_frame');
    assert.equal(referenceMode.inputVariants[0].requestFields.lastFrameImageContentRole, 'last_frame');
  }
});
