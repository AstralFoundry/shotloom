import { t } from '@/i18n';
import { type MouseEvent, useMemo, useRef, useState } from "react";
import { App, Input, Modal, type InputRef, type MenuProps } from "antd";
import { assetCategories, defaultAssetCategory } from "../../domain/asset/assetCategories";
import { ContextMenu } from "../components/ContextMenu";
import { EmptyState } from "../components/EmptyState";
import { IconSymbol } from "../components/IconSymbol";
import { MaterialGrid, type MaterialItem } from "../components/MaterialGrid";
import { ProjectScopeHeader } from "../components/ProjectScopeHeader";
import { useAppStore } from "../store/appStore";
import { SearchInput } from "../components/SearchInput";

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
  const { modal } = App.useApp();
  const [keyword, setKeyword] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [libraryItem, setLibraryItem] = useState<MaterialItem | null>(null);
  const [category, setCategory] = useState(defaultAssetCategory.id);
  const [renameItem, setRenameItem] = useState<MaterialItem | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const renameInput = useRef<InputRef>(null);
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
        ".material-node-wrap, .ant-dropdown",
      )
    ) return;
    setMenu({ x: event.clientX, y: event.clientY });
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
    if (action === "delete-item") {
      modal.confirm({
        title: t("ui.MaterialsView.text.e49e7e06", { value0: item.name || t("ui.canvasMediaSelection.text.b61b7f74") }),
        okButtonProps: { danger: true },
        onOk: () => void controller.delete(item),
      });
    }
  }

  const menuItems: MenuProps["items"] = [
    { key: "open-storage", icon: <IconSymbol name="folder" />, label: t("ui.MaterialsView.text.b8c473de") },
    { key: "assets", icon: <IconSymbol name="box" />, label: t("ui.AssetsView.title.885200aa") },
    { type: "divider" },
    { key: "import-package", icon: <IconSymbol name="upload" />, label: t("ui.AssetsView.text.3f035ce8") },
    { key: "export-package", icon: <IconSymbol name="download" />, label: t("ui.AssetsView.text.ca8c07de") },
    { key: "import-files", icon: <IconSymbol name="plus" />, label: t("ui.MaterialsView.text.ddd18922") },
  ];

  function onMenuClick(key: string) {
    setMenu(null);
    if (key === "open-storage") void controller.openStorage();
    if (key === "assets") setRoute("assets");
    if (key === "import-package") void controller.importPackage();
    if (key === "export-package") void controller.exportPackage();
    if (key === "import-files") void controller.importFiles();
  }

  return (
    <>
      <ProjectScopeHeader
        title={t("ui.AssetsView.text.bab3c9ce")}
        subtitle={t("ui.MaterialsView.text.2d0f6214", { value0: filtered.length })}
        flat
      >
        <div className="search">
          <SearchInput
            value={keyword}
            onChange={setKeyword}
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
        <ContextMenu
          point={menu}
          items={menuItems}
          onSelect={onMenuClick}
          onClose={() => setMenu(null)}
        />
      </div>
      <Modal
        open={Boolean(libraryItem)}
        centered
        width={430}
        title={t("ui.MaterialGrid.text.0b5398b6")}
        okText={t("ui.MaterialsView.text.b7db4426")}
        cancelText={t("ui.ImageWatermarkEditor.text.4d0b4688")}
        onCancel={() => setLibraryItem(null)}
        onOk={() => void confirmLibrary()}
      >
        {libraryItem && (
          <div className="library-picker-body">
            <p className="library-picker-current">{libraryItem.name || t("ui.canvasMediaSelection.text.b61b7f74")}</p>
            <div className="library-picker-grid">
              {assetCategories.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={category === item.id ? "active" : ""}
                  onClick={() => setCategory(item.id)}
                >
                  <IconSymbol name={item.icon} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={Boolean(renameItem)}
        centered
        width={430}
        title={t("ui.AssetsView.text.29e63aed")}
        okText={t("ui.MediaViewer.text.fadf24db")}
        cancelText={t("ui.ImageWatermarkEditor.text.4d0b4688")}
        onCancel={() => {
          setRenameItem(null);
          setRenameDraft("");
        }}
        onOk={() => void confirmRename()}
        afterOpenChange={(open) => {
          if (open) renameInput.current?.focus();
        }}
      >
        {renameItem && (
          <div className="rename-dialog-body">
            <p className="rename-dialog-current">{renameItem.name || t("ui.canvasMediaSelection.text.b61b7f74")}</p>
            <Input
              ref={renameInput}
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
              placeholder={t("ui.AssetsView.placeholder.a7426356")}
              onPressEnter={() => void confirmRename()}
            />
          </div>
        )}
      </Modal>
    </>
  );
}
