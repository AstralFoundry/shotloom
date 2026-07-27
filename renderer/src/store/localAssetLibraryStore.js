import { computed, reactive } from '@/store/domainReactivity';
import { desktopApi } from '@/services/desktopApi';
import { store, touchProject } from '@/store/projectStore';
import { uid } from '@/utils/format';
import { joinAssetPath, projectAssetRoot } from '@/utils/assetPaths.mjs';

const emptyCatalog = () => ({ storageVersion: 1, materials: [], assets: [], references: [] });

export const localAssetLibrary = reactive({
  loaded: false,
  loading: false,
  catalog: emptyCatalog(),
});

function normalizeCatalog(value) {
  return {
    storageVersion: 1,
    updatedAt: value?.updatedAt || '',
    materials: Array.isArray(value?.materials) ? value.materials : [],
    assets: Array.isArray(value?.assets) ? value.assets : [],
    references: Array.isArray(value?.references) ? value.references : [],
  };
}

function projectIdentity() {
  return {
    projectKey: String(store.project?.id || store.filePath || store.projectDir || store.project?.name || 'unsaved-project'),
    projectName: String(store.project?.name || '未命名项目'),
  };
}

async function persistCatalog() {
  const snapshot = JSON.parse(JSON.stringify(localAssetLibrary.catalog));
  snapshot.updatedAt = new Date().toISOString();
  localAssetLibrary.catalog = normalizeCatalog(await desktopApi.localAssets.setCatalog(snapshot));
}

export async function loadLocalAssetLibrary(force = false) {
  if (localAssetLibrary.loaded && !force) return localAssetLibrary.catalog;
  if (localAssetLibrary.loading) return localAssetLibrary.catalog;
  localAssetLibrary.loading = true;
  try {
    localAssetLibrary.catalog = normalizeCatalog(await desktopApi.localAssets.getCatalog());
    localAssetLibrary.loaded = true;
    return localAssetLibrary.catalog;
  } finally {
    localAssetLibrary.loading = false;
  }
}

function extensionFor(material) {
  return String(material.ext || material.name || 'asset.bin').split('.').pop()?.toLowerCase() || 'bin';
}

async function sha256For(material) {
  if (material.checksum && String(material.checksumAlgorithm).toLowerCase() === 'sha256') {
    return { checksum: material.checksum, size: material.size || 0 };
  }
  const checked = await desktopApi.file.checksum(material.path);
  if (!checked?.checksum) throw new Error('无法计算素材校验值');
  return checked;
}

function cardFor(asset, material) {
  const usageCount = localAssetLibrary.catalog.references.filter((item) => item.assetId === asset.id).length;
  return {
    ...material,
    id: material.id,
    assetId: asset.id,
    localLibraryAssetId: asset.id,
    localLibraryMaterialId: material.id,
    name: asset.name || material.name || '未命名素材',
    category: asset.category || 'styles',
    note: asset.note || '',
    tags: asset.tags || [],
    storageScope: 'library',
    scopeLabel: '通用',
    usageCount,
  };
}

export const localAssetCards = computed(() => {
  const materials = new Map(localAssetLibrary.catalog.materials.map((item) => [item.id, item]));
  return localAssetLibrary.catalog.assets
    .map((asset) => cardFor(asset, materials.get(asset.materialId) || {}))
    .filter((item) => item.path);
});

