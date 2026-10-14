import { DeclarativeAdapter } from './declarative';

export const klingAdapter = new DeclarativeAdapter({
  id: 'kling',
  name: 'Kling AI（可灵）',
  description: '可灵 3.0 系列官方视频生成接口',
  iconId: 'kling',
  baseUrl: 'https://api-singapore.klingai.com',
});
