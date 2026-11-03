import { t } from '@/i18n';
import { desktopApi } from "../../services/desktopApi.ts";
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
} from "../../store/assetStore.ts";
import {
  deleteLocalLibraryAsset,
  loadLocalAssetLibrary,
  localAssetCards,
  promoteMaterialToLocalLibrary,
  useLocalAssetInProject,
} from "../../store/localAssetLibraryStore.ts";
import { store, touchProject } from "../../store/projectStore.ts";
import { openMediaViewer } from "../store/overlayStore";
import { showToast } from "../../store/notificationStore";
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
      id: String(material.id || asset.id || ""),
      assetId: String(asset.id || ""),
      name: asset.name || material.name || t("ui.canvasMediaSelection.text.b61b7f74"),
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
      scopeLabel: asset.localLibraryAssetId ? t("ui.resourceLibraryAdapter.text.b4db1315") : t("ui.resourceLibraryAdapter.text.22336e6b"),
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
        ? t("ui.resourceLibraryAdapter.text.bd30d35c", { value0: projectMaterial?.storageScope === "library" ? t("ui.resourceLibraryAdapter.text.341e9c9c") : t("ui.resourceLibraryAdapter.text.e381a576") })
        : t("ui.resourceLibraryAdapter.text.1a0fdce8"),
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
    title: String(item.name || t("ui.resourceLibraryAdapter.text.41b9abc7")),
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
    if (result?.ok === false) showToast(result.error || t("ui.resourceLibraryAdapter.text.937f70f0"));
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
    if (!result.ok) showToast(result.error || t("ui.resourceLibraryAdapter.text.72250c59"));
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
    return renameAssetInLibrary(String(item.assetId || item.id || ""), name);
  },
  deleteProjectAsset(item) {
    return deleteAssetFromLibrary(String(item.assetId || item.id || ""));
  },
  async deleteLocalAsset(item) {
    if (!item.assetId) return false;
    const result = await deleteLocalLibraryAsset(item.assetId);
    showToast(result.ok ? t("ui.resourceLibraryAdapter.text.2ef28f7e") : result.error || t("ui.resourceLibraryAdapter.text.72250c59"));
    return result.ok;
  },
  async promoteLocal(item) {
    const material = materialMap().get(String(item.id || "")) || item;
    await promoteMaterialToLocalLibrary(material, item);
    showToast(t("ui.resourceLibraryAdapter.text.338e2261"));
  },
  async referenceProject(item) {
    await useLocalAssetInProject(item, { copy: false });
    showToast(t("ui.resourceLibraryAdapter.text.888bfc46"));
  },
  async copyProject(item) {
    await useLocalAssetInProject(item, { copy: true });
    showToast(t("ui.resourceLibraryAdapter.text.8f1a648e"));
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
  async exportSelected(items) {
    const paths = [...new Set(items.map((item) => String(item.path || item.filePath || "")).filter(Boolean))];
    if (!paths.length) return showToast(t("ui.resourceLibraryAdapter.text.9c9e2b3b"));
    const result = paths.length === 1
      ? await desktopApi.file.exportFile(paths[0], String(items[0]?.name || ""))
      : await desktopApi.file.exportFilesPackage(paths, "selected-assets");
    if (result?.ok === false) return showToast(t("ui.resourceLibraryAdapter.text.f8bc5fb3"));
    if (result) showToast(t("ui.resourceLibraryAdapter.text.11343c75", { value0: paths.length }));
  },
  moveProjectAssets(items, category) {
    const ids = new Set(items.map((item) => String(item.assetId || item.id || "")));
    let changed = 0;
    for (const asset of store.project.assets || []) {
      if (!ids.has(String(asset.id)) || asset.category === category) continue;
      asset.category = category;
      changed++;
    }
    if (changed) { touchProject(); showToast(t("ui.resourceLibraryAdapter.text.afffa005", { value0: changed })); }
  },
  async importFiles() {
    await importAssetFiles();
  },
};

export async function initializeResourceLibraries() {
  await loadLocalAssetLibrary();
}
