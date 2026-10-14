import { DeclarativeAdapter } from './declarative';

/** Qwen 百炼按工作空间开放接口，没有可内置的地址，必须由用户填写。 */
export const qwenAdapter = new DeclarativeAdapter({
  id: 'qwen',
  name: '阿里云百炼 Qwen',
  description: 'Qwen 文本与图片官方工作空间接口',
  iconId: 'qwen',
  baseUrl: '',
  baseUrlRequired: true,
});
