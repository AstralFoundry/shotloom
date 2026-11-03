import { t } from '../../../i18n/index.ts';
import { DeclarativeAdapter } from './declarative';

export const starrouterAdapter = new DeclarativeAdapter({
  id: 'starrouter',
  name: 'StarRouter',
  description: t("provider.copy.f50a8667a9"),
  iconId: 'starrouter',
  baseUrl: 'https://starrouter.io/v1',
});
