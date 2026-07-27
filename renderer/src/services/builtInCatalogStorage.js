export function withBuiltInEntries(storage = {}, key, builtInEntries = []) {
  const storedEntries = Array.isArray(storage[key]) ? storage[key] : [];
  const storedById = new Map(storedEntries.map((entry) => [String(entry?.id || ''), entry]));
  const builtInIds = new Set(builtInEntries.map((entry) => String(entry.id)));
  return {
    storageVersion: Number(storage.storageVersion) || 1,
    [key]: [
      ...builtInEntries.map((entry) => {
        const stored = storedById.get(String(entry.id));
        const shouldUpgrade = stored?.builtIn === true
          && Number(entry.version) > Number(stored.version || 0);
        return {
          ...entry,
          ...(shouldUpgrade ? {
            enabled: stored.enabled !== false,
            updatedAt: stored.updatedAt || entry.updatedAt,
          } : stored || {}),
          id: entry.id,
          builtIn: true,
        };
      }),
      ...storedEntries.filter((entry) => !builtInIds.has(String(entry?.id || ''))),
    ],
  };
}

export function withoutBuiltInEntries(storage = {}, key) {
  return {
    storageVersion: Number(storage.storageVersion) || 1,
    [key]: Array.isArray(storage[key]) ? storage[key] : [],
  };
}

const runtimeFields = new Set(['builtIn', 'enabled', 'updatedAt']);

function comparable(value) {
  if (Array.isArray(value)) return value.map(comparable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value)
    .filter((key) => !runtimeFields.has(key))
    .sort()
    .map((key) => [key, comparable(value[key])]));
}

export function changedBuiltInFields(entry, builtInEntries = []) {
  const original = builtInEntries.find((item) => String(item.id) === String(entry?.id || ''));
  if (!original || entry?.builtIn !== true) return [];
  const keys = new Set([...Object.keys(original), ...Object.keys(entry || {})]);
  return [...keys]
    .filter((key) => !runtimeFields.has(key) && key !== 'id')
    .filter((key) => JSON.stringify(comparable(entry?.[key])) !== JSON.stringify(comparable(original?.[key])))
    .sort();
}
