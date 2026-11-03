import { t } from '../../../i18n/index.ts';
import { DeclarativeAdapter } from './declarative';

export const minimaxAdapter = new DeclarativeAdapter({
  id: 'minimax',
  name: 'MiniMax',
  description: t("provider.copy.9caabd1e70"),
  iconId: 'minimax',
  baseUrl: 'https://api.minimax.io',
});
