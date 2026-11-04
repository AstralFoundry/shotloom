import { t } from '../i18n/index.ts';
import { inferMediaType, mediaExtension } from '../utils/mediaType.ts';
// 素材库读写的是持久化的松散 JSON：文件、素材与设定条目都按 AnyRecord 进出，
// 只有分类表和文案映射有静态类型。
import { assetCategories, defaultAssetCategory, assetCategoryFor } from '@/domain/asset/assetCategories';
import { desktopApi } from '@/services/desktopApi';
import { store, touchProject } from '@/store/projectStore';
import { showToast, showErrorMessage } from '@/store/notificationStore';
import { uid } from '@/utils/format';
import { recordCanvasHistory } from '@/store/canvasHistoryStore';
import { addNode } from '@/store/nodeStore';
import { isPathInsideAssetRoot, projectAssetRoot } from '@/utils/assetPaths.ts';
import { releaseLocalAssetReference } from '@/store/localAssetLibraryStore';

type AnyRecord = Record<string, any>;

/**
 * 素材库查询的唯一实现：只有绑定了真实素材文件的条目才算可用素材——
 * 没有 materialId 的设定条目无法被 place_asset_on_canvas 落实，
 * 暴露给 Agent 只会引用到空文件。界面素材面板另有自己的展示口径。
 */
export function filterAssetLibrary(
  assets: AnyRecord[] = [],
  options: { keyword?: string; category?: string; resourceType?: string } = {},
): AnyRecord[] {
  const keyword = String(options.keyword || '').trim().toLowerCase();
  const requestedCategory = String(options.category || '').trim();
  const category = requestedCategory ? findAssetCategory(requestedCategory) : null;
  const resourceType = String(options.resourceType || '').trim().toLowerCase();
  return assets.filter((asset: AnyRecord) => {
    if (!asset.materialId) return false;
    if (category && !categoryMatches(asset.category, category)) return false;
    if (resourceType && String(asset.resourceType || '').toLowerCase() !== resourceType) return false;
    if (!keyword) return true;
    return [asset.name, asset.code, asset.phone, asset.note, asset.resourceType, asset.nodeType, ...(asset.tags || [])]
      .join(' ')
      .toLowerCase()
      .includes(keyword);
  });
}

function findAssetCategory(categoryId: string) {
  return assetCategories.find((category) => (
    category.id === categoryId || category.aliases?.includes(categoryId)
  )) || defaultAssetCategory;
}

function categoryMatches(assetCategory: string, activeCategory: typeof defaultAssetCategory) {
  return assetCategory === activeCategory.id || activeCategory.aliases?.includes(assetCategory);
}

function displayName(file: AnyRecord = {}) {
  return file.name || file.fileName || t("ui.canvasUploadActions.text.460d54d3");
}

export function resourceTypeLabel(resourceType: string) {
  return {
    image: t("ui.canvasMediaActions.text.be8da62e"),
    video: t("ui.canvasMediaActions.text.fa4e33b6"),
    audio: t("ui.canvasAdapter.label.461189f1"),
    text: t("ui.canvasAdapter.label.f1926e9b"),
    file: t("ui.MaterialGrid.file.49deaf7d"),
  }[resourceType as 'image' | 'video' | 'audio' | 'text' | 'file'] || t("ui.MaterialGrid.file.49deaf7d");
}

export function assetNodeTypeLabel(nodeType: string) {
  return {
    imageGeneration: t("ui.CanvasToolbarCustomizeDialog.image.167e8c64"),
    videoGeneration: t("ui.CanvasToolbarCustomizeDialog.video.1a4fa42b"),
    audioGeneration: t("ui.assetStore.text.c8424a99"),
    textGeneration: t("ui.CanvasNodeToolbar.text.d80ef14f"),
  }[nodeType as 'imageGeneration' | 'videoGeneration' | 'audioGeneration' | 'textGeneration'] || '';
}

export function inferFileResourceType(file: AnyRecord = {}): string {
  return inferMediaType(file);
}

function nodeTypeForMaterial(material: AnyRecord = {}) {
  const resourceType = material.resourceType || inferFileResourceType(material);
  return {
    image: 'imageGeneration',
    video: 'videoGeneration',
    audio: 'audioGeneration',
    text: 'textGeneration',
    file: 'textGeneration',
  }[resourceType as 'image' | 'video' | 'audio' | 'text' | 'file'] || 'textGeneration';
}

