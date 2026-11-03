import { t } from '../../../i18n/index.ts';
import { DeclarativeAdapter } from './declarative';

export const deepseekAdapter = new DeclarativeAdapter({
  id: 'deepseek',
  name: 'DeepSeek',
  description: t("provider.copy.dd161a69dd"),
  iconId: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
});
