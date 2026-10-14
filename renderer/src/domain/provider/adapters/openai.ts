import { DeclarativeAdapter } from './declarative';

export const openaiAdapter = new DeclarativeAdapter({
  id: 'openai',
  name: 'OpenAI',
  description: 'GPT / GPT Image 官方接口',
  iconId: 'openai',
  baseUrl: 'https://api.openai.com/v1',
});
