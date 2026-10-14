import { DeclarativeAdapter } from './declarative';

export const googleAdapter = new DeclarativeAdapter({
  id: 'google',
  name: 'Google Gemini',
  description: 'Gemini / Imagen / Veo 官方接口',
  iconId: 'gemini',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
});
