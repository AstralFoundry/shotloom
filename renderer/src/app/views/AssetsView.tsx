import { t } from '@/i18n';
import { type MouseEvent, useMemo, useRef, useState } from "react";
import { App, Input, Modal, Segmented, type InputRef, type MenuProps } from "antd";
import { ContextMenu } from "../components/ContextMenu";
import { EmptyState } from "../components/EmptyState";
import { IconSymbol } from "../components/IconSymbol";
import { MaterialGrid, type MaterialItem } from "../components/MaterialGrid";
import { ProjectScopeHeader } from "../components/ProjectScopeHeader";
import { useAppStore } from "../store/appStore";
import { assetCategories, defaultAssetCategory } from "../../domain/asset/assetCategories";
import { SearchInput } from "../components/SearchInput";

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
  const { modal } = App.useApp();
  const [scope, setScope] = useState<"project" | "local">("project");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [renameItem, setRenameItem] = useState<MaterialItem | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const renameInput = useRef<InputRef>(null);
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
  function batchDelete() {
    if (!selectedItems.length) return;
    modal.confirm({
      title: t("ui.AssetsView.text.cf156401", { value0: selectedItems.length }),
      okButtonProps: { danger: true },
      onOk: async () => {
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
      },
    });
  }

  function openMenu(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    if (
      (event.target as Element).closest(
        ".material-node-wrap, .ant-dropdown",
      )
    ) return;
    setMenu({ x: event.clientX, y: event.clientY });
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
      modal.confirm({
        title: message,
        okButtonProps: { danger: true },
        onOk: () => {
          void (scope === "project"
            ? controller.deleteProjectAsset(item)
            : controller.deleteLocalAsset(item));
        },
      });
    }
  }

  const menuItems: MenuProps["items"] = scope === "project"
    ? [
      { key: "materials", icon: <IconSymbol name="image" />, label: t("ui.AssetsView.text.bab3c9ce") },
      { type: "divider" },
      { key: "import-package", icon: <IconSymbol name="upload" />, label: t("ui.AssetsView.text.3f035ce8") },
      { key: "export-package", icon: <IconSymbol name="download" />, label: t("ui.AssetsView.text.ca8c07de") },
      { key: "import-files", icon: <IconSymbol name="plus" />, label: t("ui.AssetsView.text.f1d24597") },
    ]
    : [
      { key: "open-local", icon: <IconSymbol name="folder" />, label: t("ui.AssetsView.text.6521c13f") },
    ];

  function onMenuClick(key: string) {
    setMenu(null);
    if (key === "materials") setRoute("materials");
    if (key === "import-package") void controller.importPackage();
    if (key === "export-package") void controller.exportPackage();
    if (key === "import-files") void controller.importFiles();
    if (key === "open-local") void controller.openLocalStorage();
  }

  return (
    <>
      <ProjectScopeHeader
        title={t("ui.AssetsView.title.885200aa")}
        subtitle={t("ui.AssetsView.text.90352711", { value0: displayed.length })}
        flat
      >
        <div className="search">
          <SearchInput
            value={keyword}
            onChange={setKeyword}
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
        <div className="asset-scope-switch">
          <Segmented
            className="asset-scope-tabs"
            aria-label={t("ui.AssetsView.arialabel.df2bc29a")}
            value={scope}
            onChange={(value) => {
              setScope(value as "project" | "local");
              setSelectedKeys(new Set());
            }}
            options={[
              {
                value: "project",
                label: (
                  <span className="asset-scope-tab">
                    {t("ui.ProjectSearch.text.96cb64ae")}<span>{projectAssets.length}</span>
                  </span>
                ),
              },
              {
                value: "local",
                label: (
                  <span className="asset-scope-tab">
                    {t("ui.AssetsView.text.e1003961")}<span>{localAssets.length}</span>
                  </span>
                ),
              },
            ]}
          />
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
        <ContextMenu
          point={menu}
          items={menuItems}
          onSelect={onMenuClick}
          onClose={() => setMenu(null)}
        />
      </div>
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
