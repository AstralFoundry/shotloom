import {
  lazy,
  Suspense,
  type KeyboardEvent,
  type PointerEvent,
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
  loadMaterials: () => {
    projectAssets: MaterialItem[];
    localAssets: MaterialItem[];
    materials: MaterialItem[];
  };
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
  const [scope, setScope] = useState<"library" | "local" | "files">("library");
  const [materials, setMaterials] = useState<{
    library: MaterialItem[];
    local: MaterialItem[];
    files: MaterialItem[];
  }>({ library: [], local: [], files: [] });
  const items = materials[scope];
  function openPicker() {
    const loaded = controller.loadMaterials();
    const next = {
      library: loaded.projectAssets,
      local: loaded.localAssets,
      files: loaded.materials,
    };
    setMaterials(next);
    setScope(next.library.length ? "library" : next.local.length ? "local" : "files");
    setPicker(true);
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
      </main>
      {picker && (
        <div
          className="canvas-material-picker-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && setPicker(false)}
        >
          <section className="canvas-material-picker">
            <header>
              <div>
                <p>应用素材到画布</p>
                <h3>选择一个素材作为生成节点输入</h3>
              </div>
              <button onClick={() => setPicker(false)}>关闭</button>
            </header>
            <div className="canvas-material-tabs">
              <button
                className={scope === "library" ? "active" : ""}
                onClick={() => setScope("library")}
              >
                项目素材
              </button>
              <button
                className={scope === "local" ? "active" : ""}
                onClick={() => setScope("local")}
              >
                通用素材
              </button>
              <button
                className={scope === "files" ? "active" : ""}
                onClick={() => setScope("files")}
              >
                素材文件
              </button>
            </div>
            <div className="canvas-material-picker-body">
              {items.length ? (
                <MaterialGrid
                  materials={items}
                  showLibraryAction={false}
                  showFileAction={false}
                  showRenameAction={false}
                  showDeleteAction={false}
                  clickToApply
                  onPreview={controller.previewMaterial}
                  onAction={(action, item) => {
                    if (action === "apply-to-canvas") {
                      void controller.applyMaterial(item, scope);
                      setPicker(false);
                    }
                  }}
                />
              ) : (
                <div className="canvas-material-empty">
                  {scope === "library"
                    ? "项目素材里还没有可用资源。"
                    : scope === "local"
                      ? "通用素材库还是空的。"
                      : "素材文件里还没有资源。"}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
      {data.editor && controller.editor && (
        <Suspense fallback={<div className="video-editor-loading">正在打开剪辑工作区…</div>}>
          <VideoEditorWorkspace {...data.editor} controller={controller.editor} />
        </Suspense>
      )}
    </div>
  );
}
