import { textNodeContent } from './textNodeContent.ts';

export function updatedTextVersions(node: any, content: unknown, now = new Date().toISOString()): any[] {
  const previous = textNodeContent(node);
  const next = String(content ?? '');
  const versions = Array.isArray(node?.textVersions) ? [...node.textVersions] : [];
  if (previous === next) return versions;
  if (previous && (!versions.length || versions[versions.length - 1].content !== previous)) {
    versions.push({ id: crypto.randomUUID(), content: previous, createdAt: String(node.updatedAt || now) });
  }
  versions.push({ id: crypto.randomUUID(), content: next, createdAt: now });
  return versions;
}
