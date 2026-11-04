import { t } from '../i18n/index.ts';
import { computed, reactive } from '@/store/domainReactivity';
import { desktopApi } from '@/services/desktopApi';
import { store, touchProject } from '@/store/projectStore';
import { assetCategoryFor } from '@/domain/asset/assetCategories';
import { uid } from '@/utils/format';
import { joinAssetPath, projectAssetRoot } from '@/utils/assetPaths.ts';

// 素材库目录条目是数据库记录；卡片与引用都允许历史扩展字段，按 AnyRecord 读写。
type AnyRecord = Record<string, any>;


const emptyCatalog = () => ({ storageVersion: 1, materials: [] as AnyRecord[], assets: [] as AnyRecord[], references: [] as AnyRecord[] });

export const localAssetLibrary = reactive({
  loaded: false,
  loading: false,
  catalog: emptyCatalog(),
});

function normalizeCatalog(value: AnyRecord | null | undefined) {
  return {
    storageVersion: 1,
    updatedAt: String(value?.updatedAt || ''),
    materials: Array.isArray(value?.materials) ? value.materials : [],
    assets: Array.isArray(value?.assets) ? value.assets : [],
    references: Array.isArray(value?.references) ? value.references : [],
  };
}

function projectIdentity() {
  return {
    projectKey: String(store.project?.id || store.filePath || store.projectDir || store.project?.name || 'unsaved-project'),
    projectName: String(store.project?.name || t("ui.ProjectCard.text.060f1435")),
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

function extensionFor(material: AnyRecord) {
  return String(material.ext || material.name || 'asset.bin').split('.').pop()?.toLowerCase() || 'bin';
}

async function sha256For(material: AnyRecord) {
  if (material.checksum && String(material.checksumAlgorithm).toLowerCase() === 'sha256') {
    return { checksum: material.checksum, size: material.size || 0 };
  }
  const checked = await desktopApi.file.checksum(material.path);
  if (!checked?.checksum) throw new Error(t("errors.c6c4bdbfc2"));
  return checked;
}

function cardFor(asset: AnyRecord, material: AnyRecord) {
  const usageCount = localAssetLibrary.catalog.references.filter((item: AnyRecord) => item.assetId === asset.id).length;
  return {
    ...material,
    id: material.id,
    assetId: asset.id,
    localLibraryAssetId: asset.id,
    localLibraryMaterialId: material.id,
    name: asset.name || material.name || t("ui.canvasMediaSelection.text.b61b7f74"),
    category: assetCategoryFor(asset.category).id,
    note: asset.note || '',
    tags: asset.tags || [],
    storageScope: 'library',
    scopeLabel: t("ui.resourceLibraryAdapter.text.1a0fdce8"),
    usageCount,
  };
}

export const localAssetCards = computed(() => {
  const materials = new Map(localAssetLibrary.catalog.materials.map((item: AnyRecord) => [item.id, item] as const));
  return localAssetLibrary.catalog.assets
    .map((asset: AnyRecord) => cardFor(asset, materials.get(asset.materialId) || {}))
    .filter((item: AnyRecord) => item.path);
});

export async function promoteMaterialToLocalLibrary(material: AnyRecord, asset: AnyRecord = {}) {
  await loadLocalAssetLibrary(true);
  if (!material?.path) throw new Error(t("errors.a99eef2189"));
  const checked = await sha256For(material);
  let libraryMaterial = localAssetLibrary.catalog.materials.find((item: AnyRecord) => item.checksum === checked.checksum);
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
      sourceFilePath: material.path,
      storageScope: 'library',
      sourceProjectName: store.project?.name || '',
      importedAt: new Date().toISOString(),
    } as AnyRecord;
    localAssetLibrary.catalog.materials.unshift(libraryMaterial);
  }
  let libraryAsset = localAssetLibrary.catalog.assets.find((item: AnyRecord) => item.materialId === libraryMaterial.id);
  if (!libraryAsset) {
    libraryAsset = {
      id: uid(),
      materialId: libraryMaterial.id,
      name: asset.name || material.name || t("ui.canvasMediaSelection.text.b61b7f74"),
      category: assetCategoryFor(asset.category).id,
      note: asset.note || '',
      tags: Array.isArray(asset.tags) ? [...asset.tags] : [],
      resourceType: asset.resourceType || material.resourceType || 'file',
      nodeType: asset.nodeType || material.nodeType || '',
      createdAt: new Date().toISOString(),
    };
    localAssetLibrary.catalog.assets.unshift(libraryAsset);
  }
  material.localLibraryMaterialId = libraryMaterial.id;
  const projectAsset = store.project.assets.find((item: AnyRecord) => item.id === asset.id || item.materialId === material.id);
  if (projectAsset) projectAsset.localLibraryAssetId = libraryAsset.id;
  await persistCatalog();
  touchProject();
  return cardFor(libraryAsset, libraryMaterial);
}

