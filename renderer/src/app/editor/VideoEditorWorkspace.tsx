import { t } from '@/i18n';
import { ClipExportMenu } from "./ClipExportMenu";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useWorkbenchSurfaceRoot } from "../layout/workbenchSurface";
import { IconSymbol } from "../components/IconSymbol";
import { AssetPickerDialog } from "./AssetPickerDialog";
import { useEditorMount } from "./openReel/useEditorMount";
import { ClipStudioRuntimeHost } from "./openReel/ClipStudioRuntimeHost";
import { CLIP_NODE_LAYOUT } from "../../utils/clipNodeLayout";
import { useOpenReelBridge } from "./openReel/useOpenReelBridge";
import { OpenReelAgentPanel } from "./openReel/OpenReelAgentPanel";
import type {
  VideoEditorWorkspaceProps,
} from "./openReel/types";
import "./OpenReelWorkspace.css";

export type { VideoEditorAsset } from "./videoEditorTypes";
export type { VideoEditorController } from "./openReel/types";

const AGENT_WIDTH_MIN = 320;
const AGENT_WIDTH_MAX = 720;
/** 剪辑台至少要留这么宽：再窄一点，素材列 + 播放器 + 时间线就摆不下了。 */
const STAGE_MIN_WIDTH = 520;
const AGENT_WIDTH_STORAGE_KEY = "shotloom:clip-agent-width-v1";

function clampAgentWidth(nextWidth: number, available: number): number {
  const maxWidth = Math.max(AGENT_WIDTH_MIN, Math.min(AGENT_WIDTH_MAX, available - STAGE_MIN_WIDTH));
  return Math.round(Math.min(maxWidth, Math.max(AGENT_WIDTH_MIN, nextWidth)));
}

function readStoredAgentWidth(): number {
  const stored = Number(window.localStorage.getItem(AGENT_WIDTH_STORAGE_KEY));
  return clampAgentWidth(Number.isFinite(stored) && stored > 0 ? stored : 360, window.innerWidth);
}

