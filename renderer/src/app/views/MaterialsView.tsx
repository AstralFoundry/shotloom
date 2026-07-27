import { type MouseEvent, useMemo, useState } from "react";
import { assetCategories } from "../constants/navigation";
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
  const [category, setCategory] = useState(
    assetCategories[0]?.id || "characters",
  );
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
      setCategory(currentCategory || assetCategories[0]?.id || "characters");
    }
    if (action === "rename-item") {
      setRenameItem(item);
      setRenameDraft(String(item.name || ""));
    }
    if (
      action === "delete-item" &&
      window.confirm(
        `删除素材文件「${
          item.name || "未命名素材"
        }」？\n未被引用的项目本地文件会移入回收站。`,
      )
    ) void controller.delete(item);
  }

  return (
    <>
      <ProjectScopeHeader
        title="素材文件"
        subtitle={`${filtered.length} 个文件`}
        flat
      >
        <div className="search">
          <IconSymbol name="search" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索文件名、类型或来源"
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
                ? "没有匹配的素材文件。"
                : "暂无素材文件，导入参考图或运行生成节点后会出现在这里。"}
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
              <IconSymbol name="folder" />打开存储位置
            </button>
            <button
              onClick={() => {
                setMenu(null);
                setRoute("assets");
              }}
            >
              <IconSymbol name="box" />素材库
            </button>
            <div className="resource-context-separator" />
            <button onClick={() => void menuAction("importPackage")}>
              <IconSymbol name="upload" />导入资源包
            </button>
            <button onClick={() => void menuAction("exportPackage")}>
              <IconSymbol name="download" />导出资源包
            </button>
            <button onClick={() => void menuAction("importFiles")}>
              <IconSymbol name="plus" />导入素材文件
            </button>
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
            <p>加入素材库</p>
            <h3>{libraryItem.name || "未命名素材"}</h3>
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
                取消
              </button>
              <button
                className="button primary"
                onClick={() => void confirmLibrary()}
              >
                加入
              </button>
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
