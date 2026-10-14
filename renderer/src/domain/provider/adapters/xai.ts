import { DeclarativeAdapter } from './declarative';

export const xaiAdapter = new DeclarativeAdapter({
  id: 'xai',
  name: 'xAI',
  description: 'Grok 模型服务',
  iconId: 'xai',
  baseUrl: 'https://api.x.ai/v1',
});
