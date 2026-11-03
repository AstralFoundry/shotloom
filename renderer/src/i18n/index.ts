import zhCN from './locales/zh-CN.json' with { type: 'json' };
import enUS from './locales/en-US.json' with { type: 'json' };
import type { MessageParameters } from './message-parameters';

export type MessageKey = keyof typeof zhCN;
export type Locale = 'zh-CN' | 'en-US';
type Catalog = Partial<Record<MessageKey, string>>;
const catalogs: Record<Locale, Catalog> = { 'zh-CN': zhCN, 'en-US': enUS };

type Arguments<Key extends MessageKey> = Key extends keyof MessageParameters
  ? [params: MessageParameters[Key]] : [];

/** 纯文案模块，不持有领域或界面状态；参数按一次替换，避免把参数内容当作模板。 */
export function createTranslator(locale: Locale) {
  return <Key extends MessageKey>(key: Key, ...args: Arguments<Key>): string => {
    const params = args[0] as Record<string, string | number> | undefined;
    return (catalogs[locale][key] ?? zhCN[key]).replace(/\{([^{}]+)\}/g, (token, name: string) =>
      params && Object.hasOwn(params, name) ? String(params[name]) : token);
  };
}

export const LOCALE_STORAGE_KEY = 'shotloom:locale';
export function normalizeLocale(value: unknown): Locale {
  return value === 'en-US' ? 'en-US' : 'zh-CN';
}
// 启动缓存只决定本次文档的语言；持久设置由 settingsStore 管理。
export function getLocale(): Locale {
  try { return normalizeLocale(globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY)); }
  catch { return 'zh-CN'; }
}
export const t = createTranslator(getLocale());

/** External catalog metadata may be user-defined; unknown keys preserve its own label. */
export function catalogLabel(label: string, key?: string, translate = t): string {
  return key && Object.hasOwn(zhCN, key) ? translate(key as MessageKey) : label;
}

/** Only our explicit IPC envelope is translated; arbitrary upstream text stays untouched. */
export function localizeNativeError(value: unknown, locale: Locale = getLocale()): string | undefined {
  let data: unknown = value;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return undefined; }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const envelope = data as Record<string, unknown>;
  if (envelope.type !== 'shotloom:localized-error' || typeof envelope.key !== 'string'
      || typeof envelope.fallback !== 'string') return undefined;
  if (!Object.hasOwn(zhCN, envelope.key)) return envelope.fallback;
  const params = envelope.params;
  if (!params || typeof params !== 'object' || Array.isArray(params)) return envelope.fallback;
  const source = catalogs[locale][envelope.key as MessageKey] ?? zhCN[envelope.key as MessageKey];
  let valid = true;
  const message = source.replace(/\{([^{}]+)\}/g, (token, name: string) => {
    const item = Object.hasOwn(params, name) ? (params as Record<string, unknown>)[name] : undefined;
    if (typeof item !== 'string' && typeof item !== 'number') { valid = false; return token; }
    return String(item);
  });
  return valid ? message : envelope.fallback;
}
