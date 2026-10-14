import { DeclarativeAdapter } from './declarative';

export const moonshotAdapter = new DeclarativeAdapter({
  id: 'moonshot',
  name: 'Moonshot Kimi',
  description: 'Kimi 官方 OpenAI 兼容接口',
  iconId: 'moonshot',
  baseUrl: 'https://api.moonshot.ai/v1',
});
