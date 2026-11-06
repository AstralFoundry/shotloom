/**
 * 提示词里的「自然指代」转换：把「图1」「图片 2」「image3」转成对已连接素材的引用。
 *
 * 只处理画布上已经连进来的素材，且要求序号唯一；重名歧义、已有引用、
 * 序号越界都保持原样。转换是纯文本层面的，不读 DOM，也不改节点结构。
 */

export interface SmartReferenceTarget {
  nodeId: string;
  kind: string;
  /** 同类素材的序号，从 1 开始；0 表示没有序号（如文本）。 */
  number: number;
  /** 节点上已存在的引用别名；用于跳过已经引用过的素材。 */
  alias?: string;
}

export interface SmartReferenceMatch {
  start: number;
  end: number;
  /** 命中的原文，例如「图1」。 */
  text: string;
  nodeId: string;
  kind: string;
  alias: string;
}

const PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: 'image', re: /(?:参考图|图片|图像|图)\s*(\d{1,3})/g },
  { kind: 'image', re: /\bimage\s*(\d{1,3})\b/gi },
  { kind: 'video', re: /(?:参考视频|视频|镜头)\s*(\d{1,3})/g },
  { kind: 'video', re: /\bvideo\s*(\d{1,3})\b/gi },
  { kind: 'audio', re: /(?:参考音频|音频|声音)\s*(\d{1,3})/g },
  { kind: 'audio', re: /\baudio\s*(\d{1,3})\b/gi },
];

function aliasSpans(prompt: string, aliases: string[]): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const alias of aliases) {
    if (!alias) continue;
    const needle = `@${alias}`;
    let index = prompt.indexOf(needle);
    while (index >= 0) {
      spans.push([index, index + needle.length]);
      index = prompt.indexOf(needle, index + needle.length);
    }
  }
  return spans;
}

function overlaps(spans: Array<[number, number]>, start: number, end: number): boolean {
  return spans.some(([spanStart, spanEnd]) => start < spanEnd && end > spanStart);
}

/**
 * 找出可以转换的指代。重叠的命中只保留最长的那个（「参考图1」不会再拆出「图1」）。
 */
export function findSmartReferences(
  prompt: string,
  targets: SmartReferenceTarget[],
): SmartReferenceMatch[] {
  const text = String(prompt || '');
  if (!text) return [];

  // 同类同序号出现多次时无法判断指向，直接放弃这个序号。
  const byKey = new Map<string, SmartReferenceTarget[]>();
  for (const target of targets) {
    if (!target.number) continue;
    const key = `${target.kind}:${target.number}`;
    byKey.set(key, [...(byKey.get(key) || []), target]);
  }

  const referenced = new Set(targets.map((target) => target.alias || '').filter(Boolean));
  const spans = aliasSpans(text, [...referenced]);
  const raw: Array<{ start: number; end: number; text: string; target: SmartReferenceTarget }> = [];

  for (const { kind, re } of PATTERNS) {
    re.lastIndex = 0;
    for (const match of text.matchAll(re)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const number = Number(match[1]);
      if (!number) continue;
      const candidates = byKey.get(`${kind}:${number}`) || [];
      if (candidates.length !== 1) continue;
      const target = candidates[0] as SmartReferenceTarget;
      // 该素材已经被引用过，就不再重复转换。
      if (target.alias && text.includes(`@${target.alias}`)) continue;
      if (overlaps(spans, start, end)) continue;
      // 「约2秒」这类没有种类前缀的数字不会进入这里；这里再排掉紧贴标识符的写法。
      const before = text[start - 1] || '';
      if (/[A-Za-z0-9_]/.test(before)) continue;
      const after = text[end] || '';
      if (/[A-Za-z0-9_]/.test(after)) continue;
      raw.push({ start, end, text: match[0], target });
    }
  }

  raw.sort((left, right) => left.start - right.start || (right.end - right.start) - (left.end - left.start));
  const picked: typeof raw = [];
  for (const candidate of raw) {
    if (picked.some((item) => candidate.start < item.end && candidate.end > item.start)) continue;
    picked.push(candidate);
  }

  return picked.map((item) => ({
    start: item.start,
    end: item.end,
    text: item.text,
    nodeId: item.target.nodeId,
    kind: item.target.kind,
    alias: item.target.alias || '',
  }));
}

/** 一次性替换全部命中（从后往前替换，避免下标漂移）。 */
export function applySmartReferences(prompt: string, matches: SmartReferenceMatch[]): string {
  let result = String(prompt || '');
  for (const match of [...matches].sort((left, right) => right.start - left.start)) {
    if (!match.alias) continue;
    result = `${result.slice(0, match.start)}@${match.alias} ${result.slice(match.end)}`;
  }
  return result.replace(/[ \t]{2,}/g, ' ');
}
