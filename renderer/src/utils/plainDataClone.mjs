/**
 * Copy settings/catalog data through enumerable values so reactive proxies do
 * not cross persistence or catalog boundaries. These contracts contain plain
 * data only; executable values are intentionally excluded.
 */
export function clonePlainData(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value;

  const existing = seen.get(value);
  if (existing) return existing;

  const copy = Array.isArray(value) ? [] : {};
  seen.set(value, copy);
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'function') continue;
    copy[key] = clonePlainData(entry, seen);
  }
  return copy;
}
