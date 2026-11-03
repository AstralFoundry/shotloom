import { t } from '../../../i18n/index.ts';
import { DeclarativeAdapter } from './declarative';

export const xaiAdapter = new DeclarativeAdapter({
  id: 'xai',
  name: 'xAI',
  description: t("provider.copy.4db3a24b78"),
  iconId: 'xai',
  baseUrl: 'https://api.x.ai/v1',
});