/**
 * 将素材文件/素材库条目应用到创作画布。
 * 不创建独立 resource 节点，而是创建对应生成节点，并把素材挂到 uploadedFile 作为参考输入。
 * @param {Object} material
 * @returns {Object|null}
 */
export function applyMaterialToCanvas(material: AnyRecord = {}): AnyRecord | null {
  if (!material || (!material.id && !material.assetId)) {
    showToast(t("ui.assetStore.text.f0393f83"));
    return null;
  }
  const resourceType = material.resourceType || inferFileResourceType(material);
  const nodeType = material.nodeType && ['imageGeneration', 'videoGeneration', 'audioGeneration', 'textGeneration'].includes(material.nodeType)
    ? material.nodeType
    : nodeTypeForMaterial({ ...material, resourceType });
  const title = material.name || material.fileName || t("ui.assetStore.text.e2710fc2");
  const filePath = material.path || material.filePath || '';
  recordCanvasHistory(t("ui.assetStore.text.6c80c55a"));
  const node: AnyRecord = addNode(nodeType);
  node.title = title;
  node.prompt = material.note || material.content || material.description || '';
  node.content = material.note || material.content || filePath || title;
  node.materialId = material.materialId || material.id || '';
  node.assetId = material.assetId || '';
  node.artifactType = assetCategoryFor(material.category || material.artifactType).purpose;
  node.resourceType = resourceType;
  if (resourceType === 'text') node.textContent = material.content || '';
  node.sourceType = material.sourceType || material.source || 'material-library';
  node.uploadedFile = {
    name: title,
    path: filePath,
    filePath,
    type: material.mimeType || material.type || '',
    size: material.size || 0,
    materialId: node.materialId,
    assetId: node.assetId,
    resourceType,
    source: node.sourceType,
  };
  if (!filePath && resourceType === 'text') {
    node.uploadedFile.content = node.content;
  }
  node.updatedAt = new Date().toISOString();
  store.route = 'creation';
  touchProject();
  showToast(t("ui.assetStore.text.441ff22c"));
  return node;
}

/**
 * 记录一个真实素材文件。
 * 默认只进入“素材文件”；只有显式传入 createAsset: true 或点击“加入素材库”时，才创建素材库设定条目。
 */
export function registerImportedMaterial(file: AnyRecord = {}, options: AnyRecord = {}): {
  material: AnyRecord;
  asset: AnyRecord | null;
  reused?: boolean;
} {
  const resourceType = options.resourceType || inferFileResourceType(file);
  const sourceType = options.sourceType || options.source || 'manual-import';
  const nodeType = options.nodeType || '';
  const checksum = file.checksum || file.md5 || options.checksum || '';
  if (checksum) {
    const existing = findMaterialByChecksum(checksum);
    if (existing && options.reuseExisting !== false) {
      return { material: existing, asset: null, reused: true };
    }
  }
  const material: AnyRecord = {
    id: options.materialId || uid(),
    path: file.path || file.filePath || '',
    name: displayName(file),
    ext: mediaExtension(file),
    size: file.size || 0,
    mimeType: file.type || file.mimeType || '',
    checksum,
    checksumAlgorithm: file.checksumAlgorithm || options.checksumAlgorithm || (checksum ? 'md5' : ''),
    resourceType,
    source: sourceType,
    sourceType,
    nodeType,
    importedAt: options.importedAt || new Date().toISOString(),
  };
  store.project.materials.unshift(material);

  let asset: AnyRecord | null = null;
  if (options.createAsset === true) {
    asset = {
      id: options.assetId || uid(),
      name: material.name,
      code: assetNodeTypeLabel(nodeType) || resourceTypeLabel(resourceType),
      phone: '',
      category: options.category || defaultAssetCategoryForMaterial(material),
      note: t("ui.assetStore.text.fd2b1a04", { value0: String(resourceTypeLabel(resourceType)) }),
      tags: [
        options.assetTag || t("ui.assetStore.text.a44f2749"),
        resourceTypeLabel(resourceType),
        assetNodeTypeLabel(nodeType),
      ].filter(Boolean),
      materialId: material.id,
      resourceType,
      sourceType,
      nodeType,
      createdAt: material.importedAt,
    };
    store.project.assets.unshift(asset);
  }

  return { material, asset };
}

export function findMaterialByChecksum(checksum: string): AnyRecord | null {
  const value = String(checksum || '').trim();
  if (!value) return null;
  return (store.project.materials as AnyRecord[]).find((material: AnyRecord) => material.checksum === value) || null;
}

