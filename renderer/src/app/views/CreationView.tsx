import { useAppStore } from '../store/appStore';
import { t } from '@/i18n';
import { CANVAS_AGENT_ID } from '../../agent/agents/definitions';
import {
  lazy,
  Suspense,
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useCallback,
  useState,
} from "react";
import type { Viewport } from "@xyflow/react";
import { CanvasStartup } from "../canvas/CanvasStartup";
import { IconSymbol } from "../components/IconSymbol";
import { BottomModeBar } from "../canvas/BottomModeBar";
import { PoseLibraryModal } from "../canvas/PoseLibraryModal";
import { ProjectVersionHistory } from "../components/ProjectVersionHistory";
import {
  WorkflowCanvas,
  type WorkflowCanvasController,
  type WorkflowEdge,
  type WorkflowNodeActions,
  type WorkflowNodeData,
} from "../canvas/WorkflowCanvas";
import { workflowNodeRenderers } from "../canvas/nodeRegistry";
import type { MaterialItem } from "../components/MaterialGrid";
import { AssetLibraryModal } from "../components/AssetLibraryBrowser";
import { HarnessChatPanel } from "../agent-chat/HarnessChatPanel";
import type { VideoEditorController } from "../editor/VideoEditorWorkspace";
import type { VideoEditorWorkspaceProps } from "../editor/openReel/types";
import type { AgentLayoutMode } from "../../services/agentLayoutService";

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
  nodes: WorkflowNodeData[];
  artifactNodes: WorkflowNodeData[];
  edges: WorkflowEdge[];
  selectedEdgeId?: string | null;
  viewport: Viewport;
  history: { canUndo: boolean; canRedo: boolean };
  shortcutLabels: { fitView: string; autoLayout: string };
  editor?: Omit<VideoEditorWorkspaceProps, 'controller' | 'agentPanel'>;
}

function dispatchCanvasNodeMention(nodeId: string) {
  window.dispatchEvent(new CustomEvent("shotloom:mention-node", { detail: nodeId }));
}

export function CreationView({
  data,
  controller,
}: {
  data: CreationViewData;
  controller: CreationViewController;
}) {
  return <CreationCanvas data={data} controller={controller} />;
}

function CreationCanvas({ data, controller }: { data: CreationViewData; controller: CreationViewController }) {
  const [canvasReady, setCanvasReady] = useState(false);
  const [agentStatus, setAgentStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const markCanvasReady = useCallback(() => setCanvasReady(true), []);
  const [agentPanelVisible, setAgentPanelVisible] = useState(false);
  const [pendingMention, setPendingMention] = useState<string | null>(null);
  function openAgentPanel() {
    if (!agentPanelVisible) setAgentStatus('loading');
    setAgentPanelVisible(true);
  }
  function mentionNode(nodeId: string) {
    if (agentPanelVisible && agentStatus === 'ready') dispatchCanvasNodeMention(nodeId);
    else { setPendingMention(nodeId); openAgentPanel(); }
  }
  useEffect(() => {
    if (!agentPanelVisible || agentStatus !== 'ready' || !pendingMention) return;
    dispatchCanvasNodeMention(pendingMention);
    setPendingMention(null);
  }, [agentPanelVisible, agentStatus, pendingMention]);
  const starting = !canvasReady;
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [poseLibraryOpen, setPoseLibraryOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [agentPanelWidth, setAgentPanelWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem("shotloom:agent-panel-width-v4"));
    const preferred = Math.round(window.innerWidth * 0.4);
    const available = Math.max(360, Math.min(680, window.innerWidth - 420));
    return Number.isFinite(saved) && saved > 0
      ? Math.min(available, Math.max(360, saved))
      : Math.min(available, Math.min(620, Math.max(420, preferred)));
  });
  const [picker, setPicker] = useState(false);
  const [pickerRequest, setPickerRequest] = useState<NonNullable<ReturnType<typeof useAppStore.getState>['assetBrowserRequest']> | null>(null);
  function openPicker() {
    setPickerRequest(null);
    setPicker(value => !value);
  }
  const assetBrowserRequest = useAppStore(state => state.assetBrowserRequest);
  useEffect(() => {
    if (!assetBrowserRequest) return;
    setPickerRequest(assetBrowserRequest);
    setPicker(true);
    useAppStore.getState().clearAssetBrowserRequest();
  }, [assetBrowserRequest]);
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
          onOpenShortcuts={() => setShortcutsOpen(true)}
          nodes={data.nodes}
          edges={data.edges}
          selectedEdgeId={data.selectedEdgeId ?? null}
          viewport={data.viewport}
          renderers={workflowNodeRenderers}
          nodeActions={controller.nodes}
          controller={controller.canvas}
          onAutoLayout={controller.autoLayout}
          addNodeMention={mentionNode}
          onOpenPoseLibrary={() => setPoseLibraryOpen(true)}
          overlay={(controls) => (
            <BottomModeBar
              {...controls}
              materialOpen={picker}
              shortcutsOpen={shortcutsOpen}
              onCloseShortcuts={() => setShortcutsOpen(false)}
              canUndo={data.history.canUndo}
              canRedo={data.history.canRedo}
              shortcutLabels={data.shortcutLabels}
              onUndo={controller.undo}
              onRedo={controller.redo}
              onMaterialPicker={openPicker}
              onMergeVideos={controller.mergeVideos}
              onOpenHistory={() => setVersionHistoryOpen(true)}
              onOpenPoseLibrary={() => setPoseLibraryOpen(true)}
            />
          )}
        />
        <PoseLibraryModal open={poseLibraryOpen} onClose={() => setPoseLibraryOpen(false)} />
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
          <button type="button" className="forge-agent-reopen" aria-expanded={false} onClick={openAgentPanel}>
            <IconSymbol name="chat" />{t("ui.CreationView.text.e178fa71")}</button>
        )}
      <ProjectVersionHistory
        open={versionHistoryOpen}
        onClose={() => setVersionHistoryOpen(false)}
      />
      {picker && <AssetLibraryModal open onClose={() => setPicker(false)} controller={controller} request={pickerRequest} />}
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
