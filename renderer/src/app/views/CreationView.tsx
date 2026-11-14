import { useAppStore } from '../store/appStore';
import { t } from '@/i18n';
import { formatItemCount } from '../../utils/format.ts';
import { CANVAS_AGENT_ID } from '../../agent/agents/definitions';
import {
  lazy,
  Suspense,
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Viewport } from "@xyflow/react";
import { App, Segmented, Select } from "antd";
import { CanvasStartup } from "../canvas/CanvasStartup";
import { DirectorWorkspace } from "./DirectorWorkspace";
import { DirectorAgentPane } from '../agent-chat/DirectorAgentPane';
import { directorDeskWorkspaceSrc } from "../adapters/directorDeskBridge";
import { BottomModeBar } from "../canvas/BottomModeBar";
import { ProjectVersionHistory } from "../components/ProjectVersionHistory";
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
import { HarnessChatPanel } from "../agent-chat/HarnessChatPanel";
import type { VideoEditorController } from "../editor/VideoEditorWorkspace";
import type { VideoEditorWorkspaceProps } from "../editor/openReel/types";
import type { AgentLayoutMode } from "../../services/agentLayoutService";
import { assetCategories, assetCategoryFor } from "../../domain/asset/assetCategories";
import { SearchInput } from "../components/SearchInput";

const VideoEditorWorkspace = lazy(() =>
  import("../editor/VideoEditorWorkspace").then((module) => ({
    default: module.VideoEditorWorkspace,
  })),
);

export interface CreationViewController {
  canvas: WorkflowCanvasController;
  nodes: WorkflowNodeActions;
  applyMaterial: (item: MaterialItem, scope: "library" | "local" | "files") => void | Promise<void>;
  previewMaterial: (item: MaterialItem, src: string, kind: "image" | "video") => void;
  showMaterialInFolder: (item: MaterialItem) => void | Promise<void>;
  loadMaterials: () => {
    projectAssets: MaterialItem[];
    localAssets: MaterialItem[];
    materials: MaterialItem[];
  };
  importMaterials: () => void | Promise<void>;
  deleteMaterial: (item: MaterialItem, scope: "library" | "local" | "files") => boolean | void | Promise<boolean | void>;
  undo: () => void;
  redo: () => void;
  fitView: () => void;
  autoLayout: (options?: { mode?: AgentLayoutMode; includeConnected?: boolean }) => boolean;
  exportSelected: () => void;
  mergeVideos: () => void;
  editor?: VideoEditorController;
}
export interface CreationViewData {
  /** 顶层「导演台」入口：整页交给导演台，关闭后回到同一个画布。 */
  fullDirectorWorkspace?: boolean;
  onLeaveFullDirectorWorkspace?: () => void;
  nodes: WorkflowNodeData[];
  artifactNodes: WorkflowNodeData[];
  edges: WorkflowEdge[];
  viewport: Viewport;
  history: { canUndo: boolean; canRedo: boolean };
  shortcutLabels: { fitView: string; autoLayout: string };
  editor?: Omit<VideoEditorWorkspaceProps, 'controller' | 'agentPanel'>;
}

export function CreationView({
  data,
  controller,
}: {
  data: CreationViewData;
  controller: CreationViewController;
}) {
  if (data.fullDirectorWorkspace) return <FullDirectorWorkspace data={data} />;
  return <CreationCanvas data={data} controller={controller} />;
}

function FullDirectorWorkspace({ data }: { data: CreationViewData }) {
  const [agentCollapsed, setAgentCollapsed] = useState(true);
  const [entityRequest, setEntityRequest] = useState<{ id: string; nonce: number }>();
  const entityRequestSerial = useRef(0);
  return <div className="director-workspace-host" data-canvas-no-zoom>
    <DirectorWorkspace
      src={directorDeskWorkspaceSrc}
      onExit={() => data.onLeaveFullDirectorWorkspace?.()}
      onOpenAgent={(entityId) => {
        setAgentCollapsed(false);
        if (entityId) setEntityRequest({ id: entityId, nonce: ++entityRequestSerial.current });
      }}
    />
    <DirectorAgentPane className="director-workspace-agent" collapsed={agentCollapsed} onCollapsedChange={setAgentCollapsed}
      entityRequest={entityRequest} onEntityRequestHandled={nonce => setEntityRequest(current => current?.nonce === nonce ? undefined : current)} />
  </div>;
}

