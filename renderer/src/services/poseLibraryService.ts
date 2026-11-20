import { t } from '../i18n/index.ts';
import {
  POSE_LIBRARY_IMAGE_BASE,
  POSE_LIBRARY_SOURCE_URL,
  parsePoseCatalog,
  parsePosePack,
  type PoseCatalog,
} from '@/domain/pose/PoseLibrary';

const CACHE_KEY = 'shotloom:pose-catalog:v1';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type CachedCatalog = { fetchedAt: number; imageBase: string; payload: unknown };

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

/** 首次打开会拉取目录元数据；之后七天优先读本地缓存，图片仍按需加载。 */
export async function loadPoseCatalog(options: { force?: boolean; signal?: AbortSignal } = {}): Promise<PoseCatalog> {
  const cached = readCache();
  if (!options.force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    const parsed = parsePosePack(cached.payload) || parsePoseCatalog(cached.payload, cached.imageBase);
    if (parsed) return { ...parsed, importedAt: new Date(cached.fetchedAt).toISOString() };
  }
  let response: Response;
  const timeout = new AbortController();
  const timer = globalThis.setTimeout(() => timeout.abort(), 25000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout.signal])
    : timeout.signal;
  try {
    response = await fetch(POSE_LIBRARY_SOURCE_URL, {
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch (error) {
    if (cached) {
      const parsed = parsePosePack(cached.payload) || parsePoseCatalog(cached.payload, cached.imageBase);
      if (parsed) return { ...parsed, importedAt: new Date(cached.fetchedAt).toISOString() };
    }
    throw new Error(t('canvas.pose.fetchFailed', { reason: error instanceof Error ? error.message : String(error) }));
  } finally {
    globalThis.clearTimeout(timer);
  }
  if (!response.ok) {
    if (cached) {
      const parsed = parsePosePack(cached.payload) || parsePoseCatalog(cached.payload, cached.imageBase);
      if (parsed) return { ...parsed, importedAt: new Date(cached.fetchedAt).toISOString() };
    }
    throw new Error(t('canvas.pose.fetchFailed', { reason: `${response.status} ${response.statusText}` }));
  }
  const payload: unknown = await response.json();
  const catalog = parsePoseCatalog(payload, POSE_LIBRARY_IMAGE_BASE);
  if (!catalog) throw new Error(t('canvas.pose.invalidCatalog'));
  writeCache({ fetchedAt: Date.now(), imageBase: POSE_LIBRARY_IMAGE_BASE, payload });
  return catalog;
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
  writeCache({ fetchedAt: Date.now(), imageBase: catalog.imageBase, payload: data });
  return catalog;
}
