/** Unknown boundary value that can be read by key; arrays stay a separate shape. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
