import { t } from '../../../i18n/index.ts';
import { DeclarativeAdapter } from './declarative';

export const bytedanceAdapter = new DeclarativeAdapter({
  id: 'bytedance',
  name: t("provider.copy.538cae2139"),
  description: t("provider.copy.3602189b22"),
  iconId: 'volcengine',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
});
