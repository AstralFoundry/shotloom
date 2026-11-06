/**
 * 项目版本记录（快照列表）的领域状态。
 *
 * 列表只保留元数据；预览和恢复时才读取 payload，避免把几 MB 的作品结构
 * 常驻在界面内存里。快照属于项目持久状态，因此走 domainReactivity。
 */

import { reactive } from '@/store/domainReactivity';
import { listProjectSnapshots } from '@/services/projectSnapshotService';
import { restoreProjectSnapshot, store } from '@/store/projectStore';
import type { SnapshotMeta } from '@/domain/snapshots/SnapshotPolicy';

export const projectSnapshotStore = reactive({
  snapshots: [] as SnapshotMeta[],
  loading: false,
  error: '',
});

export async function loadProjectSnapshotList(directory: string | null | undefined) {
  if (!directory) {
    projectSnapshotStore.snapshots = [];
    return [];
  }
  projectSnapshotStore.loading = true;
  projectSnapshotStore.error = '';
  try {
    const snapshots = await listProjectSnapshots(directory);
    projectSnapshotStore.snapshots = snapshots;
    return snapshots;
  } catch (error) {
    projectSnapshotStore.error = (error as Error)?.message || '';
    projectSnapshotStore.snapshots = [];
    return [];
  } finally {
    projectSnapshotStore.loading = false;
  }
}

export async function restoreProjectFromSnapshot(snapshotId: string) {
  const result = await restoreProjectSnapshot(snapshotId);
  if (result.ok) await loadProjectSnapshotList(store.projectDir);
  return result;
}
