import { zipSync } from 'fflate';
import { defineCommand } from '../registry';

/**
 * 诊断包：前端整理好的文本文件按固定白名单压成 ZIP，返回 base64。
 * 只接受扁平的安全文件名，总量超过 10 MiB 直接失败，不留半成品。
 */

const MAX_BUNDLE_BYTES = 10 * 1024 * 1024;

function safeEntryName(name: string): boolean {
  if (!name || name.length > 120) return false;
  if (name.startsWith('/') || name.includes('..') || name.includes('\\\\')) return false;
  return /^[A-Za-z0-9._/-]+$/.test(name);
}

export function buildDiagnosticsZip(files: unknown): Uint8Array {
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    throw new Error('diagnostics files must be an object');
  }
  const entries: Record<string, Uint8Array> = {};
  let total = 0;
  for (const [name, content] of Object.entries(files as Record<string, unknown>)) {
    if (!safeEntryName(name)) throw new Error(`invalid diagnostics entry: ${name}`);
    const text = typeof content === 'string' ? content : '';
    total += text.length;
    if (total > MAX_BUNDLE_BYTES) throw new Error('diagnostics bundle exceeds 10 MiB');
    entries[name] = new TextEncoder().encode(text);
  }
  return zipSync(entries, { level: 0 });
}

defineCommand('diagnostics_build', (args) => {
  return Buffer.from(buildDiagnosticsZip(args.files)).toString('base64');
});
