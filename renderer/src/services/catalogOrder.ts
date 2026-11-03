export function sortEnabledFirst<T extends { enabled?: boolean }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => Number(a.enabled === false) - Number(b.enabled === false));
}