async function ensureFileChecksum(file: AnyRecord = {}): Promise<AnyRecord> {
  if (file.checksum) return file;
  const sourcePath = file.path || file.filePath || '';
  if (!sourcePath) return file;
  try {
    const result = await desktopApi.file.checksum?.(sourcePath);
    if (!result?.checksum) return file;
    return {
      ...file,
      checksum: result.checksum,
      checksumAlgorithm: result.checksumAlgorithm || 'sha256',
      size: file.size || result.size || 0,
    };
  } catch {
    return file;
  }
}

export async function copyFileIntoProjectAssets(file: AnyRecord = {}): Promise<AnyRecord> {
  const source = await ensureFileChecksum(file);
  const root = projectAssetRoot(store.project, store.projectDir);
  const existing = findMaterialByChecksum(source.checksum);
  if (existing && root && isPathInsideAssetRoot(existing.path || existing.filePath, root)) {
    showToast(t("ui.assetStore.text.c48cf444"));
    return {
      ...source,
      path: existing.path,
      filePath: existing.path,
      name: existing.name || source.name,
      fileName: existing.name || source.fileName,
      ext: existing.ext || source.ext,
      size: existing.size || source.size || 0,
      mimeType: existing.mimeType || source.mimeType || source.type || '',
      resourceType: existing.resourceType || source.resourceType,
      materialId: existing.id,
      reusedMaterialId: existing.id,
      checksum: existing.checksum || source.checksum,
      checksumAlgorithm: existing.checksumAlgorithm || source.checksumAlgorithm || 'md5',
    };
  }
  const sourcePath = source.path || source.filePath || '';
  if (!sourcePath) return file;
  if (isProjectAssetPath(sourcePath)) return source;
  try {
    if (!root) throw new Error(t("errors.c2fc00e90d"));
    const copied = await desktopApi.file.copyToDirectory?.(sourcePath, root, displayName(source));
    if (!copied?.filePath && !copied?.path) return file;
    return {
      ...source,
      path: copied.filePath || copied.path,
      filePath: copied.filePath || copied.path,
      name: copied.name || displayName(source),
      fileName: copied.name || source.fileName || displayName(source),
      ext: copied.ext || source.ext || mediaExtension(source),
      size: copied.size || source.size || 0,
      checksum: copied.checksum || source.checksum || '',
      checksumAlgorithm: copied.checksumAlgorithm || source.checksumAlgorithm || 'md5',
      copiedAt: copied.copiedAt || new Date().toISOString(),
      originalPath: sourcePath,
    };
  } catch (error) {
    showErrorMessage((error as AnyRecord)?.message || t("ui.assetStore.text.1e48bfef"), t("ui.assetStore.text.1e48bfef"));
    return file;
  }
}

export async function ensureMaterialStoredInProjectAssets(material: AnyRecord = {}): Promise<AnyRecord> {
  const archived = await copyFileIntoProjectAssets(material);
  const nextPath = archived.path || archived.filePath || '';
  if (!nextPath || !isProjectAssetPath(nextPath)) {
    throw new Error(t("errors.6a02cb5c9d"));
  }
  if (!material.id) return archived;
  const projectMaterial = (store.project.materials as AnyRecord[]).find((item: AnyRecord) => item.id === material.id);
  if (!projectMaterial) return archived;
  const previousPath = projectMaterial.path || projectMaterial.filePath || '';
  Object.assign(projectMaterial, {
    path: nextPath,
    filePath: nextPath,
    name: archived.name || projectMaterial.name,
    fileName: archived.fileName || archived.name || projectMaterial.fileName || projectMaterial.name,
    ext: archived.ext || projectMaterial.ext,
    size: archived.size || projectMaterial.size || 0,
    checksum: archived.checksum || projectMaterial.checksum || '',
    checksumAlgorithm: archived.checksumAlgorithm || projectMaterial.checksumAlgorithm || '',
    originalPath: projectMaterial.originalPath || (previousPath !== nextPath ? previousPath : ''),
    updatedAt: new Date().toISOString(),
  });
  (store.project.nodes as AnyRecord[]).forEach((node: AnyRecord) => {
    if (node.materialId !== projectMaterial.id && node.uploadedFile?.materialId !== projectMaterial.id) return;
    node.filePath = nextPath;
    if (node.uploadedFile) {
      node.uploadedFile.path = nextPath;
      node.uploadedFile.filePath = nextPath;
      node.uploadedFile.name = projectMaterial.name;
    }
    if (node.type === 'resource') {
      node.content = nextPath;
      node.url = nextPath;
      node.previewUrl = nextPath;
      node.fileName = projectMaterial.name;
    }
  });
  return projectMaterial;
}

