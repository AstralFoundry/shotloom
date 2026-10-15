import manifest from '../model-catalog-v2.json';
import anthropic from './anthropic.json';
import bytedance from './bytedance.json';
import deepseek from './deepseek.json';
import google from './google.json';
import kling from './kling.json';
import minimax from './minimax.json';
import moonshot from './moonshot.json';
import openai from './openai.json';
import qwen from './qwen.json';
import runninghub from './runninghub.json';
import starrouter from './starrouter.json';
import xai from './xai.json';
import zhipu from './zhipu.json';

const providerFiles: Record<string, { provider: string; models: Array<{ id: string; provider: string }> }> = {
  anthropic, bytedance, deepseek, google, kling, minimax, moonshot,
  openai, qwen, runninghub, starrouter, xai, zhipu,
};

// The manifest declares registration and global order; each provider file owns its model capabilities.
if (new Set(manifest.providers).size !== manifest.providers.length ||
    manifest.providers.length !== Object.keys(providerFiles).length ||
    manifest.providers.some((provider) => !providerFiles[provider])) {
  throw new Error('模型目录厂商索引与厂商文件不一致');
}

const models = manifest.providers.flatMap((provider) => {
  const file = providerFiles[provider];
  if (file.provider !== provider || file.models.some((model) => model.provider !== provider)) {
    throw new Error(`模型目录厂商文件归属不匹配：${provider}`);
  }
  return file.models;
});
const byId = new Map(models.map((model) => [model.id, model]));
if (byId.size !== models.length || new Set(manifest.modelOrder).size !== manifest.modelOrder.length ||
    manifest.modelOrder.length !== models.length ||
    manifest.modelOrder.some((id) => !byId.has(id))) {
  throw new Error('模型目录存在重复、缺失或未登记的模型 ID');
}

export const modelCatalogV2 = {
  ...manifest,
  models: manifest.modelOrder.map((id) => byId.get(id)!),
};
