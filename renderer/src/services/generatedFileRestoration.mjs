export async function restoreMissingGeneratedFiles(project, fileApi) {
  const candidates = (project?.materials || []).filter((material) => (
    material?.source === 'generation'
    && (material?.path || material?.filePath)
    && material?.remoteUrl
  ));
  const failures = [];
  let restored = 0;

  await Promise.all(candidates.map(async (material) => {
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
        throw new Error('下载完成后未找到本地文件');
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
