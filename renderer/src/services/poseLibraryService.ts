import { t } from '../i18n/index.ts';
import {
  POSE_LIBRARY_IMAGE_BASE,
  parsePoseCatalog,
  parsePosePack,
  type PoseCatalog,
} from '@/domain/pose/PoseLibrary';

const CACHE_KEY = 'shotloom:pose-catalog:v1';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const UPSTREAM_IMAGE_BASE = 'https://cdn.jsdelivr.net/gh/anhao/ai-pose-gallery-zh@main/';
const DEFAULT_SYSTEMS = new Set(['全身单人・标准系', '上半身单人']);

type CachedCatalog = { fetchedAt: number; imageBase: string; payload: unknown; imported?: boolean };

function readCache(): CachedCatalog | null {
  try {
    const raw = globalThis.localStorage?.getItem(CACHE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as CachedCatalog;
    if (!value || typeof value.fetchedAt !== 'number' || !value.payload) return null;
    return value;
  } catch {
    return null;
  }
}

function writeCache(value: CachedCatalog): void {
  try {
    globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(value));
  } catch {
    // 隐私模式或配额不足时只影响下次启动的离线缓存，不阻断本次浏览。
  }
}

function readImportedCatalog(cached: CachedCatalog | null) {
  if (!cached) return null;
  return parsePosePack(cached.payload)
    || (cached.imported ? parsePoseCatalog(cached.payload, cached.imageBase) : null);
}

function parseDefaultCatalog(payload: unknown, imageBase: string) {
  const catalog = parsePoseCatalog(payload, imageBase);
  if (!catalog) return null;
  const poses = catalog.poses.filter(pose => DEFAULT_SYSTEMS.has(pose.system));
  return poses.length ? { ...catalog, poses } : null;
}

async function fetchCatalogPayload(url: string, signal: AbortSignal) {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<unknown>;
}

/** The two systems enabled by the reference instance load from upstream automatically.
 * A user-imported catalog stays active until another pack is imported. */
export async function loadPoseCatalog(options: { force?: boolean; signal?: AbortSignal } = {}): Promise<PoseCatalog> {
  const cached = readCache();
  const imported = readImportedCatalog(cached);
  if (imported) return imported;
  const cachedCatalog = cached && parseDefaultCatalog(cached.payload, cached.imageBase);
  if (!options.force && cached && cachedCatalog && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cachedCatalog;

  let upstreamError: unknown;
  for (const imageBase of [UPSTREAM_IMAGE_BASE, POSE_LIBRARY_IMAGE_BASE]) {
    const timeout = AbortSignal.timeout(15000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    try {
      const payload = await fetchCatalogPayload(`${imageBase}data/pose-zh.json`, signal);
      const catalog = parseDefaultCatalog(payload, imageBase);
      if (!catalog) throw new Error(t('canvas.pose.invalidCatalog'));
      const currentImport = readImportedCatalog(readCache());
      if (currentImport) return currentImport;
      writeCache({ fetchedAt: Date.now(), imageBase, payload });
      return catalog;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      upstreamError = error;
    }
  }
  if (cachedCatalog) return cachedCatalog;
  throw new Error(t('canvas.pose.fetchFailed', { reason: upstreamError instanceof Error ? upstreamError.message : String(upstreamError) }));
}

/** 导入自建姿势包后将其作为下一次打开姿势库的目录。 */
export function importPoseCatalogText(text: string): PoseCatalog {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error(t('canvas.pose.invalidJson'));
  }
  const catalog = parsePosePack(data) || parsePoseCatalog(data, POSE_LIBRARY_IMAGE_BASE);
  if (!catalog) throw new Error(t('canvas.pose.invalidPack'));
  writeCache({ fetchedAt: Date.now(), imageBase: catalog.imageBase, payload: data, imported: true });
  return catalog;
}
