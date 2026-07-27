export interface InspectScriptStructureInput {
  sourceText: string;
  sourceTitle?: string;
  episodeId?: string;
  cursor?: number;
  pageChars?: number;
}

const EXPLICIT_HEADING = /^(?:第\s*[0-9一二三四五六七八九十百]+\s*[场幕]|场\s*[0-9一二三四五六七八九十百]+|scene\s+\d+|(?:int|ext|内|外)[.．\s/\-])/i;
const SPEAKER_PREFIX = /^([^\s：:，,。！？!?（）()]+)\s*[：:]/;
const DEFAULT_PAGE_CHARS = 40_000;
const MAX_PAGE_CHARS = 100_000;

function pageBlocks(text: string, absoluteStart: number) {
  const blocks: Array<{ id: string; sourceRange: { start: number; length: number }; text: string }> = [];
  const separator = /\r?\n\s*\r?\n+/g;
  let start = 0;
  for (const match of text.matchAll(separator)) {
    const end = match.index ?? start;
    const content = text.slice(start, end);
    if (content.trim()) {
      blocks.push({
        id: `block-${absoluteStart + start}`,
        sourceRange: { start: absoluteStart + start, length: content.length },
        text: content,
      });
    }
    start = end + match[0].length;
  }
  const content = text.slice(start);
  if (content.trim()) {
    blocks.push({
      id: `block-${absoluteStart + start}`,
      sourceRange: { start: absoluteStart + start, length: content.length },
      text: content,
    });
  }
  return blocks;
}

function lineCandidates(text: string, absoluteStart: number) {
  const headings: Array<{ text: string; sourceRange: { start: number; length: number } }> = [];
  const speakers: Array<{ name: string; sourceRange: { start: number; length: number } }> = [];
  let offset = 0;
  for (const line of text.split(/(?<=\n)/)) {
    const raw = line.replace(/[\r\n]+$/, '');
    const leading = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    const start = absoluteStart + offset + leading;
    if (trimmed && EXPLICIT_HEADING.test(trimmed)) {
      headings.push({ text: trimmed, sourceRange: { start, length: trimmed.length } });
    }
    const speaker = trimmed.match(SPEAKER_PREFIX)?.[1];
    if (speaker) speakers.push({ name: speaker, sourceRange: { start, length: speaker.length } });
    offset += line.length;
  }
  return { headings, speakers };
}

export function inspectScriptStructure(input: InspectScriptStructureInput) {
  const sourceText = String(input.sourceText || '');
  if (!sourceText.trim()) throw new Error('sourceText 不能为空');
  const requestedCursor = Number.isInteger(input.cursor) ? Number(input.cursor) : 0;
  const cursor = Math.min(sourceText.length, Math.max(0, requestedCursor));
  const requestedPageChars = Number.isInteger(input.pageChars) ? Number(input.pageChars) : DEFAULT_PAGE_CHARS;
  const pageChars = Math.min(MAX_PAGE_CHARS, Math.max(1, requestedPageChars));
  const end = Math.min(sourceText.length, cursor + pageChars);
  const text = sourceText.slice(cursor, end);
  const candidates = lineCandidates(text, cursor);
  const warnings: string[] = [];
  if (requestedPageChars > MAX_PAGE_CHARS) {
    warnings.push(`单页最多返回 ${MAX_PAGE_CHARS} 字符，已按上限分页；原文没有被丢弃`);
  }
  if (end < sourceText.length) warnings.push(`本页未覆盖全文，请从 cursor=${end} 继续读取`);
  if (!candidates.headings.length) warnings.push('本页没有识别到显式场次标题；请由 Agent 根据完整语义判断场次边界');
  return {
    sourceTitle: String(input.sourceTitle || ''),
    episodeId: String(input.episodeId || ''),
    page: {
      cursor,
      nextCursor: end < sourceText.length ? end : null,
      totalChars: sourceText.length,
      text,
      complete: end === sourceText.length,
    },
    blocks: pageBlocks(text, cursor),
    headingCandidates: candidates.headings,
    speakerCandidates: candidates.speakers,
    warnings,
  };
}
