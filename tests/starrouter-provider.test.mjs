import { loadModelCatalog } from './helpers/modelCatalog.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { optionLabel } from '../renderer/src/utils/modelPresentation.js';

const adaptersIndexSource = readFileSync(
  new URL('../renderer/src/domain/provider/adapters/index.ts', import.meta.url),
  'utf8',
);
const adapterSource = (name) => readFileSync(
  new URL(`../renderer/src/domain/provider/adapters/${name}.ts`, import.meta.url),
  'utf8',
);
const catalogSource = readFileSync(
  new URL('../renderer/src/domain/catalog/ModelCatalog.ts', import.meta.url),
  'utf8',
);
const loopRequestSource = readFileSync(
  new URL('../renderer/src/agent/loop/modelRequest.ts', import.meta.url),
  'utf8',
);
const catalogJson = loadModelCatalog();
const starrouterAdapter = adapterSource('starrouter');

test('StarRouter 适配器声明官方地址并在注册表中唯一登记', () => {
  assert.match(starrouterAdapter, /id: 'starrouter'/);
  assert.match(starrouterAdapter, /baseUrl: 'https:\/\/starrouter\.io\/v1'/);
  assert.match(adaptersIndexSource, /import \{ starrouterAdapter \} from '\.\/starrouter'/);
  assert.equal(
    [...adaptersIndexSource.matchAll(/starrouterAdapter/g)].length,
    2,
    'StarRouter 只能在 import 与登记数组中各出现一次',
  );
});

test('未登记的厂商没有适配器可执行', () => {
  assert.match(
    adaptersIndexSource,
    /没有内置厂商适配器[\s\S]*domain\/provider\/adapters/,
  );
});

test('画布和 Agent 请求均使用目录声明的上游模型 ID', () => {
  assert.match(catalogSource, /upstreamModel: model\.upstreamModel \|\| model\.id/);
  assert.match(adapterSource('declarative'), /model: contract\.upstreamModel/);
  assert.match(loopRequestSource, /upstreamModel: info\.upstreamModel/);
});

test('StarRouter 内置目录覆盖文本、图片、视频和音频生成', () => {
  const models = catalogJson.models.filter((model) => model.provider === 'starrouter');
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
  const model = catalogJson.models.find((candidate) => candidate.id === 'starrouter-gpt-5.5');
  const mode = model.modes[0];

  assert.equal(model.upstreamModel, 'gpt-5.5');
  assert.equal(mode.endpoint.path, '/chat/completions');
  assert.equal(mode.inputConstraints.text.maxTokens, 1_050_000);
  assert.equal(mode.outputConstraints.maxTokens, 128_000);
  const reasoningEffort = mode.params.find((param) => param.key === 'reasoningEffort');
  assert.deepEqual(reasoningEffort.options, ['none', 'low', 'medium', 'high', 'xhigh']);
  assert.deepEqual(reasoningEffort.options.map((value) => optionLabel(reasoningEffort, value)),
    ['关闭', '低', '中', '高', '极高']);
  assert.equal(mode.requestTemplate.reasoning_effort, '{{params.reasoningEffort}}');
  assert.deepEqual(mode.agent.requestOptions, { reasoningEffort: 'none' });
});

test('StarRouter Grok 图片模型只公开已验证可用的文生图协议', () => {
  const models = catalogJson.models.filter((model) => [
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
  const models = catalogJson.models.filter((model) => model.id.startsWith('starrouter-doubao-seedance-2-0'));

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
