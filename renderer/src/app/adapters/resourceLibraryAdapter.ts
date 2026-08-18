import { desktopApi } from "../../services/desktopApi.js";
import {
  addMaterialToAssetLibrary,
  deleteAssetFromLibrary,
  deleteMaterialFile,
  exportResourcePackage,
  importAssetFiles,
  importResourcePackage,
  migrateProjectMaterialsIntoAssets,
  renameAssetInLibrary,
  renameMaterialFile,
} from "../../store/assetStore.js";
import {
  deleteLocalLibraryAsset,
  loadLocalAssetLibrary,
  localAssetCards,
  promoteMaterialToLocalLibrary,
  useLocalAssetInProject,
} from "../../store/localAssetLibraryStore.js";
import { store } from "../../store/projectStore.js";
import { openMediaViewer, showToast } from "../store/overlayStore";
import type { MaterialItem } from "../components/MaterialGrid";
import type { AssetsController } from "../views/AssetsView";
import type { MaterialsController } from "../views/MaterialsView";

const materialMap = () =>
  new Map<string, MaterialItem>(
    (store.project.materials || []).map((item: MaterialItem) => [String(item.id || ""), item]),
  );
export function resourceLibraryData() {
  const materials = materialMap();
  const visibleAssets = (store.project.assets || []) as MaterialItem[];
  const projectAssetByLocalId = new Map<string, MaterialItem>(
    (store.project.assets || [])
      .filter((asset: MaterialItem) => asset.localLibraryAssetId)
      .map((asset: MaterialItem) => [String(asset.localLibraryAssetId), asset]),
  );
  const projectAssets = visibleAssets.map((asset: MaterialItem) => {
    const material: MaterialItem =
      materials.get(String(asset.materialId || "")) || ({} as MaterialItem);
    return {
      ...material,
      id: material.id || asset.id,
      assetId: asset.id,
      name: asset.name || material.name || "未命名素材",
      path: material.path || "",
      ext: material.ext || "",
      size: material.size || 0,
      mimeType: material.mimeType || "",
      resourceType: asset.resourceType || material.resourceType || "file",
      sourceType: asset.sourceType || material.sourceType || material.source || "asset-library",
      nodeType: asset.nodeType || material.nodeType || "",
      note: asset.note || material.note || "",
      category: asset.category || "",
      tags: Array.isArray(asset.tags) ? asset.tags : [],
      content: material.content || asset.note || "",
      createdAt: asset.createdAt || material.importedAt || "",
      importedAt: asset.createdAt || material.importedAt,
      localLibraryAssetId: asset.localLibraryAssetId || "",
      scopeLabel: asset.localLibraryAssetId ? "已加入通用" : "项目",
      storageScope: material.storageScope || "project",
    };
  });
  const localAssets = (localAssetCards.value || []).map((item: MaterialItem) => {
    const projectAsset = projectAssetByLocalId.get(String(item.assetId || ""));
    const projectMaterial = projectAsset && materials.get(String(projectAsset.materialId || ""));
    return {
      ...item,
      inCurrentProject: Boolean(projectAsset),
      projectStorageScope: projectMaterial?.storageScope || "",
      scopeLabel: projectAsset
        ? `通用·${projectMaterial?.storageScope === "library" ? "已引用" : "已复制"}`
        : "通用",
    };
  });
  return {
    materials: (store.project.materials || []) as MaterialItem[],
    projectAssets,
    localAssets,
    assetMaterialIds: new Set(
      visibleAssets.map((asset: MaterialItem) => String(asset.materialId || "")).filter(Boolean),
    ),
  };
}

const preview = (item: MaterialItem, src: string, kind: "image" | "video") =>
  openMediaViewer({
    src,
    kind,
    title: String(item.name || "素材预览"),
    filePath: String(item.path || ""),
  });
const showFile = async (item: MaterialItem) => {
  if (item.path) await desktopApi.file.showItemInFolder(item.path);
};

export const materialsController: MaterialsController = {
  preview,
  showFile,
  async openStorage() {
    await migrateProjectMaterialsIntoAssets();
    const result = await desktopApi.file.openProjectAssets();
    if (result?.ok === false) showToast(result.error || "无法打开项目资源目录");
  },
  addToLibrary(item, category) {
    return Boolean(addMaterialToAssetLibrary(item, { category }));
  },
  rename(item, name) {
    if (!item.id) return false;
    return renameMaterialFile(item.id, name);
  },
  async delete(item) {
    if (!item.id) return false;
    const result = await deleteMaterialFile(item.id);
    if (!result.ok) showToast(result.error || "删除失败");
    return result.ok;
  },
  async importPackage() {
    await importResourcePackage();
  },
  async exportPackage() {
    await exportResourcePackage("materials");
  },
  async importFiles() {
    await importAssetFiles();
  },
};

export const assetsController: AssetsController = {
  preview,
  showFile,
  rename(item, name) {
    return renameAssetInLibrary(item.assetId || item.id, name);
  },
  deleteProjectAsset(item) {
    deleteAssetFromLibrary(item.assetId || item.id);
  },
  async deleteLocalAsset(item) {
    if (!item.assetId) return false;
    const result = await deleteLocalLibraryAsset(item.assetId);
    showToast(result.ok ? "已从通用素材库删除" : result.error || "删除失败");
    return result.ok;
  },
  async promoteLocal(item) {
    const material = materialMap().get(String(item.id || "")) || item;
    await promoteMaterialToLocalLibrary(material, item);
    showToast("已加入通用素材，其他项目现在可以引用");
  },
  async referenceProject(item) {
    await useLocalAssetInProject(item, { copy: false });
    showToast("已引用到当前项目");
  },
  async copyProject(item) {
    await useLocalAssetInProject(item, { copy: true });
    showToast("已复制到当前项目");
  },
  async openLocalStorage() {
    await desktopApi.file.openFolderPath(await desktopApi.file.getGlobalAssetRoot());
  },
  async importPackage() {
    await importResourcePackage();
  },
  async exportPackage() {
    await exportResourcePackage("library");
  },
  async importFiles() {
    await importAssetFiles();
  },
};

export async function initializeResourceLibraries() {
  await loadLocalAssetLibrary();
}
