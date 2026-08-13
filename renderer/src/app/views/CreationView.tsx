import {
  lazy,
  Suspense,
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Viewport } from "@xyflow/react";
import { BottomModeBar } from "../canvas/BottomModeBar";
import {
  WorkflowCanvas,
  type WorkflowCanvasController,
  type WorkflowEdge,
  type WorkflowNodeActions,
  type WorkflowNodeData,
} from "../canvas/WorkflowCanvas";
import { workflowNodeRenderers } from "../canvas/nodeRegistry";
import { IconSymbol } from "../components/IconSymbol";
import { MaterialGrid, type MaterialItem } from "../components/MaterialGrid";
import {
  type ConversationItem,
  type CopilotController,
  type CopilotMessage,
  CopilotPanel,
  type CopilotPanelHandle,
} from "../copilot/CopilotPanel";
import type { VideoEditorAsset, VideoEditorController } from "../editor/VideoEditorWorkspace";
import type { AgentLayoutMode } from "../../services/agentLayoutService";
import { assetCategories } from "../constants/navigation";

const VideoEditorWorkspace = lazy(() =>
  import("../editor/VideoEditorWorkspace").then((module) => ({
    default: module.VideoEditorWorkspace,
  })),
);

export interface CreationViewController {
  canvas: WorkflowCanvasController;
  nodes: WorkflowNodeActions;
  copilot: CopilotController & {
    subscribe: (listener: () => void) => () => void;
    getRevision: () => number;
    read: () => CreationCopilotData;
  };
  applyMaterial: (item: MaterialItem, scope: "library" | "local" | "files") => void | Promise<void>;
  previewMaterial: (item: MaterialItem, src: string, kind: "image" | "video") => void;
  showMaterialInFolder: (item: MaterialItem) => void | Promise<void>;
  loadMaterials: () => {
    projectAssets: MaterialItem[];
    localAssets: MaterialItem[];
    materials: MaterialItem[];
  };
  importMaterials: () => void | Promise<void>;
  undo: () => void;
  redo: () => void;
  fitView: () => void;
  autoLayout: (options?: { mode?: AgentLayoutMode; includeConnected?: boolean }) => boolean;
  exportSelected: () => void;
  mergeVideos: () => void;
  editor?: VideoEditorController;
}
export interface CreationViewData {
  nodes: WorkflowNodeData[];
  edges: WorkflowEdge[];
  viewport: Viewport;
  history: { canUndo: boolean; canRedo: boolean };
  shortcutLabels: { fitView: string; autoLayout: string };
  editor?: {
    title?: string;
    project?: Record<string, unknown>;
    sourceFile: string;
    sourceUrl: string;
    sourceName?: string;
    metadata?: {
      duration?: number;
      width?: number;
      height?: number;
      videoWidth?: number;
      videoHeight?: number;
    };
    assets?: VideoEditorAsset[];
  };
}

type CreationCopilotData = {
  messages: CopilotMessage[];
  conversations: ConversationItem[];
  activeConversationId: string;
  busy: boolean;
  textModel: string;
  textModels: Array<{ id: string; label: string }>;
};

function LiveCopilotPanel({
  nodes,
  controller,
  copilotRef,
}: {
  nodes: WorkflowNodeData[];
  controller: CreationViewController["copilot"];
  copilotRef: React.Ref<CopilotPanelHandle>;
}) {
  useSyncExternalStore(controller.subscribe, controller.getRevision, controller.getRevision);
  const data = controller.read();
  return (
    <CopilotPanel
      ref={copilotRef}
      messages={data.messages}
      nodes={nodes}
      busy={data.busy}
      conversations={data.conversations}
      activeConversationId={data.activeConversationId}
      textModel={data.textModel}
      textModels={data.textModels}
      controller={controller}
    />
  );
}

