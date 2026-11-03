import { createTranslator, normalizeLocale } from '../../../renderer/src/i18n/index';
export const locale = normalizeLocale(new URLSearchParams(location.hash.slice(1)).get('shotloomLocale'));
document.documentElement.lang = locale;
export const t = createTranslator(locale);
