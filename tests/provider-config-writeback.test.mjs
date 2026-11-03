/**
 * 加载设置后必须把适配器算出的生效地址回写磁盘：Rust 网关生成时只读设置文件里的
 * baseUrl，不回写就会读到缺失地址。这里跑真实的 loadAppSettings，验证的是
 * "不一致写一次、一致不写"这条行为，而不是某个厂商的地址常量。
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env;
let desktopApi;
let settingsStore;
let normalizeProviderConfigs;

before(async () => {
  env = await createRendererEnv({ storage: new Map(), withWindow: true });
  desktopApi = (await env.load('services/desktopApi')).desktopApi;
  settingsStore = await env.load('store/settingsStore');
  ({ normalizeProviderConfigs } = await env.load('domain/provider/ProviderConfig'));
});

after(async () => {
  await env?.dispose();
});

/**
 * 把原生设置桥换成内存替身，并记录每一次 set 调用。
 * @param {object} stored 磁盘上现有的设置内容
 */
function stubSettingsBridge(stored) {
  const written = [];
  const previous = {
    platform: desktopApi.platform,
    get: desktopApi.settings.get,
    set: desktopApi.settings.set,
    ensureRoot: desktopApi.project.ensureRoot,
  };
  desktopApi.platform = 'desktop';
  desktopApi.project.ensureRoot = async (rootDir) => rootDir;
  desktopApi.settings.get = async () => ({ ...stored });
  desktopApi.settings.set = async (patch) => {
    written.push(JSON.parse(JSON.stringify(patch)));
    return { ...stored, ...patch };
  };
  return {
    written,
    restore() {
      desktopApi.platform = previous.platform;
      desktopApi.settings.get = previous.get;
      desktopApi.settings.set = previous.set;
      desktopApi.project.ensureRoot = previous.ensureRoot;
    },
  };
}

test('磁盘上没有生效地址时，加载设置会把规范化后的地址写回一次', async () => {
  const bridge = stubSettingsBridge({ providerConfigs: { openai: { apiKey: 'sk-openai', baseUrl: '' } } });
  try {
    await settingsStore.loadAppSettings();
  } finally {
    bridge.restore();
  }

  assert.equal(bridge.written.length, 1, '不一致必须回写一次');
  const written = bridge.written[0].providerConfigs;
  assert.equal(written.openai.baseUrl, 'https://api.openai.com/v1');
  assert.equal(written.openai.apiKey, 'sk-openai');
  assert.deepEqual(Object.keys(written).sort(), Object.keys(normalizeProviderConfigs({})).sort(),
    '回写的必须是完整的内置厂商表，而不是只有出现过的那一个');
  assert.equal(settingsStore.settingsStore.providerConfigs.openai.baseUrl, 'https://api.openai.com/v1');
});

test('磁盘值已经等于生效值时不再回写，避免每次启动都改设置文件', async () => {
  const stored = { providerConfigs: normalizeProviderConfigs({ openai: { apiKey: 'sk-openai' } }) };
  const bridge = stubSettingsBridge(stored);
  try {
    await settingsStore.loadAppSettings();
  } finally {
    bridge.restore();
  }

  assert.deepEqual(bridge.written, [], '已经规范化的设置不该再写盘');
});

test('陈旧地址与生效地址不一致时按用户覆盖为准回写', async () => {
  const bridge = stubSettingsBridge({
    providerConfigs: { openai: { apiKey: 'sk', baseUrl: 'https://relay.example.com/v1/' } },
  });
  try {
    await settingsStore.loadAppSettings();
  } finally {
    bridge.restore();
  }

  assert.equal(bridge.written.length, 1);
  assert.equal(bridge.written[0].providerConfigs.openai.baseUrl, 'https://relay.example.com/v1',
    '结尾斜杠要去掉，否则原生层拼出的地址带双斜杠');
});