export function CreationView({
  data,
  controller,
}: {
  data: CreationViewData;
  controller: CreationViewController;
}) {
  const [copilotVisible, setCopilotVisible] = useState(true);
  const copilotRef = useRef<CopilotPanelHandle>(null);
  const [copilotWidth, setCopilotWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem("shotloom:copilot-width-v3"));
    const preferred = Math.round(window.innerWidth * 0.3);
    return Number.isFinite(saved) && saved > 0
      ? Math.min(560, Math.max(360, saved))
      : Math.min(520, Math.max(400, preferred));
  });
  const [picker, setPicker] = useState(false);
  const assetPickerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!picker) return;
    const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || assetPickerRef.current?.contains(target)) return;
      setPicker(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [picker]);
  const [materialKeyword, setMaterialKeyword] = useState("");
  const [assetType, setAssetType] = useState("all");
  const [assetCategory, setAssetCategory] = useState("all");
  const [assetSort, setAssetSort] = useState<"newest" | "oldest" | "name">("newest");
  const [assetView, setAssetView] = useState<"grid" | "list">("grid");
  const [assetDrawerHeight, setAssetDrawerHeight] = useState(() => {
    const saved = Number(window.localStorage.getItem("shotloom:asset-drawer-height-v1"));
    const minimum = Math.round(window.innerHeight * 0.7);
    return Number.isFinite(saved) && saved > 0
      ? Math.min(640, Math.max(minimum, saved))
      : minimum;
  });
  const assetFiltersActive = Boolean(
    materialKeyword || assetType !== "all" || assetCategory !== "all" || assetSort !== "newest"
  );
  const [scope, setScope] = useState<"library" | "local" | "files">("library");
  const [materials, setMaterials] = useState<{
    library: MaterialItem[];
    local: MaterialItem[];
    files: MaterialItem[];
  }>({ library: [], local: [], files: [] });
  const items = useMemo(() => {
    const keyword = materialKeyword.trim().toLocaleLowerCase();
    const category = assetCategories.find((entry) =>
      entry.id === assetCategory || entry.aliases.includes(assetCategory)
    );
    const filtered = materials[scope].filter((item) => {
      const type = String(item.resourceType || "file").toLocaleLowerCase();
      if (assetType !== "all" && type !== assetType) return false;
      const itemCategory = String(item.category || "");
      if (
        category &&
        itemCategory !== category.id &&
        !category.aliases.includes(itemCategory)
      ) return false;
      if (!keyword) return true;
      const tags = Array.isArray(item.tags) ? item.tags : [];
      return [item.name, item.note, item.resourceType, item.nodeType, itemCategory, ...tags]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(keyword);
    });
    return [...filtered].sort((left, right) => {
      if (assetSort === "name") {
        return String(left.name || "").localeCompare(String(right.name || ""), "zh-CN");
      }
      const leftTime = Date.parse(String(left.createdAt || left.importedAt || left.updatedAt || "")) || 0;
      const rightTime = Date.parse(String(right.createdAt || right.importedAt || right.updatedAt || "")) || 0;
      return assetSort === "oldest" ? leftTime - rightTime : rightTime - leftTime;
    });
  }, [assetCategory, assetSort, assetType, materialKeyword, materials, scope]);
  function refreshMaterials(preferredScope?: "library" | "local" | "files") {
    const loaded = controller.loadMaterials();
    const next = {
      library: loaded.projectAssets,
      local: loaded.localAssets,
      files: loaded.materials,
    };
    setMaterials(next);
    if (preferredScope) setScope(preferredScope);
    return next;
  }
  function openPicker() {
    if (picker) {
      setPicker(false);
      return;
    }
    const next = refreshMaterials();
    setScope(next.library.length ? "library" : next.local.length ? "local" : "files");
    setMaterialKeyword("");
    setAssetType("all");
    setAssetCategory("all");
    setAssetSort("newest");
    setPicker(true);
  }
  async function importMaterials() {
    await controller.importMaterials();
    refreshMaterials("files");
  }
  const copilotController: CreationViewController["copilot"] = {
    ...controller.copilot,
    close: () => setCopilotVisible(false),
  };
  function resizeCopilot(nextWidth: number) {
    const maxWidth = Math.max(360, Math.min(560, window.innerWidth - 420));
    const width = Math.round(Math.min(maxWidth, Math.max(360, nextWidth)));
    setCopilotWidth(width);
    window.localStorage.setItem("shotloom:copilot-width-v3", String(width));
  }
  function startCopilotResize(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = copilotWidth;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (moveEvent: globalThis.PointerEvent) => {
      resizeCopilot(startWidth + startX - moveEvent.clientX);
    };
    const finish = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", finish);
      target.removeEventListener("pointercancel", finish);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", finish);
    target.addEventListener("pointercancel", finish);
  }
  function resizeCopilotWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    resizeCopilot(copilotWidth + (event.key === "ArrowLeft" ? 16 : -16));
  }
  function resizeAssetDrawer(nextHeight: number, availableHeight: number) {
    const minimum = Math.round(availableHeight * 0.7);
    const maxHeight = Math.max(minimum, Math.min(640, availableHeight - 72));
    const height = Math.round(Math.min(maxHeight, Math.max(minimum, nextHeight)));
    setAssetDrawerHeight(height);
    window.localStorage.setItem("shotloom:asset-drawer-height-v1", String(height));
  }
  function startAssetDrawerResize(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = assetDrawerHeight;
    const target = event.currentTarget;
    const availableHeight = target.parentElement?.parentElement?.clientHeight || window.innerHeight;
    target.setPointerCapture(event.pointerId);
    const move = (moveEvent: globalThis.PointerEvent) => {
      resizeAssetDrawer(startHeight + startY - moveEvent.clientY, availableHeight);
    };
    const finish = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", finish);
      target.removeEventListener("pointercancel", finish);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", finish);
    target.addEventListener("pointercancel", finish);
  }
  function resizeAssetDrawerWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const availableHeight = event.currentTarget.parentElement?.parentElement?.clientHeight || window.innerHeight;
    resizeAssetDrawer(assetDrawerHeight + (event.key === "ArrowUp" ? 24 : -24), availableHeight);
  }
  return (
    <div className="forge-lite">
      <main
        className={`forge-lite-main${copilotVisible ? "" : " copilot-collapsed"}`}
        style={
          copilotVisible ? { gridTemplateColumns: `minmax(0, 1fr) ${copilotWidth}px` } : undefined
        }
      >
        <WorkflowCanvas
          nodes={data.nodes}
          edges={data.edges}
          viewport={data.viewport}
          renderers={workflowNodeRenderers}
          nodeActions={controller.nodes}
          controller={controller.canvas}
          mentionInCopilot={(nodeId) => {
            copilotRef.current?.addNodeMentionById(nodeId);
          }}
          overlay={
            <BottomModeBar
              canUndo={data.history.canUndo}
              canRedo={data.history.canRedo}
              shortcutLabels={data.shortcutLabels}
              onUndo={controller.undo}
              onRedo={controller.redo}
              onFitView={controller.fitView}
              onMaterialPicker={openPicker}
              onAutoLayout={controller.autoLayout}
              onExport={controller.exportSelected}
              onMergeVideos={controller.mergeVideos}
            />
          }
        />
        {copilotVisible && (
          <div
            className="forge-workspace-divider"
            style={{ right: copilotWidth }}
            role="separator"
            aria-label="调整画布与助手宽度"
            aria-orientation="vertical"
            aria-valuemin={360}
            aria-valuemax={560}
            aria-valuenow={copilotWidth}
            tabIndex={0}
            onPointerDown={startCopilotResize}
            onKeyDown={resizeCopilotWithKeyboard}
          />
        )}
        {copilotVisible ? (
          <LiveCopilotPanel
            nodes={data.nodes}
            controller={copilotController}
            copilotRef={copilotRef}
          />
        ) : (
          <button className="forge-copilot-reopen" onClick={() => setCopilotVisible(true)}>
            打开 Copilot
          </button>
        )}
      {picker && (
        <div
          className="canvas-asset-popover-layer"
          style={{ right: copilotVisible ? copilotWidth : 0 }}
        >
          <section
            ref={assetPickerRef}
            className="canvas-material-picker"
            style={{ height: assetDrawerHeight }}
          >
            <div
              className="canvas-asset-drawer-resizer"
              role="separator"
              aria-label="调整资产抽屉高度"
              aria-orientation="horizontal"
              aria-valuemin={Math.round(window.innerHeight * 0.7)}
              aria-valuemax={Math.max(Math.round(window.innerHeight * 0.7), window.innerHeight - 72)}
              aria-valuenow={assetDrawerHeight}
              tabIndex={0}
              onPointerDown={startAssetDrawerResize}
              onKeyDown={resizeAssetDrawerWithKeyboard}
            >
              <span />
            </div>
            <header>
              <div className="canvas-asset-heading">
                <IconSymbol name="folder" />
                <strong>资产</strong>
              </div>
              <div className="canvas-material-picker-actions">
                <div className="canvas-asset-view-switch" aria-label="资产显示方式">
                  <button
                    className={assetView === "list" ? "active" : ""}
                    type="button"
                    title="列表视图"
                    onClick={() => setAssetView("list")}
                  >
                    <IconSymbol name="list" />
                  </button>
                  <button
                    className={assetView === "grid" ? "active" : ""}
                    type="button"
                    title="网格视图"
                    onClick={() => setAssetView("grid")}
                  >
                    <IconSymbol name="grid" />
                  </button>
                </div>
                <button className="canvas-material-import" onClick={() => void importMaterials()}>
                  <IconSymbol name="upload" />导入
                </button>
                <button className="canvas-material-close" title="关闭" onClick={() => setPicker(false)}>
                  <IconSymbol name="x" />
                </button>
              </div>
            </header>
            <div className="canvas-material-browser-bar">
              <div className="canvas-material-tabs" role="tablist" aria-label="资产范围">
                <button
                  className={scope === "library" ? "active" : ""}
                  onClick={() => setScope("library")}
                >
                  当前项目 <span>{materials.library.length}</span>
                </button>
                <button
                  className={scope === "local" ? "active" : ""}
                  onClick={() => setScope("local")}
                >
                  全局资产 <span>{materials.local.length}</span>
                </button>
                <button
                  className={scope === "files" ? "active" : ""}
                  onClick={() => setScope("files")}
                >
                  项目文件 <span>{materials.files.length}</span>
                </button>
              </div>
              <label className="canvas-material-search">
                <IconSymbol name="search" />
                <input
                  value={materialKeyword}
                  onChange={(event) => setMaterialKeyword(event.target.value)}
                  placeholder="搜索名称、类型或标签"
                  autoFocus
                />
              </label>
            </div>
            <div className="canvas-asset-filters">
              <label aria-label="资产类型">
                <select value={assetType} onChange={(event) => setAssetType(event.target.value)}>
                  <option value="all">全部类型</option>
                  <option value="image">图片资产</option>
                  <option value="video">视频资产</option>
                  <option value="audio">音频资产</option>
                  <option value="text">文本资产</option>
                  <option value="file">其他文件</option>
                </select>
              </label>
              <label aria-label="资产分类">
                <select value={assetCategory} onChange={(event) => setAssetCategory(event.target.value)}>
                  <option value="all">全部分类</option>
                  {assetCategories.map((category) => (
                    <option key={category.id} value={category.id}>{category.label}</option>
                  ))}
                </select>
              </label>
              <label className="canvas-asset-sort" aria-label="资产排序">
                <select
                  value={assetSort}
                  onChange={(event) => setAssetSort(event.target.value as "newest" | "oldest" | "name")}
                >
                  <option value="newest">最新优先</option>
                  <option value="oldest">最早优先</option>
                  <option value="name">按名称</option>
                </select>
              </label>
              <output>{items.length} 项</output>
              {assetFiltersActive && (
                <button
                  className="canvas-asset-filter-reset"
                  type="button"
                  onClick={() => {
                    setMaterialKeyword("");
                    setAssetType("all");
                    setAssetCategory("all");
                    setAssetSort("newest");
                  }}
                >
                  清除筛选
                </button>
              )}
            </div>
            <div className={`canvas-material-picker-body asset-view-${assetView}`}>
              {items.length ? (
                <MaterialGrid
                  materials={items}
                  showLibraryAction={false}
                  showFileAction
                  showRenameAction={false}
                  showDeleteAction={false}
                  clickToApply
                  onPreview={controller.previewMaterial}
                  onAction={(action, item) => {
                    if (action === "apply-to-canvas") {
                      void controller.applyMaterial(item, scope);
                      setPicker(false);
                    } else if (action === "show-file") {
                      void controller.showMaterialInFolder(item);
                    }
                  }}
                />
              ) : (
                <div className="canvas-material-empty">
                  <span className="canvas-material-empty-icon">
                    <IconSymbol name={assetFiltersActive ? "search" : "file"} />
                  </span>
                  <strong>{assetFiltersActive ? "没有匹配的资产" : "这里还没有资产"}</strong>
                  <p>
                    {assetFiltersActive
                      ? "换一个类型、分类或搜索词试试"
                      : scope === "library"
                        ? "从画布节点的“存为资产”加入当前项目"
                        : scope === "local"
                          ? "将常用节点结果保存为全局资产，可跨项目复用"
                          : "导入图片、视频、音频或文本文件"}
                  </p>
                  {assetFiltersActive ? (
                    <button
                      type="button"
                      onClick={() => {
                        setMaterialKeyword("");
                        setAssetType("all");
                        setAssetCategory("all");
                        setAssetSort("newest");
                      }}
                    >
                      清除筛选
                    </button>
                  ) : scope === "files" ? (
                    <button type="button" onClick={() => void importMaterials()}>
                      <IconSymbol name="upload" />导入文件
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
      </main>
      {data.editor && controller.editor && (
        <Suspense fallback={<div className="video-editor-loading">正在打开剪辑工作区…</div>}>
          <VideoEditorWorkspace {...data.editor} controller={controller.editor} />
        </Suspense>
      )}
    </div>
  );
}
