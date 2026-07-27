import { type MouseEvent, useMemo, useState } from "react";
import { EmptyState } from "../components/EmptyState";
import { IconSymbol } from "../components/IconSymbol";
import { MaterialGrid, type MaterialItem } from "../components/MaterialGrid";
import { ProjectScopeHeader } from "../components/ProjectScopeHeader";
import { assetCategories } from "../constants/navigation";
import { useAppStore } from "../store/appStore";

export interface AssetsController {
  preview: (item: MaterialItem, src: string, kind: "image" | "video") => void;
  showFile: (item: MaterialItem) => void | Promise<void>;
  rename: (
    item: MaterialItem,
    name: string,
  ) => boolean | void | Promise<boolean | void>;
  deleteProjectAsset: (item: MaterialItem) => void | Promise<void>;
  deleteLocalAsset: (
    item: MaterialItem,
  ) => boolean | void | Promise<boolean | void>;
  promoteLocal: (item: MaterialItem) => void | Promise<void>;
  referenceProject: (item: MaterialItem) => void | Promise<void>;
  copyProject: (item: MaterialItem) => void | Promise<void>;
  openLocalStorage: () => void | Promise<void>;
  importPackage: () => void | Promise<void>;
  exportPackage: () => void | Promise<void>;
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
  const category = useAppStore((state) => state.assetCategory);
  const keyword = useAppStore((state) => state.assetKeyword);
  const setRoute = useAppStore((state) => state.setRoute);
  const categoryInfo =
    assetCategories.find((item) =>
      item.id === category || item.aliases.includes(category)
    ) || assetCategories[0];
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
        ? `从素材库移除「${
          item.name || "未命名素材"
        }」？\n素材文件本身不会被删除。`
        : `从通用素材库删除「${
          item.name || "未命名素材"
        }」？\n仍被项目引用时会自动拒绝。`;
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
        title="素材库"
        subtitle={`${displayed.length} 个素材`}
        flat
      >
        <div className="search">
          <IconSymbol name="search" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={`搜索${categoryInfo.label}名称或关键词`}
          />
        </div>
      </ProjectScopeHeader>
      <div
        className="scroll-area resource-browser"
        onClick={() => setMenu(null)}
        onContextMenu={openMenu}
      >
        <div
          className="asset-scope-switch"
          role="tablist"
          aria-label="素材范围"
        >
          <button
            className={scope === "project" ? "active" : ""}
            onClick={() => setScope("project")}
          >
            当前项目 <span>{projectAssets.length}</span>
          </button>
          <button
            className={scope === "local" ? "active" : ""}
            onClick={() => setScope("local")}
          >
            通用素材 <span>{localAssets.length}</span>
          </button>
          <p>
            {scope === "local"
              ? "仅保存在当前设备，可供所有项目复用"
              : "当前项目收录的素材设定"}
          </p>
        </div>
        {!displayed.length
          ? (
            <EmptyState
              icon="box"
              text={scope === "local"
                ? "还没有通用素材，可从项目素材中加入。"
                : "暂无素材，先导入参考文件，或从素材文件加入素材库。"}
            />
          )
          : (
            <MaterialGrid
              materials={displayed}
              assetMaterialIds={assetMaterialIds}
              showLibraryAction={false}
              showPromoteAction={scope === "project"}
              showReferenceAction={scope === "local"}
              showCopyAction={scope === "local"}
              showRenameAction={scope === "project"}
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
                    <IconSymbol name="image" />素材文件
                  </button>
                  <div className="resource-context-separator" />
                  <button onClick={() => void controller.importPackage()}>
                    <IconSymbol name="upload" />导入资源包
                  </button>
                  <button onClick={() => void controller.exportPackage()}>
                    <IconSymbol name="download" />导出资源包
                  </button>
                  <button onClick={() => void controller.importFiles()}>
                    <IconSymbol name="plus" />导入参考文件
                  </button>
                </>
              )
              : (
                <button onClick={() => void controller.openLocalStorage()}>
                  <IconSymbol name="folder" />打开通用素材位置
                </button>
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
            <p>修改名称</p>
            <h3>{renameItem.name || "未命名素材"}</h3>
            <input
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              placeholder="输入新的素材名称"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && void confirmRename()}
            />
            <footer>
              <button
                className="button ghost"
                onClick={() => setRenameItem(null)}
              >
                取消
              </button>
              <button
                className="button primary"
                onClick={() => void confirmRename()}
              >
                保存
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
