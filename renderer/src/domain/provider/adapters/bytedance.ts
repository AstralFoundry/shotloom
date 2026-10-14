import { DeclarativeAdapter } from './declarative';

export const bytedanceAdapter = new DeclarativeAdapter({
  id: 'bytedance',
  name: 'Seedance（火山方舟）',
  description: 'Seedance 官方模型服务；模型 ID 以方舟控制台实际开放项为准',
  iconId: 'volcengine',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
});
