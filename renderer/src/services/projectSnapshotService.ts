/**
 * 画布快照的读写入口。
 *
 * 取舍规则放在 `domain/snapshots/SnapshotPolicy`，这里只负责：
 * 读最近一份快照的元数据 → 决定是否写 → 调原生存储。
 * 快照失败不能影响项目保存，所以所有调用都以「返回 null」收口。
 */

import { desktopApi } from '@/services/desktopApi';
import { uid } from '@/utils/format';
import {
  decideSnapshot,
  snapshotContentHash,
  snapshotMediaRefs,
  snapshotPayload,
  snapshotPayloadBytes,
  type SnapshotMeta,
  type SnapshotReason,
} from '@/domain/snapshots/SnapshotPolicy';

type AnyRecord = Record<string, any>;

/** 每个目录最近一份快照的元数据；项目打开时按需从磁盘水合。 */
const lastSnapshotByDirectory = new Map<string, SnapshotMeta | null>();

function normalizeMeta(row: AnyRecord | null | undefined): SnapshotMeta | null {
  if (!row || typeof row !== 'object') return null;
  const createdAt = String(row.createdAt || '');
  const contentHash = String(row.contentHash || '');
  if (!createdAt || !contentHash) return null;
  return {
    id: String(row.id || ''),
    createdAt,
    contentHash,
    payloadBytes: Number(row.payloadBytes) || 0,
    reason: row.reason ? String(row.reason) : undefined,
    degraded: row.degraded === true,
    mediaRefs: Array.isArray(row.mediaRefs) ? row.mediaRefs.map(String) : [],
  };
}

async function lastSnapshot(directory: string): Promise<SnapshotMeta | null> {
  if (lastSnapshotByDirectory.has(directory)) return lastSnapshotByDirectory.get(directory) ?? null;
  let meta: SnapshotMeta | null = null;
  try {
    const rows = await desktopApi.project.snapshotList?.(directory);
    meta = normalizeMeta(Array.isArray(rows) ? rows[0] : null);
  } catch {
    meta = null;
  }
  lastSnapshotByDirectory.set(directory, meta);
  return meta;
}

/** 项目切换/恢复后丢弃缓存，避免用上一个项目的「最近快照」做节流判断。 */
export function resetProjectSnapshotCache(directory?: string) {
  if (directory) lastSnapshotByDirectory.delete(directory);
  else lastSnapshotByDirectory.clear();
}

/**
 * 保存成功后尝试写一份快照。
 *
 * @param project 已保存的作品数据（调用方传入真正落盘的那份快照）
 * @param reason auto：5 分钟节流；manual/before_restore：跳过节流
 */
export async function captureProjectSnapshot(
  directory: string | null | undefined,
  project: AnyRecord,
  { reason = 'auto' as SnapshotReason, force = false }: { reason?: SnapshotReason; force?: boolean } = {},
): Promise<AnyRecord | null> {
  if (!directory) return null;
  const payload = snapshotPayload(project);
  const contentHash = snapshotContentHash(payload);
  const payloadBytes = snapshotPayloadBytes(payload);
  const mediaRefs = snapshotMediaRefs(payload);
  const previous = await lastSnapshot(directory);
  const decision = decideSnapshot({
    reason: force ? 'manual' : reason,
    now: Date.now(),
    previous,
    hash: contentHash,
    bytes: payloadBytes,
  });
  if (decision.action === 'skip') return null;
  const record = {
    id: uid(),
    createdAt: new Date().toISOString(),
    reason,
    contentHash,
    payloadBytes,
    mediaRefs,
    degraded: decision.degraded,
    payload: decision.degraded ? null : payload,
  };
  try {
    await desktopApi.project.snapshotCreate?.(directory, record);
  } catch {
    return null;
  }
  lastSnapshotByDirectory.set(directory, normalizeMeta(record));
  return record;
}

export async function listProjectSnapshots(directory: string | null | undefined): Promise<SnapshotMeta[]> {
  if (!directory) return [];
  try {
    const rows = await desktopApi.project.snapshotList?.(directory);
    const list = (Array.isArray(rows) ? rows : [])
      .map((row: AnyRecord) => normalizeMeta(row))
      .filter((row: SnapshotMeta | null): row is SnapshotMeta => Boolean(row));
    lastSnapshotByDirectory.set(directory, list[0] ?? null);
    return list;
  } catch {
    return [];
  }
}

/**
 * 素材是否仍被某个历史版本引用。
 *
 * 只看快照列表的 `mediaRefs` 元数据，不读 payload：删除素材是低频操作，
 * 但项目里可能有 20 份几百 KB 的快照，逐个反序列化不值得。
 */
export async function materialReferencedBySnapshots(
  directory: string | null | undefined,
  materialId: string,
): Promise<boolean> {
  const id = String(materialId || '').trim();
  if (!directory || !id) return false;
  const snapshots = await listProjectSnapshots(directory);
  return snapshots.some((snapshot) => (snapshot.mediaRefs || []).includes(id));
}

export async function readProjectSnapshot(
  directory: string | null | undefined,
  snapshotId: string,
): Promise<AnyRecord | null> {
  if (!directory || !snapshotId) return null;
  try {
    const payload = await desktopApi.project.snapshotRead?.(directory, snapshotId);
    return payload && typeof payload === 'object' ? (payload as AnyRecord) : null;
  } catch {
    return null;
  }
}
