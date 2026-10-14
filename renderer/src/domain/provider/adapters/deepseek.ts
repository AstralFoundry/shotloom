import { DeclarativeAdapter } from './declarative';

export const deepseekAdapter = new DeclarativeAdapter({
  id: 'deepseek',
  name: 'DeepSeek',
  description: 'DeepSeek 模型服务',
  iconId: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
});