export function VideoEditorWorkspace({
  nodeId,
  expanded = true,
  canvasNode = false,
  selected = true,
  intent,
  title = t("ui.ReactWorkbench.text.3d65ff77"),
  project,
  assets,
  controller,
  agentPanel,
}: VideoEditorWorkspaceProps) {
  const surface = useWorkbenchSurfaceRoot();
  const { mount, active } = useEditorMount(surface, canvasNode ? nodeId : undefined, expanded, selected);
  const [agentVisible, setAgentVisible] = useState(true);
  const [agentWidth, setAgentWidth] = useState(readStoredAgentWidth);
  const [resizingAgent, setResizingAgent] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const bridge = useOpenReelBridge({
    nodeId,
    title,
    project,
    assets,
    controller,
    active,
    expanded,
    canvasNode,
  });
  // Inline canvas timelines must not mount a chat Session for every clip node.
  const agentOpen = expanded && agentPanel && agentVisible;

  const resizeAgentPanel = useCallback((nextWidth: number) => {
    const width = clampAgentWidth(nextWidth, stageRef.current?.clientWidth ?? window.innerWidth);
    setAgentWidth(width);
    window.localStorage.setItem(AGENT_WIDTH_STORAGE_KEY, String(width));
  }, []);

  const startAgentResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = agentWidth;
    setResizingAgent(true);
    const move = (moveEvent: PointerEvent) => resizeAgentPanel(startWidth + startX - moveEvent.clientX);
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      setResizingAgent(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }, [agentWidth, resizeAgentPanel]);

  const resizeAgentWithKeyboard = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    resizeAgentPanel(agentWidth + (event.key === "ArrowLeft" ? 16 : -16));
  }, [agentWidth, resizeAgentPanel]);

  useEffect(() => {
    // 窗口变窄后必须按当前舞台宽度重新夹取，否则上次记住的宽面板会把剪辑台挤成一条缝。
    const onResize = () => resizeAgentPanel(agentWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [agentWidth, resizeAgentPanel]);

  const toggleAgent = useCallback(() => setAgentVisible(value => !value), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || bridge.exporting) return;
      // 选择器打开时 Escape 只关选择器；画布卡片里也能用它退出挑选。
      if (bridge.pickerOpen) {
        event.preventDefault();
        bridge.closeMediaPicker();
        return;
      }
      if (!expanded) return;
      if (event.composedPath().some(item => item instanceof HTMLElement && item.classList.contains("clip-studio-runtime-host"))) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest(".ov-openreel-agent")) return;
      event.preventDefault();
      void bridge.handleClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [bridge, expanded]);

  const consumedIntent = useRef<typeof intent>(undefined);
  useEffect(() => {
    if (!bridge.loaded || !intent || consumedIntent.current === intent) return;
    consumedIntent.current = intent;
    controller.consumeIntent?.();
    if (intent.type === "import") bridge.openMediaPicker();
    else if (intent.type === "play") bridge.play();
    else void bridge.handleExport(intent).catch(() => {});
  }, [bridge, controller, intent]);

  const exportLabel = useMemo(() => {
    if (!bridge.exporting) return t("ui.VideoEditorWorkspace.text.4616dc6f");
    return t("ui.VideoEditorWorkspace.text.db87887a", { value0: Math.round(bridge.progress * 100) });
  }, [bridge.exporting, bridge.progress]);

  if (!surface) return null;
  return createPortal(
    <section className={`ov-openreel${expanded ? "" : " is-canvas"}`} role={expanded ? "dialog" : "region"} aria-label={t("ui.VideoEditorWorkspace.arialabel.4058ca7f")}>
      <header className="ov-openreel-head">
        <div className="ov-openreel-title">
          <button
            type="button"
            className="ov-openreel-back"
            onClick={() => void bridge.handleClose()}
            disabled={bridge.exporting}
          >
            <IconSymbol name="arrow-left" />
            {t("ui.VideoEditorWorkspace.text.6e0bad77")}</button>
          <strong>{title}</strong>
          {bridge.error && (
            <span className="ov-openreel-error" title={bridge.error}>
              {bridge.error}
            </span>
          )}
        </div>
        <div className="ov-openreel-actions">
          <button
            type="button"
            className="ov-openreel-icon"
            aria-label={t("ui.BottomModeBar.title.9fcefd8d")}
            title={t("ui.BottomModeBar.title.9fcefd8d")}
            disabled={!bridge.canUndo || bridge.exporting}
            onClick={() => bridge.undo()}
          >
            <IconSymbol name="undo" />
          </button>
          <button
            type="button"
            className="ov-openreel-icon"
            aria-label={t("ui.BottomModeBar.title.1238f0d3")}
            title={t("ui.BottomModeBar.title.1238f0d3")}
            disabled={!bridge.canRedo || bridge.exporting}
            onClick={() => bridge.redo()}
          >
            <IconSymbol name="redo" />
          </button>
          <span className="ov-openreel-divider" aria-hidden />
          <button
            type="button"
            onClick={() => bridge.openMediaPicker()}
            disabled={!bridge.loaded || bridge.exporting}
          >
            <IconSymbol name="upload" />
            {t("ui.AssetPickerDialog.arialabel.9d557f2a")}</button>
          {expanded && agentPanel && (
            <button
              type="button"
              aria-pressed={agentVisible}
              onClick={toggleAgent}
              disabled={bridge.exporting}
            >
              <IconSymbol name="spark" />
              {t("ui.VideoEditorWorkspace.text.61b7624d")}</button>
          )}
          <button
            type="button"
            className="primary"
            onClick={() => bridge.openExportMenu()}
            disabled={bridge.exporting || !bridge.loaded}
          >
            <IconSymbol name="download" />
            {exportLabel}
          </button>
        </div>
      </header>
      <div
        className={`ov-openreel-stage${agentOpen ? " agent-open" : ""}`}
        ref={stageRef}
        data-resizing={resizingAgent || undefined}
      >
        <ClipStudioRuntimeHost
          nodeId={nodeId}
          presentation={expanded ? "editor" : "canvas"}
          active={active}
          layout={canvasNode && !expanded ? CLIP_NODE_LAYOUT : undefined}
          callbacks={bridge.runtimeCallbacks}
          bindRuntime={bridge.bindRuntime}
          flushSnapshot={bridge.flushSnapshot}
        />
        {agentOpen && (
          <>
            <div
              className="ov-openreel-agent-divider"
              style={{ right: agentWidth }}
              role="separator"
              aria-label={t("ui.VideoEditorWorkspace.arialabel.a7fd53a7")}
              aria-orientation="vertical"
              aria-valuemin={AGENT_WIDTH_MIN}
              aria-valuemax={AGENT_WIDTH_MAX}
              aria-valuenow={agentWidth}
              tabIndex={0}
              onPointerDown={startAgentResize}
              onKeyDown={resizeAgentWithKeyboard}
            />
            <OpenReelAgentPanel
              nodeId={nodeId}
              width={agentWidth}
              onClose={() => {
                setAgentVisible(false);

              }}
            />
          </>
        )}
      </div>
      {bridge.exportAnchor && <ClipExportMenu anchor={bridge.exportAnchor} project={bridge.exportProject}
        onClose={bridge.closeExportMenu} onExport={bridge.handleExport} />}
      {bridge.exporting && createPortal(<div className="clip-export-progress" role="status">
        <span>{bridge.status} {Math.round(bridge.progress * 100)}%</span>
        <button type="button" onClick={bridge.cancelExport}>{t("ui.VideoEditorWorkspace.text.56afa043")}</button>
      </div>, surface)}
      {(bridge.saveError || bridge.loadError) && createPortal(
        <div className="clip-persistence-error" role="alert">
          <span>{bridge.loadError || bridge.saveError}</span>
          <button type="button" disabled={bridge.retrying} onClick={() => void bridge.retryPersistence()}>
            {bridge.retrying ? t("ui.VideoEditorWorkspace.text.46fbe12e") : bridge.loadError ? t("ui.VideoEditorWorkspace.text.7784972f") : t("ui.VideoEditorWorkspace.text.c47e2636")}
          </button>
        </div>, surface)}
      {canvasNode && !expanded && selected && bridge.error && !bridge.saveError && !bridge.loadError
        && bridge.exportRecoveries.length === 0 && createPortal(
        <div className="clip-persistence-error clip-operation-error" role="alert">
          <span>{bridge.error}</span>
          <button type="button" onClick={bridge.dismissError}>{t("ui.CanvasToolbarCustomizeDialog.arialabel.6c14bd7f")}</button>
        </div>, surface)}
      {bridge.offlineMedia.length > 0 && (selected || expanded) && createPortal(
        <div className="clip-offline-media nodrag nowheel" role="alert">
          {bridge.relinkError && <span>{bridge.relinkError}</span>}
          {bridge.offlineMedia.map((item) => <div key={item.id}>
            <span>{t("ui.VideoEditorWorkspace.text.51a91315")}{item.name}{item.reason ? `。${item.reason}` : ""}</span>
            <button type="button" disabled={bridge.relinking || bridge.exporting} onClick={() => void bridge.recoverMedia(item.id)}>
              {bridge.relinking ? t("ui.VideoEditorWorkspace.text.0654d3fc") : t("ui.VideoEditorWorkspace.text.d3009d56")}
            </button>
          </div>)}
        </div>, surface)}
      {bridge.exportRecoveries.length > 0 && createPortal(
        <div className="clip-export-recovery" role="alert">
          {bridge.exportRecoveries.map((delivery) => <div key={delivery.id}>
            <span>{delivery.nodeId ? t("ui.VideoEditorWorkspace.text.76ec3c5f") : delivery.materialId ? t("ui.VideoEditorWorkspace.text.470ab65a") : t("ui.VideoEditorWorkspace.text.74548a92")}：{delivery.name}。{delivery.error || t("ui.VideoEditorWorkspace.text.06ec76cb")}</span>
            <button type="button" disabled={bridge.deliveryBusy} onClick={() => void bridge.retryExportDelivery(delivery.id)}>
              {bridge.deliveryBusy ? t("ui.VideoEditorWorkspace.text.6dcd1118") : t("ui.VideoEditorWorkspace.text.c795d233")}
            </button>
            <button type="button" disabled={bridge.deliveryBusy} onClick={() => bridge.endExportRecovery(delivery.id)}>
              {t("ui.VideoEditorWorkspace.text.10645c03")}</button>
            <small>{t("ui.VideoEditorWorkspace.text.ef9d7032")}{delivery.filePath}</small>
          </div>)}
        </div>, surface)}
      <AssetPickerDialog
        nodeId={nodeId}
        open={bridge.pickerOpen}
        project={project}
        busy={bridge.mediaBusy}
        onClose={bridge.closeMediaPicker}
        onConfirm={bridge.confirmMediaPicker}
        onLocalUpload={bridge.uploadLocalMedia}
      />
    </section>,
    mount,
  );
}
