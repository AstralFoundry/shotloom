import { t } from '../../../i18n/index.ts';
import { DeclarativeAdapter } from './declarative';

export const openaiAdapter = new DeclarativeAdapter({
  id: 'openai',
  name: 'OpenAI',
  description: t("provider.copy.c0ea3b5ffe"),
  iconId: 'openai',
  baseUrl: 'https://api.openai.com/v1',
});
