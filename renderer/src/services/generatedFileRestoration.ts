import { t } from '../i18n/index.ts';
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

  await Promise.all(candidates.map(async (material: AnyRecord) => {
    const recordedPath = material.path || material.filePath;
    const exists = await fileApi.pathExists(recordedPath).catch(() => false);
    if (exists) return;
    try {
      const downloaded = await fileApi.downloadUrlToProject(
        material.remoteUrl,
        material.name,
        material.metadata?.downloadAuth || null,
      );
      const filePath = downloaded?.filePath || downloaded?.path || '';
      if (!filePath || !await fileApi.pathExists(filePath).catch(() => false)) {
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
  }));

  return { restored, failures };
}
