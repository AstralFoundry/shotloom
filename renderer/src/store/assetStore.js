import { computed } from '@/store/domainReactivity';
import { assetCategories } from '@/constants/navigation';
import { desktopApi } from '@/services/desktopApi';
import { store, touchProject } from '@/store/projectStore';
import { showToast } from '@/composables/useToast';
import { uid } from '@/utils/format';
import { recordCanvasHistory } from '@/store/canvasHistoryStore';
import { addNode } from '@/store/nodeStore';
import { isPathInsideAssetRoot, projectAssetRoot } from '@/utils/assetPaths.mjs';
import { releaseLocalAssetReference } from '@/store/localAssetLibraryStore';

/**
 * 按当前分类和关键词过滤已绑定真实文件的素材库条目。
 * @type {{ readonly value: Array }}
 */
export const filteredAssets = computed(() => {
  const keyword = store.assetKeyword.trim().toLowerCase();
  const category = findAssetCategory(store.assetCategory);
  return store.project.assets.filter((asset) => {
    if (!asset.materialId) return false;
    const inBucket = categoryMatches(asset.category, category);
    const text = [asset.name, asset.code, asset.phone, asset.note, asset.resourceType, asset.nodeType, ...(asset.tags || [])]
      .join(' ')
      .toLowerCase();
    return inBucket && (!keyword || text.includes(keyword));
  });
});

function findAssetCategory(categoryId) {
  return assetCategories.find((category) => (
    category.id === categoryId || category.aliases?.includes(categoryId)
  )) || assetCategories[0];
}

function categoryMatches(assetCategory, activeCategory) {
  return assetCategory === activeCategory.id || activeCategory.aliases?.includes(assetCategory);
}

function fileExt(file = {}) {
  return String(file.ext || file.name || file.fileName || file.path || file.filePath || '')
    .split('.')
    .pop()
    ?.toLowerCase() || '';
}

function displayName(file = {}) {
  return file.name || file.fileName || '未命名文件';
}

export function resourceTypeLabel(resourceType) {
  return {
    image: '图片',
    video: '视频',
    audio: '音频',
    text: '文本',
    file: '文件',
  }[resourceType] || '文件';
}

export function assetNodeTypeLabel(nodeType) {
  return {
    imageGeneration: '图片节点',
    videoGeneration: '视频节点',
    audioGeneration: '音频节点',
    textGeneration: '文本节点',
  }[nodeType] || '';
}

export function inferFileResourceType(file = {}) {
  const mime = String(file.type || file.mimeType || '').toLowerCase();
  const ext = fileExt(file);
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'svg'].includes(ext)) return 'image';
  if (mime.startsWith('video/') || ['mp4', 'mov', 'webm', 'm4v'].includes(ext)) return 'video';
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext)) return 'audio';
  if (mime.startsWith('text/') || ['txt', 'md', 'json', 'csv', 'log'].includes(ext)) return 'text';
  return 'file';
}

function nodeTypeForMaterial(material = {}) {
  const resourceType = material.resourceType || inferFileResourceType(material);
  return {
    image: 'imageGeneration',
    video: 'videoGeneration',
    audio: 'audioGeneration',
    text: 'textGeneration',
    file: 'textGeneration',
  }[resourceType] || 'textGeneration';
}

/**
 * 将素材文件/素材库条目应用到创作画布。
 * 不创建独立 resource 节点，而是创建对应生成节点，并把素材挂到 uploadedFile 作为参考输入。
 * @param {Object} material
 * @returns {Object|null}
 */
export function applyMaterialToCanvas(material = {}) {
  if (!material || (!material.id && !material.assetId)) {
    showToast('素材无效，无法应用到画布');
    return null;
  }
  const resourceType = material.resourceType || inferFileResourceType(material);
  const nodeType = material.nodeType && ['imageGeneration', 'videoGeneration', 'audioGeneration', 'textGeneration'].includes(material.nodeType)
    ? material.nodeType
    : nodeTypeForMaterial({ ...material, resourceType });
  const title = material.name || material.fileName || '素材参考';
  const filePath = material.path || material.filePath || '';
  recordCanvasHistory('应用素材到画布');
  const node = addNode(nodeType);
  node.title = title;
  node.prompt = material.note || material.content || material.description || '';
  node.content = material.note || material.content || filePath || title;
  node.materialId = material.materialId || material.id || '';
  node.assetId = material.assetId || '';
  node.resourceType = resourceType;
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
  showToast('已应用到画布');
  return node;
}

/**
 * 记录一个真实素材文件。
 * 默认只进入“素材文件”；只有显式传入 createAsset: true 或点击“加入素材库”时，才创建素材库设定条目。
 */