function projectAssetsRoot() {
  return projectAssetRoot(store.project, store.projectDir);
}

export function isProjectAssetPath(filePath = '') {
  const root = projectAssetsRoot();
  if (!root || !filePath) return false;
  return isPathInsideAssetRoot(filePath, root);
}

export async function migrateProjectMaterialsIntoAssets() {
  const materials = (store.project.materials || []) as AnyRecord[];
  let migratedCount = 0;
  for (const material of materials) {
    if (!material?.path || isProjectAssetPath(material.path)) continue;
    const copied = await copyFileIntoProjectAssets(material);
    const nextPath = copied.path || copied.filePath || '';
    if (!nextPath || nextPath === material.path) continue;
    const previousPath = material.path;
    material.path = nextPath;
    material.filePath = nextPath;
    material.name = copied.name || material.name;
    material.fileName = copied.name || material.fileName || material.name;
    material.ext = copied.ext || material.ext;
    material.size = copied.size || material.size || 0;
    material.originalPath = material.originalPath || previousPath;
    material.updatedAt = new Date().toISOString();

    (store.project.nodes as AnyRecord[]).forEach((node: AnyRecord) => {
      if (node.materialId !== material.id) return;
      if (node.uploadedFile) {
        node.uploadedFile.path = nextPath;
        node.uploadedFile.filePath = nextPath;
        node.uploadedFile.name = material.name;
      }
      if (node.type === 'resource') {
        node.filePath = nextPath;
        node.content = nextPath;
        node.url = nextPath;
        node.previewUrl = nextPath;
        node.fileName = material.name;
      }
    });
    migratedCount += 1;
  }
  if (migratedCount > 0) {
    touchProject();
    showToast(t("ui.assetStore.text.49a5a02d", { value0: String(migratedCount) }));
  }
  return migratedCount;
}

function sourceTypeLabel(sourceType: string) {
  return {
    'canvas-upload': t("ui.canvasUploadActions.assetTag.9f3c15a3"),
    'material-import': t("ui.assetStore.text.4a1718f8"),
    generation: t("ui.ResourcePreview.text.99045f8e"),
    'resource-replace': t("ui.canvasAdapter.text.43ccbabf"),
  }[sourceType as 'canvas-upload' | 'material-import' | 'generation' | 'resource-replace'] || t("ui.AssetsView.text.bab3c9ce");
}

function defaultAssetCategoryForMaterial(material: AnyRecord = {}) {
  return assetCategoryFor(material.artifactType || material.category).id;
}

/**
 * 将已有素材文件提升为素材库设定条目。
 * @param {Object} material - project.materials 中的文件记录
 * @returns {Object|null} 新建的素材设定；已存在时返回 null
 */
export function addMaterialToAssetLibrary(material: AnyRecord = {}, options: AnyRecord = {}): AnyRecord | null {
  if (!material.id) return null;
  const exists = (store.project.assets as AnyRecord[]).some((asset: AnyRecord) => asset.materialId === material.id);
  if (exists) {
    if (options.notify !== false) showToast(t("ui.assetStore.text.38ba6b6a"));
    return null;
  }

  const resourceType = material.resourceType || inferFileResourceType(material);
  const sourceType = material.sourceType || material.source || 'material-file';
  const category = options.category || defaultAssetCategoryForMaterial(material);
  const asset: AnyRecord = {
    id: uid(),
    name: material.name || t("ui.canvasMediaSelection.text.b61b7f74"),
    code: assetNodeTypeLabel(material.nodeType) || resourceTypeLabel(resourceType),
    phone: '',
    category,
    note: t("ui.assetStore.text.fd2b1a04", { value0: String(resourceTypeLabel(resourceType)) }),
    tags: [
      sourceTypeLabel(sourceType),
      resourceTypeLabel(resourceType),
      assetNodeTypeLabel(material.nodeType),
    ].filter(Boolean),
    materialId: material.id,
    resourceType,
    sourceType,
    nodeType: material.nodeType || '',
    createdAt: new Date().toISOString(),
  };

  store.project.assets.unshift(asset);
  store.assetCategory = category;
  touchProject();
  if (options.notify !== false) showToast(t("ui.assetStore.text.9dfa1df5"));
  return asset;
}

