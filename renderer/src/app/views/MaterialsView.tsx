import { t } from '@/i18n';
import { type MouseEvent, useMemo, useState } from "react";
import { assetCategories, defaultAssetCategory } from "../../domain/asset/assetCategories";
import { EmptyState } from "../components/EmptyState";
import { IconSymbol } from "../components/IconSymbol";
import { MaterialGrid, type MaterialItem } from "../components/MaterialGrid";
import { ProjectScopeHeader } from "../components/ProjectScopeHeader";
import { useAppStore } from "../store/appStore";

export interface MaterialsController {
  preview: (item: MaterialItem, src: string, kind: "image" | "video") => void;
  showFile: (item: MaterialItem) => void | Promise<void>;
  openStorage: () => void | Promise<void>;
  addToLibrary: (
    item: MaterialItem,
    category: string,
  ) => boolean | void | Promise<boolean | void>;
  rename: (
    item: MaterialItem,
    name: string,
  ) => boolean | void | Promise<boolean | void>;
  delete: (item: MaterialItem) => boolean | void | Promise<boolean | void>;
  importPackage: () => void | Promise<void>;
  exportPackage: () => void | Promise<void>;
  importFiles: () => void | Promise<void>;
}

export function MaterialsView(
  { materials, assetMaterialIds, controller }: {
    materials: MaterialItem[];
    assetMaterialIds: Set<string>;
    controller: MaterialsController;
  },
) {
  const [keyword, setKeyword] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [libraryItem, setLibraryItem] = useState<MaterialItem | null>(null);
  const [category, setCategory] = useState(defaultAssetCategory.id);
  const [renameItem, setRenameItem] = useState<MaterialItem | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const currentCategory = useAppStore((state) => state.assetCategory);
  const setRoute = useAppStore((state) => state.setRoute);
  const filtered = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return query
      ? materials.filter((item) =>
        [
          item.name,
          item.ext,
          item.mimeType,
          item.resourceType,
          item.sourceType,
          item.source,
        ].join(" ").toLowerCase().includes(query)
      )
      : materials;
  }, [keyword, materials]);

  function openMenu(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    if (
      (event.target as Element).closest(
        ".material-node-wrap, .resource-context-menu",
      )
    ) return;
    setMenu({
      x: Math.min(event.clientX, window.innerWidth - 202),
      y: Math.min(event.clientY, window.innerHeight - 194),
    });
  }
  async function menuAction(
    action: "openStorage" | "importPackage" | "exportPackage" | "importFiles",
  ) {
    setMenu(null);
    await controller[action]();
  }
  async function confirmLibrary() {
    if (!libraryItem) return;
    const result = await controller.addToLibrary(libraryItem, category);
    if (result !== false) setLibraryItem(null);
  }
  async function confirmRename() {
    if (!renameItem) return;
    const result = await controller.rename(renameItem, renameDraft);
    if (result !== false) {
      setRenameItem(null);
      setRenameDraft("");
    }
  }
  function handleAction(action: string, item: MaterialItem) {
    if (action === "show-file") void controller.showFile(item);
    if (action === "add-to-library") {
      setLibraryItem(item);
      setCategory(currentCategory || defaultAssetCategory.id);
    }
    if (action === "rename-item") {
      setRenameItem(item);
      setRenameDraft(String(item.name || ""));
    }
    if (
      action === "delete-item" &&
      window.confirm(
        t("ui.MaterialsView.text.e49e7e06", { value0: item.name || t("ui.canvasMediaSelection.text.b61b7f74") }),
      )
    ) void controller.delete(item);
  }

  return (
    <>
      <ProjectScopeHeader
        title={t("ui.AssetsView.text.bab3c9ce")}
        subtitle={t("ui.MaterialsView.text.2d0f6214", { value0: filtered.length })}
        flat
      >
        <div className="search">
          <IconSymbol name="search" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={t("ui.MaterialsView.placeholder.ac334e59")}
          />
        </div>
      </ProjectScopeHeader>
      <div
        className="scroll-area resource-browser"
        onClick={() => setMenu(null)}
        onContextMenu={openMenu}
      >
        {!filtered.length
          ? (
            <EmptyState
              icon="image"
              text={keyword
                ? t("ui.MaterialsView.text.673044f7")
                : t("ui.MaterialsView.text.9d882351")}
            />
          )
          : (
            <MaterialGrid
              materials={filtered}
              assetMaterialIds={assetMaterialIds}
              onPreview={controller.preview}
              onAction={handleAction}
            />
          )}
        {menu && (
          <div
            className="resource-context-menu"
            style={{ left: menu.x, top: menu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={() => void menuAction("openStorage")}>
              <IconSymbol name="folder" />{t("ui.MaterialsView.text.b8c473de")}</button>
            <button
              onClick={() => {
                setMenu(null);
                setRoute("assets");
              }}
            >
              <IconSymbol name="box" />{t("ui.AssetsView.title.885200aa")}</button>
            <div className="resource-context-separator" />
            <button onClick={() => void menuAction("importPackage")}>
              <IconSymbol name="upload" />{t("ui.AssetsView.text.3f035ce8")}</button>
            <button onClick={() => void menuAction("exportPackage")}>
              <IconSymbol name="download" />{t("ui.AssetsView.text.ca8c07de")}</button>
            <button onClick={() => void menuAction("importFiles")}>
              <IconSymbol name="plus" />{t("ui.MaterialsView.text.ddd18922")}</button>
          </div>
        )}
      </div>
      {libraryItem && (
        <div
          className="library-picker-backdrop"
          onMouseDown={(e) =>
            e.target === e.currentTarget && setLibraryItem(null)}
        >
          <section className="library-picker">
            <p>{t("ui.MaterialGrid.text.0b5398b6")}</p>
            <h3>{libraryItem.name || t("ui.canvasMediaSelection.text.b61b7f74")}</h3>
            <div className="library-picker-grid">
              {assetCategories.map((item) => (
                <button
                  key={item.id}
                  className={category === item.id ? "active" : ""}
                  onClick={() => setCategory(item.id)}
                >
                  <IconSymbol name={item.icon} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
            <footer>
              <button
                className="button ghost"
                onClick={() => setLibraryItem(null)}
              >
                {t("ui.ImageWatermarkEditor.text.4d0b4688")}</button>
              <button
                className="button primary"
                onClick={() => void confirmLibrary()}
              >
                {t("ui.MaterialsView.text.b7db4426")}</button>
            </footer>
          </section>
        </div>
      )}
      {renameItem && (
        <div
          className="library-picker-backdrop"
          onMouseDown={(e) =>
            e.target === e.currentTarget && setRenameItem(null)}
        >
          <section className="library-picker rename-dialog">
            <p>{t("ui.AssetsView.text.29e63aed")}</p>
            <h3>{renameItem.name || t("ui.canvasMediaSelection.text.b61b7f74")}</h3>
            <input
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              placeholder={t("ui.AssetsView.placeholder.a7426356")}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && void confirmRename()}
            />
            <footer>
              <button
                className="button ghost"
                onClick={() => setRenameItem(null)}
              >
                {t("ui.ImageWatermarkEditor.text.4d0b4688")}</button>
              <button
                className="button primary"
                onClick={() => void confirmRename()}
              >
                {t("ui.MediaViewer.text.fadf24db")}</button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
