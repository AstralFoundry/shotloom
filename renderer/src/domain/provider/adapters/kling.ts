import { t } from '../../../i18n/index.ts';
import { DeclarativeAdapter } from './declarative';

export const klingAdapter = new DeclarativeAdapter({
  id: 'kling',
  name: t("provider.copy.e02a40e389"),
  description: t("provider.copy.74ac6cdc3e"),
  iconId: 'kling',
  baseUrl: 'https://api-singapore.klingai.com',
});