export function deleteAssetFromLibrary(assetId: string) {
  if (!assetId) return false;
  const before = store.project.assets.length;
  store.project.assets = (store.project.assets as AnyRecord[]).filter((asset: AnyRecord) => asset.id !== assetId);
  if (store.project.assets.length === before) return false;
  if (store.project.library?.enabled || store.project.series?.enabled) {
    store.project.sharedLibraryDeletedAssetIds = [
      ...new Set([...((store.project.sharedLibraryDeletedAssetIds || []) as string[]), assetId]),
    ];
  }
  touchProject();
  showToast(t("ui.assetStore.text.3b000883"));
  return true;
}

export async function deleteMaterialFile(materialId: string): Promise<{ ok: boolean; error?: string }> {
  if (!materialId) return { ok: false, error: t("ui.assetStore.text.195204c2") };
  const material = (store.project.materials as AnyRecord[]).find((item: AnyRecord) => item.id === materialId);
  if (!material) return { ok: false, error: t("ui.assetStore.text.195204c2") };
  const usedByNode = (store.project.nodes as AnyRecord[]).some((node: AnyRecord) => (
    node.materialId === materialId || node.uploadedFile?.materialId === materialId
  ));
  const usedByTask = (store.project.tasks as AnyRecord[]).some((task: AnyRecord) => (
    (task.result?.archivedFiles || []) as AnyRecord[]
  ).some((file: AnyRecord) => file.id === materialId));
  if (usedByNode || usedByTask) {
    return { ok: false, error: t("ui.assetStore.text.4a8fff22") };
  }
  const before = store.project.materials.length;
  store.project.materials = (store.project.materials as AnyRecord[]).filter((material: AnyRecord) => material.id !== materialId);
  if (store.project.materials.length === before) return { ok: false, error: t("ui.assetStore.text.195204c2") };
  const removedAssetIds = (store.project.assets as AnyRecord[])
    .filter((asset: AnyRecord) => asset.materialId === materialId)
    .map((asset: AnyRecord) => asset.id);
  store.project.assets = (store.project.assets as AnyRecord[]).filter((asset: AnyRecord) => asset.materialId !== materialId);
  if ((store.project.library?.enabled || store.project.series?.enabled) && removedAssetIds.length) {
    store.project.sharedLibraryDeletedAssetIds = [
      ...new Set([...((store.project.sharedLibraryDeletedAssetIds || []) as string[]), ...removedAssetIds]),
    ];
  }
  await releaseLocalAssetReference(materialId);
  const localProjectRoot = store.projectDir ? projectAssetRoot({}, store.projectDir) : '';
  const samePathStillUsed = (store.project.materials as AnyRecord[]).some((item: AnyRecord) => item.path && item.path === material.path);
  if (!samePathStillUsed && material.storageScope !== 'library'
    && isPathInsideAssetRoot(material.path, localProjectRoot)) {
    try { await desktopApi.file.trash?.(material.path); } catch { /* metadata deletion remains valid */ }
  }
  touchProject();
  showToast(t("ui.assetStore.text.031757d5"));
  return { ok: true };
}

export function renameMaterialFile(materialId: string, name: string) {
  const nextName = String(name || '').trim();
  if (!materialId || !nextName) return false;
  const material = (store.project.materials as AnyRecord[]).find((item: AnyRecord) => item.id === materialId);
  if (!material) return false;
  material.name = nextName;
  material.fileName = nextName;
  material.updatedAt = new Date().toISOString();

  (store.project.assets as AnyRecord[]).forEach((asset: AnyRecord) => {
    if (asset.materialId === materialId) asset.name = nextName;
  });
  (store.project.nodes as AnyRecord[]).forEach((node: AnyRecord) => {
    if (node.materialId === materialId) {
      node.fileName = nextName;
      if (node.uploadedFile) node.uploadedFile.name = nextName;
      if (node.type === 'resource') node.title = nextName;
    }
  });

  touchProject();
  showToast(t("ui.projectLibraryAdapter.text.dc9fe43f"));
  return true;
}

export function renameAssetInLibrary(assetId: string, name: string) {
  const nextName = String(name || '').trim();
  if (!assetId || !nextName) return false;
  const asset = (store.project.assets as AnyRecord[]).find((item: AnyRecord) => item.id === assetId);
  if (!asset) return false;
  asset.name = nextName;
  asset.updatedAt = new Date().toISOString();
  touchProject();
  showToast(t("ui.projectLibraryAdapter.text.dc9fe43f"));
  return true;
}

