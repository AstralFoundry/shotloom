import { t } from '../../../i18n/index.ts';
import { DeclarativeAdapter } from './declarative';

/** Qwen 百炼按工作空间开放接口，没有可内置的地址，必须由用户填写。 */
export const qwenAdapter = new DeclarativeAdapter({
  id: 'qwen',
  name: t("provider.copy.0f2051023f"),
  description: t("provider.copy.8fc2f0af91"),
  iconId: 'qwen',
  baseUrl: '',
  baseUrlRequired: true,
});