export function registerImportedMaterial(file = {}, options = {}) {
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
  const material = {
    id: options.materialId || uid(),
    path: file.path || file.filePath || '',
    name: displayName(file),
    ext: fileExt(file),
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

  let asset = null;
  if (options.createAsset === true) {
    asset = {
      id: options.assetId || uid(),
      name: material.name,
      code: assetNodeTypeLabel(nodeType) || resourceTypeLabel(resourceType),
      phone: '',
      category: options.category || store.assetCategory,
      note: options.note || `${resourceTypeLabel(resourceType)}参考文件，已收录到素材文件。`,
      tags: [
        options.assetTag || '上传参考',
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

export function findMaterialByChecksum(checksum) {
  const value = String(checksum || '').trim();
  if (!value) return null;
  return store.project.materials.find((material) => material.checksum === value) || null;
}

async function ensureFileChecksum(file = {}) {
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

export async function copyFileIntoProjectAssets(file = {}) {
  const source = await ensureFileChecksum(file);
  const existing = findMaterialByChecksum(source.checksum);
  if (existing) {
    showToast('已复用已有素材');
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
    const root = projectAssetRoot(store.project, store.projectDir);
    if (!root) throw new Error('当前项目还没有可写入的素材目录');
    const copied = await desktopApi.file.copyToDirectory?.(sourcePath, root, displayName(source));
    if (!copied?.filePath && !copied?.path) return file;
    return {
      ...source,
      path: copied.filePath || copied.path,
      filePath: copied.filePath || copied.path,
      name: copied.name || displayName(source),
      fileName: copied.name || source.fileName || displayName(source),
      ext: copied.ext || source.ext || fileExt(source),
      size: copied.size || source.size || 0,
      checksum: copied.checksum || source.checksum || '',
      checksumAlgorithm: copied.checksumAlgorithm || source.checksumAlgorithm || 'md5',
      copiedAt: copied.copiedAt || new Date().toISOString(),
      originalPath: sourcePath,
    };
  } catch (error) {
    showToast(error?.message || '复制素材到项目文件夹失败');
    return file;
  }
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
  const materials = store.project.materials || [];
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

    store.project.nodes.forEach((node) => {
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
    showToast(`已迁移 ${migratedCount} 个素材到项目文件夹`);
  }
  return migratedCount;
}

function sourceTypeLabel(sourceType) {
  return {
    'canvas-upload': '画布上传',
    'material-import': '导入参考',
    generation: '生成结果',
    'resource-replace': '替换资源',
  }[sourceType] || '素材文件';
}

function defaultAssetCategoryForMaterial(material = {}) {
  if (material.nodeType === 'imageGeneration' || material.nodeType === 'videoGeneration') return 'styles';
  if (material.nodeType === 'textGeneration') return 'shots';
  return store.assetCategory || 'styles';
}

/**
 * 将已有素材文件提升为素材库设定条目。
 * @param {Object} material - project.materials 中的文件记录
 * @returns {Object|null} 新建的素材设定；已存在时返回 null
 */
export function addMaterialToAssetLibrary(material = {}, options = {}) {
  if (!material.id) return null;
  const exists = store.project.assets.some((asset) => asset.materialId === material.id);
  if (exists) {
    showToast('这个文件已经在素材库里');
    return null;
  }

  const resourceType = material.resourceType || inferFileResourceType(material);
  const sourceType = material.sourceType || material.source || 'material-file';
  const category = options.category || defaultAssetCategoryForMaterial(material);
  const asset = {
    id: uid(),
    name: material.name || '未命名素材',
    code: assetNodeTypeLabel(material.nodeType) || resourceTypeLabel(resourceType),
    phone: '',
    category,
    note: `${resourceTypeLabel(resourceType)}参考文件，已收录到素材文件。`,
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
  showToast('已加入素材库');
  return asset;
}

export function deleteAssetFromLibrary(assetId) {
  if (!assetId) return false;
  const before = store.project.assets.length;
  store.project.assets = store.project.assets.filter((asset) => asset.id !== assetId);
  if (store.project.assets.length === before) return false;
  if (store.project.library?.enabled || store.project.series?.enabled) {
    store.project.sharedLibraryDeletedAssetIds = [
      ...new Set([...(store.project.sharedLibraryDeletedAssetIds || []), assetId]),
    ];
  }
  touchProject();
  showToast('已从素材库移除');
  return true;
}

export async function deleteMaterialFile(materialId) {
  if (!materialId) return { ok: false, error: '素材文件不存在' };
  const material = store.project.materials.find((item) => item.id === materialId);
  if (!material) return { ok: false, error: '素材文件不存在' };
  const usedByNode = store.project.nodes.some((node) => (
    node.materialId === materialId || node.uploadedFile?.materialId === materialId
  ));
  const usedByTask = store.project.tasks.some((task) => (
    task.result?.archivedFiles || []
  ).some((file) => file.id === materialId));
  if (usedByNode || usedByTask) {
    return { ok: false, error: '素材仍被画布节点或生成任务使用，请先移除引用' };
  }
  const before = store.project.materials.length;
  store.project.materials = store.project.materials.filter((material) => material.id !== materialId);
  if (store.project.materials.length === before) return { ok: false, error: '素材文件不存在' };
  const removedAssetIds = store.project.assets
    .filter((asset) => asset.materialId === materialId)
    .map((asset) => asset.id);
  store.project.assets = store.project.assets.filter((asset) => asset.materialId !== materialId);
  if ((store.project.library?.enabled || store.project.series?.enabled) && removedAssetIds.length) {
    store.project.sharedLibraryDeletedAssetIds = [
      ...new Set([...(store.project.sharedLibraryDeletedAssetIds || []), ...removedAssetIds]),
    ];
  }
  await releaseLocalAssetReference(materialId);
  const localProjectRoot = store.projectDir ? projectAssetRoot({}, store.projectDir) : '';
  const samePathStillUsed = store.project.materials.some((item) => item.path && item.path === material.path);
  if (!samePathStillUsed && material.storageScope !== 'library'
    && isPathInsideAssetRoot(material.path, localProjectRoot)) {
    try { await desktopApi.file.trash?.(material.path); } catch { /* metadata deletion remains valid */ }
  }
  touchProject();
  showToast('已删除素材文件记录');
  return { ok: true };
}

export function renameMaterialFile(materialId, name) {
  const nextName = String(name || '').trim();
  if (!materialId || !nextName) return false;
  const material = store.project.materials.find((item) => item.id === materialId);
  if (!material) return false;
  material.name = nextName;
  material.fileName = nextName;
  material.updatedAt = new Date().toISOString();

  store.project.assets.forEach((asset) => {
    if (asset.materialId === materialId) asset.name = nextName;
  });
  store.project.nodes.forEach((node) => {
    if (node.materialId === materialId) {
      node.fileName = nextName;
      if (node.uploadedFile) node.uploadedFile.name = nextName;
      if (node.type === 'resource') node.title = nextName;
    }
  });

  touchProject();
  showToast('已重命名');
  return true;
}

export function renameAssetInLibrary(assetId, name) {
  const nextName = String(name || '').trim();
  if (!assetId || !nextName) return false;
  const asset = store.project.assets.find((item) => item.id === assetId);
  if (!asset) return false;
  asset.name = nextName;
  asset.updatedAt = new Date().toISOString();
  touchProject();
  showToast('已重命名');
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
      assetTag: '导入参考',
      createAsset: false,
    });
  }
  touchProject();
  showToast(`已导入 ${files.length} 个素材`);
}

export async function exportResourcePackage(scope = 'materials') {
  const libraryOnly = scope === 'library';
  const assets = (store.project.assets || []).filter((asset) => asset.materialId);
  const materialIds = new Set(assets.map((asset) => asset.materialId));
  const materials = (store.project.materials || []).filter((material) => !libraryOnly || materialIds.has(material.id));
  if (!materials.length) {
    showToast(libraryOnly ? '素材库中没有可导出的资源' : '没有可导出的素材文件');
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
      ? `已导出 ${result.count} 个资源到 ${result.filePath}`
      : `已导出 ${result.count} 个资源`);
    return result;
  } catch (error) {
    showToast(error?.message || '导出资源包失败');
    return null;
  }
}

export async function importResourcePackage() {
  try {
    const result = await desktopApi.file.importResourcePackage?.();
    if (!result) return null;
    const existingByChecksum = new Map((store.project.materials || [])
      .filter((item) => item.checksum)
      .map((item) => [item.checksum, item]));
    const idMap = new Map();
    let addedMaterials = 0;
    for (const imported of result.materials || []) {
      const existing = imported.checksum ? existingByChecksum.get(imported.checksum) : null;
      if (existing) {
        idMap.set(imported.id, existing.id);
        if (imported.path && imported.path !== existing.path) {
          try { await desktopApi.file.trash?.(imported.path); } catch { /* keep imported file if cleanup fails */ }
        }
        continue;
      }
      const oldId = imported.id;
      const material = { ...imported, id: uid(), source: 'resource-package', sourceType: 'resource-package' };
      idMap.set(oldId, material.id);
      store.project.materials.unshift(material);
      if (material.checksum) existingByChecksum.set(material.checksum, material);
      addedMaterials += 1;
    }
    const existingAssetMaterialIds = new Set((store.project.assets || []).map((asset) => asset.materialId));
    let addedAssets = 0;
    for (const imported of result.assets || []) {
      const materialId = idMap.get(imported.materialId);
      if (!materialId || existingAssetMaterialIds.has(materialId)) continue;
      store.project.assets.unshift({ ...imported, id: uid(), materialId, createdAt: new Date().toISOString() });
      existingAssetMaterialIds.add(materialId);
      addedAssets += 1;
    }
    if (addedMaterials || addedAssets) touchProject();
    showToast(`已导入 ${addedMaterials} 个文件${addedAssets ? `，${addedAssets} 个素材库条目` : ''}`);
    return { addedMaterials, addedAssets };
  } catch (error) {
    showToast(error?.message || '导入资源包失败');
    return null;
  }
}
