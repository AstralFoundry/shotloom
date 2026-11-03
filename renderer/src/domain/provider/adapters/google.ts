import { t } from '../../../i18n/index.ts';
import { DeclarativeAdapter } from './declarative';

export const googleAdapter = new DeclarativeAdapter({
  id: 'google',
  name: 'Google Gemini',
  description: t("provider.copy.aa9b734d17"),
  iconId: 'gemini',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
});