function CreationCanvas({ data, controller }: { data: CreationViewData; controller: CreationViewController }) {
  const { modal } = App.useApp();
  const [canvasReady, setCanvasReady] = useState(false);
  const [agentStatus, setAgentStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const markCanvasReady = useCallback(() => setCanvasReady(true), []);
  const [agentPanelVisible, setAgentPanelVisible] = useState(true);
  const starting = !canvasReady || (agentPanelVisible && agentStatus === 'loading');
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [agentPanelWidth, setAgentPanelWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem("shotloom:agent-panel-width-v4"));
    const preferred = Math.round(window.innerWidth * 0.4);
    const available = Math.max(360, Math.min(680, window.innerWidth - 420));
    return Number.isFinite(saved) && saved > 0
      ? Math.min(available, Math.max(360, saved))
      : Math.min(available, Math.min(620, Math.max(420, preferred)));
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
  const [focusedAssetId, setFocusedAssetId] = useState('');
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
      const itemCategory = assetCategoryFor(item.category).id;
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
    setFocusedAssetId('');
    const next = refreshMaterials();
    setScope(next.library.length ? "library" : next.local.length ? "local" : "files");
    setMaterialKeyword("");
    setAssetType("all");
    setAssetCategory("all");
    setAssetSort("newest");
    setPicker(true);
  }
  const assetBrowserRequest = useAppStore(state => state.assetBrowserRequest);
  useEffect(() => {
    if (!assetBrowserRequest) return;
    refreshMaterials(assetBrowserRequest.scope);
    setAssetType('all');
    setAssetCategory(assetBrowserRequest.category);
    setMaterialKeyword(assetBrowserRequest.name);
    setFocusedAssetId(assetBrowserRequest.assetId);
    setPicker(true);
    useAppStore.getState().clearAssetBrowserRequest();
  }, [assetBrowserRequest]);
  useEffect(() => {
    if (!picker || !focusedAssetId) return;
    const frame = requestAnimationFrame(() => {
      const card = [...(assetPickerRef.current?.querySelectorAll<HTMLElement>('[data-asset-id]') || [])].find(element => element.dataset.assetId === focusedAssetId);
      card?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [picker, focusedAssetId, items]);
  async function importMaterials() {
    await controller.importMaterials();
    refreshMaterials("files");
  }
  function resizeAgentPanel(nextWidth: number) {
    const maxWidth = Math.max(360, Math.min(680, window.innerWidth - 420));
    const width = Math.round(Math.min(maxWidth, Math.max(360, nextWidth)));
    setAgentPanelWidth(width);
    window.localStorage.setItem("shotloom:agent-panel-width-v4", String(width));
  }
  function startAgentPanelResize(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = agentPanelWidth;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (moveEvent: globalThis.PointerEvent) => {
      resizeAgentPanel(startWidth + startX - moveEvent.clientX);
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
  function resizeAgentPanelWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    resizeAgentPanel(agentPanelWidth + (event.key === "ArrowLeft" ? 16 : -16));
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
        className={`forge-lite-main${agentPanelVisible ? "" : " agent-collapsed"}`}
        inert={starting}
        style={
          agentPanelVisible ? { gridTemplateColumns: `minmax(0, 1fr) ${agentPanelWidth}px` } : undefined
        }
      >
        <WorkflowCanvas
          onReady={markCanvasReady}
          nodes={data.nodes}
          edges={data.edges}
          viewport={data.viewport}
          renderers={workflowNodeRenderers}
          nodeActions={controller.nodes}
          controller={controller.canvas}
          onAutoLayout={controller.autoLayout}
          addNodeMention={(nodeId) => {
            window.dispatchEvent(new CustomEvent("shotloom:mention-node", { detail: nodeId }));
          }}
          overlay={
            <>
            <BottomModeBar
              canUndo={data.history.canUndo}
              canRedo={data.history.canRedo}
              shortcutLabels={data.shortcutLabels}
              onUndo={controller.undo}
              onRedo={controller.redo}
              onMaterialPicker={openPicker}
              onAutoLayout={controller.autoLayout}
              onMergeVideos={controller.mergeVideos}
              onCreateSection={() => controller.canvas.createSection?.()}
              onOpenHistory={() => setVersionHistoryOpen(true)}
            />
            </>
          }
        />
        {agentPanelVisible && (
          <div
            className="forge-workspace-divider"
            style={{ right: agentPanelWidth }}
            role="separator"
            aria-label={t("ui.CreationView.arialabel.f180d76a")}
            aria-orientation="vertical"
            aria-valuemin={360}
            aria-valuemax={680}
            aria-valuenow={agentPanelWidth}
            tabIndex={0}
            onPointerDown={startAgentPanelResize}
            onKeyDown={resizeAgentPanelWithKeyboard}
          />
        )}
        {agentPanelVisible ? (
          <HarnessChatPanel agentId={CANVAS_AGENT_ID} onStatusChange={setAgentStatus} onClose={() => setAgentPanelVisible(false)} />
        ) : (
          <button className="forge-agent-reopen" onClick={() => setAgentPanelVisible(true)}>
            {t("ui.CreationView.text.e178fa71")}</button>
        )}
      <ProjectVersionHistory
        open={versionHistoryOpen}
        onClose={() => setVersionHistoryOpen(false)}
      />
      {picker && (
        <div
          className="canvas-asset-popover-layer"
          style={{ right: agentPanelVisible ? agentPanelWidth : 0 }}
        >
          <section
            ref={assetPickerRef}
            className="canvas-material-picker"
            style={{ height: assetDrawerHeight }}
          >
            <div
              className="canvas-asset-drawer-resizer"
              role="separator"
              aria-label={t("ui.CreationView.arialabel.c546ee30")}
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
                <strong>{t("ui.ProjectSearch.kind.713fd96f")}</strong>
              </div>
              <div className="canvas-material-picker-actions">
                <div className="canvas-asset-view-switch" aria-label={t("ui.CreationView.arialabel.c2040527")}>
                  <button
                    className={assetView === "list" ? "active" : ""}
                    type="button"
                    title={t("ui.CreationView.title.1fd2104d")}
                    onClick={() => setAssetView("list")}
                  >
                    <IconSymbol name="list" />
                  </button>
                  <button
                    className={assetView === "grid" ? "active" : ""}
                    type="button"
                    title={t("ui.CreationView.title.63a3454e")}
                    onClick={() => setAssetView("grid")}
                  >
                    <IconSymbol name="grid" />
                  </button>
                </div>
                <button className="canvas-material-import" onClick={() => void importMaterials()}>
                  <IconSymbol name="upload" />{t("ui.CreationView.text.60e2bcad")}</button>
                <button className="canvas-material-close" title={t("ui.CanvasToolbarCustomizeDialog.arialabel.6c14bd7f")} onClick={() => setPicker(false)}>
                  <IconSymbol name="x" />
                </button>
              </div>
            </header>
            <div className="canvas-material-browser-bar">
              <Segmented
                className="canvas-material-tabs"
                aria-label={t("ui.CreationView.arialabel.60849240")}
                value={scope}
                onChange={(value) => setScope(value as "library" | "local" | "files")}
                options={[
                  {
                    value: "library",
                    label: (
                      <span className="canvas-material-tab">
                        {t("ui.ProjectSearch.text.96cb64ae")}<span>{materials.library.length}</span>
                      </span>
                    ),
                  },
                  {
                    value: "local",
                    label: (
                      <span className="canvas-material-tab">
                        {t("ui.CreationView.text.d2199cbf")}<span>{materials.local.length}</span>
                      </span>
                    ),
                  },
                  {
                    value: "files",
                    label: (
                      <span className="canvas-material-tab">
                        {t("ui.CreationView.text.2b6b5d89")}<span>{materials.files.length}</span>
                      </span>
                    ),
                  },
                ]}
              />
              <label className="canvas-material-search">
                <SearchInput
                  value={materialKeyword}
                  onChange={setMaterialKeyword}
                  placeholder={t("ui.CreationView.placeholder.f7e88754")}
                  autoFocus
                />
              </label>
            </div>
            <div className="canvas-asset-filters">
              <div className="canvas-asset-filter-field" aria-label={t("ui.CreationView.arialabel.74e3df5b")}>
                <Select
                  aria-label={t("ui.CreationView.arialabel.74e3df5b")}
                  value={assetType}
                  onChange={setAssetType}
                  size="small"
                  variant="borderless"
                  popupMatchSelectWidth={false}
                  options={[
                    { value: "all", label: t("ui.CreationView.text.fa6968d9") },
                    { value: "image", label: t("ui.CreationView.text.604dfedb") },
                    { value: "video", label: t("ui.CreationView.text.42baf234") },
                    { value: "audio", label: t("ui.CreationView.text.0c2d8d74") },
                    { value: "text", label: t("ui.CreationView.text.e77f069b") },
                    { value: "file", label: t("ui.CreationView.text.803b3b26") },
                  ]}
                />
              </div>
              <div className="canvas-asset-categories" role="group" aria-label={t('assets.collection.label')}>
                <button type="button" aria-pressed={assetCategory === 'all'} onClick={() => setAssetCategory('all')}>{t("ui.CreationView.text.a8e369c4")}</button>
                {assetCategories.map(category => (
                  <button key={category.id} type="button" aria-pressed={assetCategory === category.id}
                    onClick={() => setAssetCategory(category.id)}>{category.label}</button>
                ))}
              </div>
              <div className="canvas-asset-sort" aria-label={t("ui.CreationView.arialabel.e545c64b")}>
                <Select
                  aria-label={t("ui.CreationView.arialabel.e545c64b")}
                  value={assetSort}
                  onChange={(value) => setAssetSort(value as "newest" | "oldest" | "name")}
                  size="small"
                  variant="borderless"
                  popupMatchSelectWidth={false}
                  options={[
                    { value: "newest", label: t("ui.CreationView.text.44ceb013") },
                    { value: "oldest", label: t("ui.CreationView.text.4e2f1163") },
                    { value: "name", label: t("ui.CreationView.text.0ea96767") },
                  ]}
                />
              </div>
              <output>{formatItemCount(items.length)}</output>
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
                  {t("ui.AssetPickerDialog.text.4bbc4e5f")}</button>
              )}
            </div>
            <div className={`canvas-material-picker-body asset-view-${assetView}`}>
              {items.length ? (
                <MaterialGrid
                  materials={items}
                  focusedAssetId={focusedAssetId}
                  showLibraryAction={false}
                  showFileAction
                  showRenameAction={false}
                  showDeleteAction
                  clickToApply
                  onPreview={controller.previewMaterial}
                  onAction={(action, item) => {
                    if (action === "apply-to-canvas") {
                      void controller.applyMaterial(item, scope);
                      setPicker(false);
                    } else if (action === "show-file") {
                      void controller.showMaterialInFolder(item);
                    } else if (action === "delete-item") {
                      const label = scope === "library"
                        ? t("ui.CreationView.text.ba88bd32")
                        : scope === "local"
                          ? t("ui.CreationView.text.491bda48")
                          : t("ui.CreationView.text.3dc880c1");
                      modal.confirm({
                        title: t("ui.CreationView.text.f8b843fc", { value0: label, value1: item.name || t("ui.canvasMediaSelection.text.b61b7f74") }),
                        okButtonProps: { danger: true },
                        onOk: () => Promise.resolve(controller.deleteMaterial(item, scope)).then((result) => {
                          if (result !== false) refreshMaterials(scope);
                        }),
                      });
                    }
                  }}
                />
              ) : (
                <div className="canvas-material-empty">
                  <span className="canvas-material-empty-icon">
                    <IconSymbol name={assetFiltersActive ? "search" : "file"} />
                  </span>
                  <strong>{assetFiltersActive ? t("ui.CreationView.text.8e9479a5") : t("ui.CreationView.text.a4abb52f")}</strong>
                  <p>
                    {assetFiltersActive
                      ? t("ui.CreationView.text.0b69a69d")
                      : scope === "library"
                        ? t("ui.CreationView.text.f2dab150")
                        : scope === "local"
                          ? t("ui.CreationView.text.4750bba6")
                          : t("ui.CreationView.text.17425c66")}
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
                      {t("ui.AssetPickerDialog.text.4bbc4e5f")}</button>
                  ) : scope === "files" ? (
                    <button type="button" onClick={() => void importMaterials()}>
                      <IconSymbol name="upload" />{t("ui.CreationView.text.8fb6f00e")}</button>
                  ) : null}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
      </main>
      {starting && <CanvasStartup canvasReady={canvasReady} />}
      {data.editor && controller.editor && (
        <Suspense fallback={<div className="video-editor-loading">{t("ui.CreationView.text.4f84de9d")}</div>}>
          <VideoEditorWorkspace
            key={data.editor.sessionKey || data.editor.nodeId}
            {...data.editor}
            controller={controller.editor}
            agentPanel
          />
        </Suspense>
      )}
    </div>
  );
}