export async function promoteMaterialToLocalLibrary(material, asset = {}) {
  await loadLocalAssetLibrary(true);
  if (!material?.path) throw new Error('素材没有可复用的本地文件');
  const checked = await sha256For(material);
  let libraryMaterial = localAssetLibrary.catalog.materials.find((item) => item.checksum === checked.checksum);
  if (!libraryMaterial) {
    const root = await desktopApi.file.getGlobalAssetRoot();
    const ext = extensionFor(material);
    const directory = joinAssetPath(root, checked.checksum.slice(0, 2));
    const target = joinAssetPath(directory, `${checked.checksum}.${ext}`);
    let saved = { path: target, filePath: target, name: material.name };
    if (!await desktopApi.file.pathExists(target)) {
      saved = await desktopApi.file.copyToDirectory(material.path, directory, `${checked.checksum}.${ext}`);
    }
    libraryMaterial = {
      ...JSON.parse(JSON.stringify(material)),
      id: uid(),
      path: saved.path || saved.filePath || target,
      filePath: saved.filePath || saved.path || target,
      checksum: checked.checksum,
      checksumAlgorithm: 'sha256',
      size: checked.size || material.size || 0,
      storageScope: 'library',
      sourceProjectName: store.project?.name || '',
      importedAt: new Date().toISOString(),
    };
    localAssetLibrary.catalog.materials.unshift(libraryMaterial);
  }
  let libraryAsset = localAssetLibrary.catalog.assets.find((item) => item.materialId === libraryMaterial.id);
  if (!libraryAsset) {
    libraryAsset = {
      id: uid(),
      materialId: libraryMaterial.id,
      name: asset.name || material.name || '未命名素材',
      category: asset.category || 'styles',
      note: asset.note || '',
      tags: Array.isArray(asset.tags) ? [...asset.tags] : [],
      resourceType: asset.resourceType || material.resourceType || 'file',
      nodeType: asset.nodeType || material.nodeType || '',
      createdAt: new Date().toISOString(),
    };
    localAssetLibrary.catalog.assets.unshift(libraryAsset);
  }
  material.localLibraryMaterialId = libraryMaterial.id;
  const projectAsset = store.project.assets.find((item) => item.id === asset.id || item.materialId === material.id);
  if (projectAsset) projectAsset.localLibraryAssetId = libraryAsset.id;
  await persistCatalog();
  touchProject();
  return cardFor(libraryAsset, libraryMaterial);
}

function ensureReference(asset, projectMaterial) {
  if (projectMaterial.storageScope !== 'library') return;
  const identity = projectIdentity();
  const exists = localAssetLibrary.catalog.references.some((item) => (
    item.assetId === asset.id && item.projectKey === identity.projectKey && item.materialId === projectMaterial.id
  ));
  if (!exists) localAssetLibrary.catalog.references.push({
    id: uid(),
    assetId: asset.id,
    libraryMaterialId: asset.materialId,
    materialId: projectMaterial.id,
    ...identity,
    createdAt: new Date().toISOString(),
  });
}

export async function useLocalAssetInProject(card, { copy = false } = {}) {
  await loadLocalAssetLibrary(true);
  const libraryAsset = localAssetLibrary.catalog.assets.find((item) => item.id === card.localLibraryAssetId || item.id === card.assetId);
  const libraryMaterial = localAssetLibrary.catalog.materials.find((item) => item.id === libraryAsset?.materialId || item.id === card.localLibraryMaterialId);
  if (!libraryAsset || !libraryMaterial?.path) throw new Error('通用素材已不存在或文件缺失');
  if (!await desktopApi.file.pathExists(libraryMaterial.path)) throw new Error('通用素材文件已丢失，请重新加入素材库');
  let projectMaterial = store.project.materials.find((item) => item.localLibraryMaterialId === libraryMaterial.id);
  if (projectMaterial && copy && projectMaterial.storageScope === 'library') {
    const root = projectAssetRoot(store.project, store.projectDir);
    if (!root) throw new Error('当前项目还没有可写入的素材目录');
    const copied = await desktopApi.file.copyToDirectory(libraryMaterial.path, root, libraryMaterial.name);
    projectMaterial.path = copied.path || copied.filePath;
    projectMaterial.filePath = projectMaterial.path;
    projectMaterial.storageScope = 'project';
    projectMaterial.source = 'local-library-copy';
    projectMaterial.sourceType = 'local-library-copy';
    const identity = projectIdentity();
    localAssetLibrary.catalog.references = localAssetLibrary.catalog.references.filter((item) => !(
      item.projectKey === identity.projectKey && item.materialId === projectMaterial.id
    ));
  }
  if (!projectMaterial) {
    let path = libraryMaterial.path;
    let storageScope = 'library';
    if (copy) {
      const root = projectAssetRoot(store.project, store.projectDir);
      if (!root) throw new Error('当前项目还没有可写入的素材目录');
      const copied = await desktopApi.file.copyToDirectory(libraryMaterial.path, root, libraryMaterial.name);
      path = copied.path || copied.filePath;
      storageScope = 'project';
    }
    projectMaterial = {
      ...JSON.parse(JSON.stringify(libraryMaterial)),
      id: uid(),
      path,
      filePath: path,
      storageScope,
      localLibraryMaterialId: libraryMaterial.id,
      source: copy ? 'local-library-copy' : 'local-library-reference',
      sourceType: copy ? 'local-library-copy' : 'local-library-reference',
      importedAt: new Date().toISOString(),
    };
    store.project.materials.unshift(projectMaterial);
  }
  let projectAsset = store.project.assets.find((item) => item.localLibraryAssetId === libraryAsset.id);
  if (!projectAsset) {
    projectAsset = {
      ...JSON.parse(JSON.stringify(libraryAsset)),
      id: uid(),
      materialId: projectMaterial.id,
      localLibraryAssetId: libraryAsset.id,
      createdAt: new Date().toISOString(),
    };
    store.project.assets.unshift(projectAsset);
  }
  ensureReference(libraryAsset, projectMaterial);
  await persistCatalog();
  touchProject();
  return { material: projectMaterial, asset: projectAsset, referenced: !copy };
}

