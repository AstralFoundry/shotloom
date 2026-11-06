/**
 * 稳定序列化与指纹：同一份数据无论键序如何都得到同一个字符串/摘要。
 *
 * 快照去重与提交指纹共用这套规则：两者都要求「内容相同即同值」，
 * 否则重新序列化一次就会多出一条无意义的记录。
 */

/** 对象键排序、丢弃 `undefined`。入参来自本地 JSON（不含函数与循环引用）。 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') {
    const json = JSON.stringify(value);
    return json === undefined ? 'null' : json;
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const FNV_MASK = 0xffffffffffffffffn;

/**
 * FNV-1a 64 位摘要。用于去重与审计锚点，不做安全用途，因此不需要异步 crypto。
 */
export function stableFingerprint(value: unknown): string {
  const text = typeof value === 'string' ? value : canonicalJson(value ?? {});
  let hash = FNV_OFFSET;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = (hash * FNV_PRIME) & FNV_MASK;
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`;
}

/** UTF-8 字节数，用于快照/诊断包这类按体积设上限的场景。 */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
