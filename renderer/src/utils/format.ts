import { getLocale, t } from '../i18n/index.ts';

export function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function formatTime(value: string | number | Date | undefined | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(getLocale(), {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatSize(size: number | undefined) {
  // Number.isFinite(undefined) 本身就是 false；类型上仍需显式排除 undefined。
  if (typeof size !== 'number' || !Number.isFinite(size)) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

/** Item counts are complete phrases so English can use its singular form. */
export function formatItemCount(count: number) {
  return t(count === 1 ? 'common.itemCount.one' : 'common.itemCount.other', { count });
}

/** Complete tool-card count phrases keep noun order and plural forms in the dictionary. */
export function formatToolCount(kind: 'nodes' | 'edges' | 'tasks' | 'assets' | 'frames' | 'images', count: number) {
  return t(`tool.count.${kind}.${count === 1 ? 'one' : 'other'}`, { count });
}
