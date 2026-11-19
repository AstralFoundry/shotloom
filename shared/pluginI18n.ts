/** Translation dictionaries belong to a package, never to the application's catalog. */
export interface PluginI18n {
  defaultLocale?: string;
  messages: Record<string, Record<string, string>>;
}
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export function pluginI18nErrors(manifest: unknown): string[] {
  if (!record(manifest) || manifest.i18n === undefined) return [];
  const value = manifest.i18n;
  if (!record(value) || !record(value.messages)) return ['Plugin i18n.messages must be a locale dictionary'];
  if (value.defaultLocale !== undefined && (typeof value.defaultLocale !== 'string' || !Object.hasOwn(value.messages, value.defaultLocale))) return ['Plugin i18n.defaultLocale must name a packaged locale'];
  for (const messages of Object.values(value.messages)) {
    if (!record(messages) || Object.values(messages).some(message => typeof message !== 'string')) return ['Plugin translations must be strings'];
  }
  return [];
}

// Only presentation metadata is traversed. Request bodies, IDs, defaults and enum values stay intact.
const children = new Set(['protocols', 'mode', 'providers', 'defaultConnections', 'legacyProviders', 'provider', 'models', 'modes', 'params', 'inputVariants', 'inputSlots', 'capabilities', 'inputs', 'outputs', 'parameters']);
export function localizePluginMetadata<T>(source: T, i18n: PluginI18n | undefined, locale: string): T {
  if (!i18n) return source; // Older installed versions retain their legacy display behavior.
  const preferred = i18n.messages[locale];
  const language = i18n.messages[locale.split('-')[0]!];
  const fallback = i18n.messages[i18n.defaultLocale || 'zh-CN'];
  const lookup = (messages: Record<string, string> | undefined, key: string) => messages && Object.hasOwn(messages, key) ? messages[key] : undefined;
  const translate = (key: string, original: unknown) => lookup(preferred, key) ?? lookup(language, key) ?? lookup(fallback, key) ?? original;
  function visit(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(visit);
    if (!record(value)) return value;
    const result = { ...value };
    for (const field of ['name', 'description', 'label', 'placeholder'] as const) {
      const key = `${field}Key`;
      if (typeof value[key] === 'string') {
        result[field] = translate(value[key], value[field]);
        delete result[key]; // Resolved package keys must never fall through to application translations.
      }
    }
    if (record(value.optionLabelKeys)) {
      const labels = record(value.optionLabels) ? { ...value.optionLabels } : {};
      for (const [option, key] of Object.entries(value.optionLabelKeys)) if (typeof key === 'string') labels[option] = translate(key, labels[option] ?? option);
      result.optionLabels = labels;
      delete result.optionLabelKeys;
    }
    for (const key of children) if (Object.hasOwn(value, key)) result[key] = visit(value[key]);
    return result;
  }
  return visit(source) as T;
}
