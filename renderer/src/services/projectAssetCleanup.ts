import { desktopApi } from '@/services/desktopApi';
import { materialReferencedBySnapshots } from '@/services/projectSnapshotService';
import { projectUsesMaterial, referencesMaterial } from '@/domain/asset/materialReferences';
import { isPathInsideAssetRoot, projectAssetRoot } from '@/utils/assetPaths';
import { readLiveClipMediaState } from '@/services/clipSnapshotStore';

type RecordLike = Record<string, any>;

export async function materialReferencedByEditors(directory: string, material: RecordLike): Promise<boolean> {
  const saved = await desktopApi.project.getEditorMediaState(directory);
  if (!Array.isArray(saved)) throw new Error('Cannot verify editor media references');
  return referencesMaterial([saved, await readLiveClipMediaState(directory)], material);
}

/** Detach only project-owned, orphaned files; the durable queue survives restart. */
export function queueDeletedNodeAssets(project: RecordLike, directory: string | null, node: RecordLike, tasks: RecordLike[]) {
  const root = directory ? projectAssetRoot({}, directory) : '';
  for (const material of [...(project.materials || [])]) {
    if (material.projectAssetOwnerId !== project.id || material.storageScope === 'library'
      || !isPathInsideAssetRoot(material.path, root)
      || (material.nodeId !== node.id && !referencesMaterial([node, tasks], material))) continue;
    project.pendingAssetCleanup ||= [];
    if (!project.pendingAssetCleanup.some((item: RecordLike) => item.id === material.id)) {
      project.pendingAssetCleanup.push(JSON.parse(JSON.stringify({
        ...material, cleanupAssets: (project.assets || []).filter((item: RecordLike) => item.materialId === material.id),
      })));
    }
  }
  reconcilePendingProjectAssets(project);
}

/** Keep metadata for live uses (including undo), detach it once the last use goes. */
export function reconcilePendingProjectAssets(project: RecordLike) {
  for (const queued of project.pendingAssetCleanup || []) {
    if (queued.projectAssetOwnerId !== project.id || queued.storageScope === 'library') continue;
    const { cleanupAssets = [], ...material } = queued;
    if (projectUsesMaterial(project, material, { history: false })) {
      if (!project.materials.some((item: RecordLike) => item.id === material.id)) project.materials.push(material);
      for (const asset of cleanupAssets) {
        if (!project.assets.some((item: RecordLike) => item.id === asset.id)) project.assets.push(asset);
      }
    } else {
      project.materials = project.materials.filter((item: RecordLike) => item.id !== material.id);
      project.assets = project.assets.filter((item: RecordLike) => item.materialId !== material.id);
    }
  }
}

/** Called only after the detached node/metadata has been saved successfully. */
export async function cleanupProjectAssets(
  project: RecordLike,
  directory: string,
  isCurrent: () => boolean,
  changed: () => void,
  savedIds?: Set<string>,
) {
  if (!directory || !project.pendingAssetCleanup?.length) return;
  const root = projectAssetRoot({}, directory);
  for (const material of [...project.pendingAssetCleanup]) {
    if (savedIds && !savedIds.has(material.id)) continue;
    if (!isCurrent()) return;
    if (material.projectAssetOwnerId !== project.id || material.storageScope === 'library'
      || !isPathInsideAssetRoot(material.path, root)) continue;
    const inUse = () => (project.materials || []).some((item: RecordLike) => referencesMaterial(item, material))
      || projectUsesMaterial(project, material);
    if (inUse()) continue;
    try {
      if (await materialReferencedBySnapshots(directory, material.id, material)) continue;
      if (await materialReferencedByEditors(directory, material)) continue;
      if (!isCurrent() || inUse()) continue;
      const result = await desktopApi.file.trash(material.path, directory);
      if (result?.ok === false) continue;
      project.pendingAssetCleanup = project.pendingAssetCleanup.filter((item: RecordLike) => item.id !== material.id);
      changed();
    } catch (error) {
      // Uncertain history or failed trash keeps the file and durable retry record.
      console.warn('Project asset cleanup deferred', error);
    }
  }
}
