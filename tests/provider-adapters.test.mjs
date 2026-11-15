import { loadModelCatalog } from './helpers/modelCatalog.mjs';
/**
 * 厂商适配器注册表契约：厂商与模型来自已启用的插件登记。
 *
 * 注册表是 fail-closed 的（和 Agent 工具白名单一样）：未登记的厂商既没有界面入口，
 * 也没有可执行的传输层；已停用或卸载厂商的凭据保留，供重新启用和历史任务使用。
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { createRendererEnv } from './helpers/rendererSsr.mjs';
import { readSource } from './helpers/sourceContract.mjs';

const catalogJson = loadModelCatalog();

let env;
let getProviderAdapter;
let getProviderAdapters;
let findProviderAdapter;
let resolveProviderBaseUrl;
let normalizeProviderConfigs;
let getProviderModelRows;

before(async () => {
  env = await createRendererEnv();
  ({ getProviderAdapter, getProviderAdapters, findProviderAdapter, resolveProviderBaseUrl } =
    await env.load('domain/provider/adapters/index'));
  ({ normalizeProviderConfigs } = await env.load('domain/provider/ProviderConfig'));
  ({ getProviderModelRows } = await env.load('domain/provider/ModelAvailability'));
});

after(async () => {
  await env?.dispose();
});

test('每个内置厂商只有一个适配器，且覆盖目录里出现的厂商', () => {
  const adapters = getProviderAdapters();
  const ids = adapters.map((adapter) => adapter.id);
  assert.equal(new Set(ids).size, ids.length, '同一厂商不能登记两次');
  assert.ok(adapters.every((adapter) => adapter.name && adapter.description && adapter.iconId));
  for (const provider of new Set(catalogJson.models.map((model) => model.provider))) {
    assert.ok(findProviderAdapter(provider), `目录厂商 ${provider} 必须有登记的适配器`);
  }
});

test('未登记的厂商在执行时直接失败，不回落到通用协议', () => {
  assert.equal(findProviderAdapter('my-proxy'), undefined);
  assert.throws(() => getProviderAdapter('my-proxy'), /未找到[\s\S]*已启用插件[\s\S]*插件中心/);
});

test('品牌图标打包在应用内，StarRouter 用官方 logo 资源', async () => {
  const { getProviderIcon, PROVIDER_ICON_OPTIONS } = await env.load('domain/provider/ProviderBrandIcons');
  const starrouter = getProviderIcon('starrouter');
  assert.equal(starrouter.label, 'StarRouter');
  assert.match(starrouter.src, /assets\/provider-icons\/starrouter\.png$/);
  // 运行时不依赖在线图片服务：任何厂商图标都必须是本地打包资源。
  for (const icon of PROVIDER_ICON_OPTIONS) {
    assert.doesNotMatch(icon.src, /^https?:\/\//, `${icon.id} 的图标不得引用在线地址`);
  }
});

test('地址默认取适配器声明值，用户覆盖优先且去掉结尾斜杠', () => {
  const openai = getProviderAdapter('openai');
  assert.equal(resolveProviderBaseUrl(openai, {}), 'https://api.openai.com/v1');
  assert.equal(
    resolveProviderBaseUrl(openai, { baseUrl: 'https://relay.example.com/v1/' }),
    'https://relay.example.com/v1',
  );
});

test('只有 Qwen 百炼没有可内置的地址，必须由用户填写', () => {
  const required = getProviderAdapters().filter((adapter) => adapter.baseUrlRequired);
  assert.deepEqual(required.map((adapter) => adapter.id), ['qwen']);
  assert.equal(resolveProviderBaseUrl(getProviderAdapter('qwen'), {}), '');
});

test('设置保留已停用或缺失厂商凭据，但不保留废弃展示字段', () => {
  const stored = normalizeProviderConfigs({
    openai: {
      apiKey: '  sk-openai  ',
      baseUrl: '',
      displayName: 'My OpenAI',
      iconId: 'custom-icon',
      custom: true,
      models: [{ id: 'fake-model' }],
      disabledModelIds: ['gpt-image-2'],
    },
    'legacy-provider': { apiKey: 'sk-legacy' },
  });
  for (const config of Object.values(stored)) {
    assert.deepEqual(Object.keys(config).sort(), ['apiKey', 'baseUrl']);
  }
  assert.equal(stored.openai.apiKey, 'sk-openai');
  assert.equal(stored.openai.baseUrl, 'https://api.openai.com/v1');
  assert.equal(stored['legacy-provider'].apiKey, 'sk-legacy');
  assert.deepEqual(Object.keys(stored).sort(), [...getProviderAdapters().map((a) => a.id), 'legacy-provider'].sort());
});

test('运行入口按厂商 id 取适配器，模型任务不再自行拼接地址', () => {
  const taskService = readSource('renderer/src/services/modelTaskService.ts');
  assert.match(taskService, /getProviderAdapter\(modelContract\.provider, modelContract\.pluginRef\)\s*\.poll/);
  assert.doesNotMatch(taskService, /getProviderTransport|normalizeRemoteTask|desktopApi\.model\./);
});

test('厂商模型清单逐条来自目录声明，输入模态不靠模型名猜测', () => {
  const rows = getProviderModelRows('bytedance');
  assert.deepEqual(
    rows.map((row) => row.id).sort(),
    catalogJson.models.filter((model) => model.provider === 'bytedance').map((model) => model.id).sort(),
    '清单必须等于该厂商在目录里登记的全部模型',
  );
  assert.equal(rows.find(row => row.id === 'doubao-seedance-2-5-260628').typeLabel, '视频生成');
  assert.deepEqual(rows.find(row => row.id === 'doubao-seedance-2-5-260628').inputs, ['image', 'video', 'audio'], 'Seedance 的三种媒体输入都要来自 inputConstraints');

  const googleRows = getProviderModelRows('google');
  assert.deepEqual(
    googleRows.map((row) => [row.type, row.id, row.inputs]),
    [
      ['imageGeneration', 'gemini-nano-banana-2.1', ['image']],
      ['imageGeneration', 'gemini-3.1-flash-lite-image', ['image']],
      ['imageGeneration', 'gemini-3-pro-image', ['image']],
      ['videoGeneration', 'veo-3.1-generate-preview', []],
      ['textGeneration', 'gemini-3.8-flash', ['image']],
      ['textGeneration', 'gemini-3.1-pro-preview', []],
    ],
    '只有目录声明了媒体输入的模型才能有多模态徽标；Gemini Flash 文本模式现在声明了图片输入',
  );

  const anthropic = getProviderModelRows('anthropic');
  assert.deepEqual(
    anthropic.map((row) => row.id),
    ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    '清单包含已登记的 Opus、Sonnet 和 Haiku，保留稳定模型 ID',
  );
  assert.ok(anthropic.every((row) => row.inputs.length === 0 && row.agentReady === true),
    '声明了 Messages 工具协议的模型必须可用于 Agent');
  assert.ok(getProviderModelRows('openai').some((row) => row.agentReady),
    '目录声明了 Agent 协议的文本模型必须可用于 Agent');
});

test('清单按生成类型分组，未登记厂商没有模型行', () => {
  const types = getProviderModelRows('starrouter').map((row) => row.type);
  assert.deepEqual([...new Set(types)], ['imageGeneration', 'videoGeneration', 'audioGeneration', 'textGeneration'],
    '分组顺序必须来自目录的类型顺序');
  assert.deepEqual(getProviderModelRows('my-proxy'), []);
});
