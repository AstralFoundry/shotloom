import { DeclarativeAdapter } from './declarative';

export const zhipuAdapter = new DeclarativeAdapter({
  id: 'zhipu',
  name: '智谱 GLM',
  description: 'GLM / GLM-Image / CogVideoX 官方接口',
  iconId: 'zhipu',
  baseUrl: 'https://open.bigmodel.cn/api',
});
