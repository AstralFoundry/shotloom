export type Locale = 'zh-CN' | 'en-US';
export const LOCALE_STORAGE_KEY = 'shotloom:locale';
export function normalizeLocale(value: unknown): Locale {
  return value === 'en-US' ? 'en-US' : 'zh-CN';
}
// 启动缓存只决定本次文档的语言；持久设置由 settingsStore 管理。
export function getLocale(): Locale {
  try {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location?.search).get('native') === 'embedded') {
      const bridge = (window as Window & { ReactNativeWebView?: { injectedObjectJson?: () => string } }).ReactNativeWebView;
      const native = JSON.parse(bridge?.injectedObjectJson?.() || 'null');
      if (native?.locale === 'en-US' || native?.locale === 'zh-CN') return native.locale;
    }
    return normalizeLocale(globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY));
  }
  catch { return 'zh-CN'; }
}