export async function releaseLocalAssetReference(materialId) {
  await loadLocalAssetLibrary(true);
  const identity = projectIdentity();
  const before = localAssetLibrary.catalog.references.length;
  localAssetLibrary.catalog.references = localAssetLibrary.catalog.references.filter((item) => !(
    item.projectKey === identity.projectKey && item.materialId === materialId
  ));
  if (localAssetLibrary.catalog.references.length !== before) await persistCatalog();
}

export async function releaseAllLocalAssetReferences(projectKey) {
  if (!projectKey) return;
  await loadLocalAssetLibrary(true);
  const before = localAssetLibrary.catalog.references.length;
  localAssetLibrary.catalog.references = localAssetLibrary.catalog.references
    .filter((item) => item.projectKey !== projectKey);
  if (before !== localAssetLibrary.catalog.references.length) await persistCatalog();
}

export async function reconcileCurrentProjectLocalAssetReferences() {
  await loadLocalAssetLibrary(true);
  const identity = projectIdentity();
  localAssetLibrary.catalog.references = localAssetLibrary.catalog.references
    .filter((item) => item.projectKey !== identity.projectKey);
  for (const material of store.project.materials || []) {
    if (material.storageScope !== 'library' || !material.localLibraryMaterialId) continue;
    const asset = localAssetLibrary.catalog.assets.find((item) => item.materialId === material.localLibraryMaterialId);
    if (asset) ensureReference(asset, material);
  }
  await persistCatalog();
}

export async function deleteLocalLibraryAsset(assetId) {
  await loadLocalAssetLibrary(true);
  const asset = localAssetLibrary.catalog.assets.find((item) => item.id === assetId);
  if (!asset) return { ok: false, error: '通用素材不存在' };
  const references = localAssetLibrary.catalog.references.filter((item) => item.assetId === asset.id);
  if (references.length) {
    return { ok: false, error: `仍被 ${new Set(references.map((item) => item.projectKey)).size} 个项目引用，不能删除` };
  }
  localAssetLibrary.catalog.assets = localAssetLibrary.catalog.assets.filter((item) => item.id !== asset.id);
  const materialStillUsed = localAssetLibrary.catalog.assets.some((item) => item.materialId === asset.materialId);
  if (!materialStillUsed) {
    const material = localAssetLibrary.catalog.materials.find((item) => item.id === asset.materialId);
    localAssetLibrary.catalog.materials = localAssetLibrary.catalog.materials.filter((item) => item.id !== asset.materialId);
    if (material?.path) await desktopApi.file.trash(material.path);
  }
  await persistCatalog();
  return { ok: true };
}
