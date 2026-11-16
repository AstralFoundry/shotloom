import { getLocales } from 'expo-localization';
import zh from '../../../renderer/src/i18n/locales/zh-CN.json';
import en from '../../../renderer/src/i18n/locales/en-US.json';

export let language = getLocales()[0]?.languageCode === 'zh' ? 'zh-CN' : 'en-US';
export function setLanguage(value: string) { if (value === 'zh-CN' || value === 'en-US') language = value; }
export function t(key: keyof typeof zh, values: Record<string, string | number> = {}) {
  let text: string = (language === 'zh-CN' ? zh : en)[key];
  for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
  return text;
}
export const local = (cn: string, english: string) => language === 'zh-CN' ? cn : english;
