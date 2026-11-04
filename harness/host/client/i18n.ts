import { createTranslator, getLocale } from '../../../renderer/src/i18n/index';
export const locale = getLocale();
export const t = createTranslator(locale);
