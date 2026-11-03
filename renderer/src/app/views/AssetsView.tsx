import { t } from '@/i18n';
import { type MouseEvent, useMemo, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import { IconSymbol } from "../components/IconSymbol";
import { MaterialGrid, type MaterialItem } from "../components/MaterialGrid";
import { ProjectScopeHeader } from "../components/ProjectScopeHeader";
import { useAppStore } from "../store/appStore";
import { assetCategories, defaultAssetCategory } from "../../domain/asset/assetCategories";

export interface AssetsController {
  preview: (item: MaterialItem, src: string, kind: "image" | "video") => void;
  showFile: (item: MaterialItem) => void | Promise<void>;
  rename: (
    item: MaterialItem,
    name: string,
  ) => boolean | void | Promise<boolean | void>;
  deleteProjectAsset: (item: MaterialItem) => boolean | void | Promise<boolean | void>;
  deleteLocalAsset: (
    item: MaterialItem,
  ) => boolean | void | Promise<boolean | void>;
  promoteLocal: (item: MaterialItem) => void | Promise<void>;
  referenceProject: (item: MaterialItem) => void | Promise<void>;
  copyProject: (item: MaterialItem) => void | Promise<void>;
  openLocalStorage: () => void | Promise<void>;
  importPackage: () => void | Promise<void>;
  exportPackage: () => void | Promise<void>;
  exportSelected: (items: MaterialItem[]) => void | Promise<void>;
  moveProjectAssets: (items: MaterialItem[], category: string) => void | Promise<void>;
  importFiles: () => void | Promise<void>;
}

export function AssetsView({
  projectAssets,
  localAssets,
  assetMaterialIds,
  controller,
}: {
  projectAssets: MaterialItem[];
  localAssets: MaterialItem[];
  assetMaterialIds: Set<string>;
  controller: AssetsController;
}) {
  const [scope, setScope] = useState<"project" | "local">("project");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [renameItem, setRenameItem] = useState<MaterialItem | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState(false);
  const category = useAppStore((state) => state.assetCategory);
  const keyword = useAppStore((state) => state.assetKeyword);
  const setRoute = useAppStore((state) => state.setRoute);
  const categoryInfo =
    assetCategories.find((item) =>
      item.id === category || item.aliases.includes(category)
    ) || defaultAssetCategory;
  const setKeyword = (value: string) =>
    useAppStore.setState({ assetKeyword: value });
  const filter = (items: MaterialItem[]) =>
    items.filter((item) => {
      const itemCategory = String(item.category || category);
      const inCategory = itemCategory === categoryInfo.id ||
        categoryInfo.aliases.includes(itemCategory);
      return inCategory &&
        (!keyword.trim() ||
          [item.name, item.note, ...(Array.isArray(item.tags) ? item.tags : [])]
            .join(" ").toLowerCase().includes(keyword.trim().toLowerCase()));
    });
  const displayed = useMemo(
    () => filter(scope === "project" ? projectAssets : localAssets),
    [scope, projectAssets, localAssets, category, keyword],
  );
  const selectedItems = displayed.filter((item) => selectedKeys.has(String(item.id || item.path || item.name || "")));

  function toggleSelected(item: MaterialItem) {
    const key = String(item.id || item.path || item.name || "");
    setSelectedKeys((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  }
  async function batchDelete() {
    if (!selectedItems.length || !window.confirm(t("ui.AssetsView.text.cf156401", { value0: selectedItems.length }))) return;
    const failed = new Set<string>();
    for (const item of selectedItems) {
      try {
        const removed = scope === "project"
          ? await controller.deleteProjectAsset(item)
          : await controller.deleteLocalAsset(item);
        if (removed === false) failed.add(String(item.id || item.path || item.name || ""));
      } catch { failed.add(String(item.id || item.path || item.name || "")); }
    }
    setSelectedKeys(failed);
  }

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
  async function confirmRename() {
    if (!renameItem) return;
    const result = await controller.rename(renameItem, renameDraft);
    if (result !== false) setRenameItem(null);
  }
  function action(name: string, item: MaterialItem) {
    if (name === "show-file") void controller.showFile(item);
    if (name === "promote-local") void controller.promoteLocal(item);
    if (name === "reference-project") void controller.referenceProject(item);
    if (name === "copy-project") void controller.copyProject(item);
    if (name === "rename-item") {
      setRenameItem(item);
      setRenameDraft(String(item.name || ""));
    }
    if (name === "delete-item") {
      const message = scope === "project"
        ? t("ui.AssetsView.text.a71e0b79", { value0: item.name || t("ui.canvasMediaSelection.text.b61b7f74") })
        : t("ui.AssetsView.text.d6c61153", { value0: item.name || t("ui.canvasMediaSelection.text.b61b7f74") });
      if (window.confirm(message)) {
        void (scope === "project"
          ? controller.deleteProjectAsset(item)
          : controller.deleteLocalAsset(item));
      }
    }
  }

  return (
    <>
      <ProjectScopeHeader
        title={t("ui.AssetsView.title.885200aa")}
        subtitle={t("ui.AssetsView.text.90352711", { value0: displayed.length })}
        flat
      >
        <div className="search">
          <IconSymbol name="search" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={t("ui.AssetsView.text.00b421b2", { value0: categoryInfo.label })}
          />
        </div>
      </ProjectScopeHeader>
      <div
        className="scroll-area resource-browser"
        onClick={() => setMenu(null)}
        onContextMenu={openMenu}
      >
        {selectedItems.length > 0 && <div className="material-batch-bar">
          <strong>{t(selectedItems.length === 1 ? "common.selectedCount.one" : "common.selectedCount.other", { count: selectedItems.length })}</strong>
          <button type="button" onClick={() => void controller.exportSelected(selectedItems)}>{t("ui.MediaViewer.text.2b9d0131")}</button>
          {scope === "project" && <button type="button" onClick={() => setMoving((value) => !value)}>{t("ui.AssetsView.text.48df919a")}</button>}
          <button type="button" onClick={() => void batchDelete()}>{t("ui.MaterialGrid.title.3755f56f")}</button>
          <button type="button" onClick={() => { setSelectedKeys(new Set()); setMoving(false); }}>{t("ui.MaterialGrid.text.f02e9439")}</button>
          {moving && <div className="material-batch-categories">{assetCategories.map((item) => <button key={item.id} type="button" onClick={() => { void controller.moveProjectAssets(selectedItems, item.id); setSelectedKeys(new Set()); setMoving(false); }}>{item.label}</button>)}</div>}
        </div>}
        <div
          className="asset-scope-switch"
          role="tablist"
          aria-label={t("ui.AssetsView.arialabel.df2bc29a")}
        >
          <button
            className={scope === "project" ? "active" : ""}
            onClick={() => { setScope("project"); setSelectedKeys(new Set()); }}
          >
            {t("ui.ProjectSearch.text.96cb64ae")}<span>{projectAssets.length}</span>
          </button>
          <button
            className={scope === "local" ? "active" : ""}
            onClick={() => { setScope("local"); setSelectedKeys(new Set()); }}
          >
            {t("ui.AssetsView.text.e1003961")}<span>{localAssets.length}</span>
          </button>
          <p>
            {scope === "local"
              ? t("ui.AssetsView.text.488e53ed")
              : t("ui.AssetsView.text.d45356a3")}
          </p>
        </div>
        {!displayed.length
          ? (
            <EmptyState
              icon="box"
              text={scope === "local"
                ? t("ui.AssetsView.text.2c206776")
                : t("ui.AssetsView.text.ea9d2a2c")}
            />
          )
          : (
            <MaterialGrid
              materials={displayed}
              selectedKeys={selectedKeys}
              onToggleSelected={toggleSelected}
              assetMaterialIds={assetMaterialIds}
              showLibraryAction={false}
              showPromoteAction={scope === "project"}
              showReferenceAction={scope === "local"}
              showCopyAction={scope === "local"}
              showRenameAction={scope === "project"}
              showDeleteAction
              onPreview={controller.preview}
              onAction={action}
            />
          )}
        {menu && (
          <div
            className="resource-context-menu"
            style={{ left: menu.x, top: menu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {scope === "project"
              ? (
                <>
                  <button
                    onClick={() => {
                      setMenu(null);
                      setRoute("materials");
                    }}
                  >
                    <IconSymbol name="image" />{t("ui.AssetsView.text.bab3c9ce")}</button>
                  <div className="resource-context-separator" />
                  <button onClick={() => void controller.importPackage()}>
                    <IconSymbol name="upload" />{t("ui.AssetsView.text.3f035ce8")}</button>
                  <button onClick={() => void controller.exportPackage()}>
                    <IconSymbol name="download" />{t("ui.AssetsView.text.ca8c07de")}</button>
                  <button onClick={() => void controller.importFiles()}>
                    <IconSymbol name="plus" />{t("ui.AssetsView.text.f1d24597")}</button>
                </>
              )
              : (
                <button onClick={() => void controller.openLocalStorage()}>
                  <IconSymbol name="folder" />{t("ui.AssetsView.text.6521c13f")}</button>
              )}
          </div>
        )}
      </div>
      {renameItem && (
        <div
          className="rename-backdrop"
          onMouseDown={(e) =>
            e.target === e.currentTarget && setRenameItem(null)}
        >
          <section className="rename-dialog">
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
