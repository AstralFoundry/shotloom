import { readFileSync } from 'node:fs';

export function loadModelCatalog() {
  const manifest = JSON.parse(readFileSync(new URL('../../renderer/src/config/model-catalog-v2.json', import.meta.url), 'utf8'));
  const files = manifest.providers.map((provider) => JSON.parse(readFileSync(
    new URL(`../../renderer/src/config/model-catalog-v2/${provider}.json`, import.meta.url), 'utf8',
  )));
  const models = files.flatMap((file, index) => {
    if (file.provider !== manifest.providers[index] || file.models.some((model) => model.provider !== file.provider)) {
      throw new Error(`厂商模型文件归属不匹配：${manifest.providers[index]}`);
    }
    return file.models;
  });
  const byId = new Map(models.map((model) => [model.id, model]));
  if (new Set(manifest.providers).size !== manifest.providers.length ||
      byId.size !== models.length || new Set(manifest.modelOrder).size !== manifest.modelOrder.length ||
      manifest.modelOrder.length !== models.length ||
      manifest.modelOrder.some((id) => !byId.has(id))) {
    throw new Error('模型目录存在重复、缺失或未登记的模型 ID');
  }
  return { ...manifest, models: manifest.modelOrder.map((id) => byId.get(id)) };
}
