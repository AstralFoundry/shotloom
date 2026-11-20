import { t } from '../i18n/index.ts';
import { createNodeMediaCatalog } from '../utils/nodeMedia.ts';
// 生成结果的补写只读磁盘上的松散 JSON：素材与下载回执都按 AnyRecord 进出。
type AnyRecord = Record<string, any>;

export async function restoreMissingGeneratedFiles(
  project: AnyRecord | null | undefined,
  fileApi: AnyRecord,
): Promise<{ restored: number; failures: AnyRecord[] }> {
  const candidates = (project?.materials || []).filter((material: AnyRecord) => (
    material?.source === 'generation'
    && (material?.path || material?.filePath)
    && material?.remoteUrl
  ));
  const failures: AnyRecord[] = [];
  let restored = 0;
  const visiblePaths = new Set<string>();
  const viewport = project?.canvasViewport;
  if (viewport && typeof window !== 'undefined') {
    const media = createNodeMediaCatalog(project);
    for (const node of project?.nodes || []) {
      const x = Number(viewport.x || 0) + Number(node.x || 0) * Number(viewport.zoom || 1);
      const y = Number(viewport.y || 0) + Number(node.y || 0) * Number(viewport.zoom || 1);
      if (x + Number(node.canvasWidth || 0) * Number(viewport.zoom || 1) < 0 || y + Number(node.canvasHeight || 0) * Number(viewport.zoom || 1) < 0 || x > window.innerWidth || y > window.innerHeight) continue;
      const selected = media.selected(node);
      visiblePaths.add(selected.filePath || selected.path || '');
    }
    candidates.sort((a: AnyRecord, b: AnyRecord) => Number(visiblePaths.has(b.path || b.filePath)) - Number(visiblePaths.has(a.path || a.filePath)));
  }
  const checks = new Map<string, Promise<boolean>>();
  const paths = [...new Set<string>([...candidates, ...(project?.materials || [])].map((material: AnyRecord) => material.path || material.filePath).filter(Boolean))];
  if (fileApi.checkPaths && paths.length) {
    const results = await fileApi.checkPaths(paths).catch((error: unknown) => paths.map(path => ({ path, status: 'error', error: String(error) })));
    const byPath = new Map(results.map((item: AnyRecord) => [item.path, item]));
    for (const path of paths) {
      const result = byPath.get(path) as AnyRecord | undefined;
      checks.set(path, result?.status === 'exists' ? Promise.resolve(true) : result?.status === 'missing' ? Promise.resolve(false) : Promise.reject(new Error(result?.error || 'File check failed')));
      void checks.get(path)!.catch(() => {});
    }
  }
  const exists = (path: string): Promise<boolean> => {
    if (!checks.has(path)) checks.set(path, Promise.resolve().then(() => fileApi.pathExists(path)));
    return checks.get(path)!;
  };

  const downloads = new Map<string, Promise<AnyRecord>>();
  const restore = async (material: AnyRecord) => {
    const recordedPath = material.path || material.filePath;
    try {
      if (await exists(recordedPath)) return;
      const downloadKey = JSON.stringify([recordedPath, material.remoteUrl, material.metadata?.downloadAuth || null]);
      if (!downloads.has(downloadKey)) downloads.set(downloadKey, Promise.resolve().then(() => fileApi.downloadUrlToProject(material.remoteUrl, material.name, material.metadata?.downloadAuth || null)).then(async downloaded => {
        const path = downloaded?.filePath || downloaded?.path;
        if (path) checks.delete(path);
        return downloaded;
      }));
      const downloaded = await downloads.get(downloadKey)!;
      const filePath = downloaded?.filePath || downloaded?.path || '';
      if (!filePath || !await exists(filePath)) {
        throw new Error(t("errors.a4d7bcc1da"));
      }
      Object.assign(material, {
        path: filePath,
        filePath,
        name: downloaded.name || material.name,
        size: downloaded.size || material.size || 0,
        checksum: downloaded.checksum || material.checksum || '',
        checksumAlgorithm: downloaded.checksumAlgorithm || material.checksumAlgorithm || '',
        restoredAt: new Date().toISOString(),
      });
      restored += 1;
    } catch (error) {
      failures.push({
        materialId: material.id,
        name: material.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, async () => {
    while (next < candidates.length) await restore(candidates[next++]);
  }));

  return { restored, failures };
}
