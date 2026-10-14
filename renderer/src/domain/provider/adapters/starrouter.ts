import { DeclarativeAdapter } from './declarative';

export const starrouterAdapter = new DeclarativeAdapter({
  id: 'starrouter',
  name: 'StarRouter',
  description: 'OpenAI 兼容的多模型中转服务',
  iconId: 'starrouter',
  baseUrl: 'https://starrouter.io/v1',
});
