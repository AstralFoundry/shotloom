/**
 * 诊断包的脱敏规则。
 *
 * 原则：诊断需要"哪一步失败、哪个模型、什么状态"，不需要用户写了什么。
 * 因此提示词、请求体、密钥、完整 URL 查询串与本地绝对路径默认不导出；
 * 错误文本只保留可定位的信息，并截断长度。
 */

const SENSITIVE_KEYS = new Set([
  'prompt', 'prompts', 'systemPrompt', 'input', 'inputs', 'requestPayload', 'payload',
  'body', 'headers', 'authorization', 'cookie', 'cookies', 'apikey', 'apiKey',
  'token', 'tokens', 'secret', 'password', 'messages', 'result', 'output', 'outputs',
  'content', 'raw', 'text',
]);

const MAX_DEPTH = 6;
const MAX_ARRAY = 50;
const MAX_TEXT = 2000;

export function redactText(value: unknown, maxLength = MAX_TEXT): string {
  const text = String(value ?? '').replace(/https?:\/\/[^\s"'<>]+/g, (url) => redactUrl(url));
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/** 去掉查询串与 fragment：域名和路径足够定位接口，参数可能带密钥。 */
export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    const [beforeQuery = ''] = value.split('?');
    const [beforeFragment = ''] = beforeQuery.split('#');
    return beforeFragment;
  }
}

/** 本地路径只保留文件名，避免泄露用户目录结构。 */
export function redactPath(value: string): string {
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.length ? `<path>/${parts[parts.length - 1]}` : '<path>';
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '<depth-limit>';
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') {
    if (/^([a-zA-Z]:[\\/]|\/Users\/|\/home\/|\/var\/|\/tmp\/)/.test(value)) return redactPath(value);
    if (/^https?:\/\//i.test(value)) return redactUrl(value);
    return redactText(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => redactValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(source)) {
      if (SENSITIVE_KEYS.has(key)) continue;
      result[key] = redactValue(item, depth + 1);
    }
    return result;
  }
  return String(value);
}

/** 记录一条诊断事件时的数据脱敏入口。 */
export function redactEventData(data: Record<string, unknown> | undefined): Record<string, unknown> {
  const redacted = redactValue(data ?? {}) as Record<string, unknown>;
  return redacted && typeof redacted === 'object' ? redacted : {};
}
