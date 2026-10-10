import { textNodeContent } from './textNodeContent.mjs';

export function updatedTextVersions(node, content, now = new Date().toISOString()) {
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
