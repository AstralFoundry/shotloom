import { t } from '../../../i18n/index.ts';
import { DeclarativeAdapter } from './declarative';

export const zhipuAdapter = new DeclarativeAdapter({
  id: 'zhipu',
  name: t("provider.copy.5e4d6369b1"),
  description: t("provider.copy.ad5133e7c8"),
  iconId: 'zhipu',
  baseUrl: 'https://open.bigmodel.cn/api',
});