/**
 * 导入素材文件。
 * 文件先进入 materials 列表，不自动进入素材库。
 */
export async function importAssetFiles() {
  const files = await desktopApi.file.importAsset();
  if (!files.length) return;

  for (const file of files) {
    const projectFile = await copyFileIntoProjectAssets(file);
    registerImportedMaterial(projectFile, {
      sourceType: 'material-import',
      assetTag: t("ui.assetStore.text.4a1718f8"),
      createAsset: false,
    });
  }
  touchProject();
  showToast(t("ui.assetStore.text.7750776a", { value0: String(files.length) }));
}

export async function exportResourcePackage(scope = 'materials') {
  const libraryOnly = scope === 'library';
  const assets = ((store.project.assets || []) as AnyRecord[]).filter((asset: AnyRecord) => asset.materialId);
  const materialIds = new Set<string>(assets.map((asset: AnyRecord) => asset.materialId));
  const materials = ((store.project.materials || []) as AnyRecord[]).filter((material: AnyRecord) => !libraryOnly || materialIds.has(material.id));
  if (!materials.length) {
    showToast(libraryOnly ? t("ui.assetStore.text.18968489") : t("ui.assetStore.text.924e010b"));
    return null;
  }
  try {
    const result = await desktopApi.file.exportResourcePackage?.({
      scope,
      name: `${store.project.name || 'project'}-${libraryOnly ? 'library' : 'materials'}`,
      materials: JSON.parse(JSON.stringify(materials)),
      assets: JSON.parse(JSON.stringify(assets)),
    });
    if (result?.ok) showToast(result.direct
      ? t("ui.assetStore.text.166334a4", { value0: String(result.count), value1: String(result.filePath) })
      : t("ui.assetStore.text.374c0289", { value0: String(result.count) }));
    return result;
  } catch (error) {
    showErrorMessage((error as AnyRecord)?.message || t("ui.assetStore.text.fe5d7354"), t("ui.assetStore.text.fe5d7354"));
    return null;
  }
}

export async function importResourcePackage() {
  try {
    const result = await desktopApi.file.importResourcePackage?.();
    if (!result) return null;
    const existingByChecksum = new Map<string, AnyRecord>(((store.project.materials || []) as AnyRecord[])
      .filter((item: AnyRecord) => item.checksum)
      .map((item: AnyRecord) => [item.checksum, item]));
    const idMap = new Map<string, string>();
    let addedMaterials = 0;
    for (const imported of (result.materials || []) as AnyRecord[]) {
      const existing = imported.checksum ? existingByChecksum.get(imported.checksum) : null;
      if (existing) {
        idMap.set(imported.id, existing.id);
        if (imported.path && imported.path !== existing.path) {
          try { await desktopApi.file.trash?.(imported.path); } catch { /* keep imported file if cleanup fails */ }
        }
        continue;
      }
      const oldId = imported.id;
      const material: AnyRecord = { ...imported, id: uid(), source: 'resource-package', sourceType: 'resource-package' };
      idMap.set(oldId, material.id);
      store.project.materials.unshift(material);
      if (material.checksum) existingByChecksum.set(material.checksum, material);
      addedMaterials += 1;
    }
    const existingAssetMaterialIds = new Set<string>(((store.project.assets || []) as AnyRecord[]).map((asset: AnyRecord) => asset.materialId));
    let addedAssets = 0;
    for (const imported of (result.assets || []) as AnyRecord[]) {
      const materialId = idMap.get(imported.materialId);
      if (!materialId || existingAssetMaterialIds.has(materialId)) continue;
      store.project.assets.unshift({ ...imported, id: uid(), materialId, createdAt: new Date().toISOString() });
      existingAssetMaterialIds.add(materialId);
      addedAssets += 1;
    }
    if (addedMaterials || addedAssets) touchProject();
    showToast(addedAssets
      ? t('asset.import.filesAndEntries', { files: addedMaterials, entries: addedAssets })
      : t('asset.import.files', { files: addedMaterials }));
    return { addedMaterials, addedAssets };
  } catch (error) {
    showErrorMessage((error as AnyRecord)?.message || t("ui.assetStore.text.0425004b"), t("ui.assetStore.text.0425004b"));
    return null;
  }
}
