import { normalizeAssetPath } from '@/utils/assetPaths';

type RecordLike = Record<string, any>;

function referencePath(value: string): string {
  let path = value;
  try {
    if (path.startsWith('shotloom://asset/')) path = decodeURIComponent(path.slice('shotloom://asset/'.length));
    if (path.startsWith('file://')) path = decodeURIComponent(new URL(path).pathname);
  } catch { /* Keep malformed values as references rather than rewriting them. */ }
  return normalizeAssetPath(path);
}

/** Exact persisted identifiers and file paths, including nested editor/director documents. */
export function referencesMaterial(value: unknown, material: RecordLike): boolean {
  const paths = new Set([material.path, material.filePath].filter(Boolean).map(referencePath));
  const visited = new Set<object>();
  function visit(item: unknown): boolean {
    if (typeof item === 'string') {
      return Boolean(material.id && (item === material.id || item === `material:${material.id}`
        || item.endsWith(`:material:${material.id}`))) || paths.has(referencePath(item));
    }
    if (!item || typeof item !== 'object' || visited.has(item)) return false;
    visited.add(item);
    return Object.values(item).some(visit);
  }
  return visit(value);
}

export function projectUsesMaterial(project: RecordLike, material: RecordLike, { history = true } = {}): boolean {
  const { materials, assets, pendingAssetCleanup, canvasHistory, canvasRedoStack, ...content } = project;
  return referencesMaterial(content, material)
    || (history && referencesMaterial([canvasHistory, canvasRedoStack], material))
    || (materials || []).some((other: RecordLike) => other.id !== material.id
      && referencesMaterial([other.path, other.filePath], material));
}
