import { t } from '../../../i18n/index.ts';
import { DeclarativeAdapter } from './declarative';

export const anthropicAdapter = new DeclarativeAdapter({
  id: 'anthropic',
  name: 'Anthropic Claude',
  description: t("provider.copy.61d2e219a5"),
  iconId: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
});
