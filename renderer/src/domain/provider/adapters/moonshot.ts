import { t } from '../../../i18n/index.ts';
import { DeclarativeAdapter } from './declarative';

export const moonshotAdapter = new DeclarativeAdapter({
  id: 'moonshot',
  name: 'Moonshot Kimi',
  description: t("provider.copy.df53d63456"),
  iconId: 'moonshot',
  baseUrl: 'https://api.moonshot.ai/v1',
});