function ensureReference(asset: AnyRecord, projectMaterial: AnyRecord) {
  if (projectMaterial.storageScope !== 'library') return;
  const identity = projectIdentity();
  const exists = localAssetLibrary.catalog.references.some((item: AnyRecord) => (
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

export async function useLocalAssetInProject(card: AnyRecord, { copy = false }: { copy?: boolean } = {}) {
  await loadLocalAssetLibrary(true);
  const libraryAsset = localAssetLibrary.catalog.assets.find((item: AnyRecord) => item.id === card.localLibraryAssetId || item.id === card.assetId);
  const libraryMaterial = localAssetLibrary.catalog.materials.find((item: AnyRecord) => item.id === libraryAsset?.materialId || item.id === card.localLibraryMaterialId);
  if (!libraryAsset || !libraryMaterial?.path) throw new Error(t("errors.5f966e3392"));
  if (!await desktopApi.file.pathExists(libraryMaterial.path)) throw new Error(t("errors.34998ab5e0"));
  let projectMaterial = store.project.materials.find((item: AnyRecord) => item.localLibraryMaterialId === libraryMaterial.id);
  if (projectMaterial && copy && projectMaterial.storageScope === 'library') {
    const root = projectAssetRoot(store.project, store.projectDir);
    if (!root) throw new Error(t("errors.c2fc00e90d"));
    const copied = await desktopApi.file.copyToDirectory(libraryMaterial.path, root, libraryMaterial.name);
    projectMaterial.path = copied.path || copied.filePath;
    projectMaterial.filePath = projectMaterial.path;
    projectMaterial.storageScope = 'project';
    projectMaterial.source = 'local-library-copy';
    projectMaterial.sourceType = 'local-library-copy';
    const identity = projectIdentity();
    localAssetLibrary.catalog.references = localAssetLibrary.catalog.references.filter((item: AnyRecord) => !(
      item.projectKey === identity.projectKey && item.materialId === projectMaterial.id
    ));
  }
  if (!projectMaterial) {
    let path = libraryMaterial.path;
    let storageScope = 'library';
    if (copy) {
      const root = projectAssetRoot(store.project, store.projectDir);
      if (!root) throw new Error(t("errors.c2fc00e90d"));
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
  let projectAsset = store.project.assets.find((item: AnyRecord) => item.localLibraryAssetId === libraryAsset?.id);
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

export async function releaseLocalAssetReference(materialId: string) {
  await loadLocalAssetLibrary(true);
  const identity = projectIdentity();
  const before = localAssetLibrary.catalog.references.length;
  localAssetLibrary.catalog.references = localAssetLibrary.catalog.references.filter((item: AnyRecord) => !(
    item.projectKey === identity.projectKey && item.materialId === materialId
  ));
  if (localAssetLibrary.catalog.references.length !== before) await persistCatalog();
}

export async function releaseAllLocalAssetReferences(projectKey: string) {
  if (!projectKey) return;
  await loadLocalAssetLibrary(true);
  const before = localAssetLibrary.catalog.references.length;
  localAssetLibrary.catalog.references = localAssetLibrary.catalog.references
    .filter((item: AnyRecord) => item.projectKey !== projectKey);
  if (before !== localAssetLibrary.catalog.references.length) await persistCatalog();
}

export async function reconcileCurrentProjectLocalAssetReferences() {
  await loadLocalAssetLibrary(true);
  const identity = projectIdentity();
  localAssetLibrary.catalog.references = localAssetLibrary.catalog.references
    .filter((item: AnyRecord) => item.projectKey !== identity.projectKey);
  for (const material of (store.project.materials || []) as AnyRecord[]) {
    if (material.storageScope !== 'library' || !material.localLibraryMaterialId) continue;
    const asset = localAssetLibrary.catalog.assets.find((item: AnyRecord) => item.materialId === material.localLibraryMaterialId);
    if (asset) ensureReference(asset, material);
  }
  await persistCatalog();
}

export async function deleteLocalLibraryAsset(assetId: string) {
  await loadLocalAssetLibrary(true);
  const asset = localAssetLibrary.catalog.assets.find((item: AnyRecord) => item.id === assetId);
  if (!asset) return { ok: false, error: t("ui.localAssetLibraryStore.text.291eddce") };
  const references = localAssetLibrary.catalog.references.filter((item: AnyRecord) => item.assetId === asset.id);
  if (references.length) {
    return { ok: false, error: t("ui.localAssetLibraryStore.text.ae12865c", { value0: String(new Set(references.map((item: AnyRecord) => item.projectKey)).size) }) };
  }
  localAssetLibrary.catalog.assets = localAssetLibrary.catalog.assets.filter((item: AnyRecord) => item.id !== asset.id);
  const materialStillUsed = localAssetLibrary.catalog.assets.some((item: AnyRecord) => item.materialId === asset.materialId);
  if (!materialStillUsed) {
    const material = localAssetLibrary.catalog.materials.find((item: AnyRecord) => item.id === asset.materialId);
    localAssetLibrary.catalog.materials = localAssetLibrary.catalog.materials.filter((item: AnyRecord) => item.id !== asset.materialId);
    if (material?.path) await desktopApi.file.trash(material.path);
  }
  await persistCatalog();
  return { ok: true };
}

/** An explicit asset edit never changes the source canvas node. */
export async function updateLocalAssetCategory(assetId: string, category: string) {
  await loadLocalAssetLibrary(true);
  const asset = localAssetLibrary.catalog.assets.find((item: AnyRecord) => item.id === assetId);
  if (!asset) throw new Error(t('assets.collection.missing'));
  asset.category = assetCategoryFor(category).id;
  await persistCatalog();
}
