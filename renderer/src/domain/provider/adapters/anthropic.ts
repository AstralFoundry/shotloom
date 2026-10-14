import { DeclarativeAdapter } from './declarative';

export const anthropicAdapter = new DeclarativeAdapter({
  id: 'anthropic',
  name: 'Anthropic Claude',
  description: 'Claude 官方 Messages API',
  iconId: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
});
