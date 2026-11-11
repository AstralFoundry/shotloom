import { t } from '@/i18n';
import { memo, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconSymbol } from "../components/IconSymbol";
import { DirectorAgentPane } from '../agent-chat/DirectorAgentPane';
import { registerDirectorDeskFrame } from "../../services/directorDeskAgentRuntime";
import { useWorkbenchSurfaceRoot } from "../layout/workbenchSurface";
import { useDirectorSceneHandoffStore } from "../store/directorSceneHandoffStore";
import { useDirectorWorkspaceExport } from "../views/DirectorWorkspace";
import { useDirectorWorkspaceStore } from "../store/directorWorkspaceStore";
import {
  CanvasNodeLabelRootContext,
  type WorkflowNodeData,
  type WorkflowNodeRenderer,
} from "./WorkflowCanvas";
import {
  directorDeskFrameSrc,
  directorDeskAgentProtocol,
  sendDirectorDeskPanorama,
  sendDirectorDeskSession,
  sendDirectorDeskSceneLoad,
  subscribeDirectorDesk,
  type DirectorDeskPanorama,
  type DirectorDeskSummary,
} from "../adapters/directorDeskBridge";
import "./ThreeDDirectorNode.css";

type IncomingImage = { edgeId: string; nodeId: string; name: string; url: string };
function readDirectorProject(node: WorkflowNodeData) {
  const directorData = node.directorData;
  if (!directorData || typeof directorData !== "object" || Array.isArray(directorData)) return null;
  const project = (directorData as Record<string, unknown>).project;
  return project && typeof project === "object" && !Array.isArray(project)
    && (project as { format?: string; version?: number }).format === 'director-desk'
    && (project as { version?: number }).version === 3 ? project : null;
}

// 导演台一次只容纳一张全景图，所以取当前输入里的最后一条连线。
function toPanorama(image: IncomingImage | undefined): DirectorDeskPanorama | null {
  if (!image) return null;
  return { edgeId: image.edgeId, sourceNodeId: image.nodeId, name: image.name, url: image.url };
}

export const ThreeDDirectorNode: WorkflowNodeRenderer = memo(
  ({ node, selected, resizing, inputRevision, actions }) => {
    const labelRoot = useContext(CanvasNodeLabelRootContext);
    const surface = useWorkbenchSurfaceRoot();
    const [incomingImages, setIncomingImages] = useState<IncomingImage[]>([]);
    const [interacting, setInteracting] = useState(false);
    const [detailOpen, setDetailOpen] = useState(false);
    const [summary, setSummary] = useState<DirectorDeskSummary | null>(null);
    const [selection, setSelection] = useState('');
    const detailIframeRef = useRef<HTMLIFrameElement>(null);
    const latestSceneRef = useRef<unknown>(null);
    // The workspace runs in its own iframe, so its scene can only be read on demand. Subscribe
    // to the reader's existence (not its result) so the button appears once a workspace is live.
    const hasWorkspace = useDirectorWorkspaceExport((state) => state.request !== null);

    const getFrame = useCallback(() => detailIframeRef.current, []);

    useEffect(() => {
      if (!detailOpen) return;
      return registerDirectorDeskFrame(detailIframeRef.current, directorDeskAgentProtocol);
    }, [detailOpen]);

    const sendSession = useCallback(() => {
      sendDirectorDeskSession(detailIframeRef.current, {
        instanceId: node.id,
        theme: "light",
        project: readDirectorProject(node),
      });
    }, [node]);

    const sendPanorama = useCallback(() => {
      sendDirectorDeskPanorama(detailIframeRef.current, toPanorama(incomingImages.at(-1)));
    }, [incomingImages]);

    useEffect(() => {
      void actions.getDirectorIncomingImages(node.id).then(setIncomingImages);
    }, [actions, inputRevision, node.id]);

    useEffect(() => {
      if (!selected) {
        setInteracting(false);
        setDetailOpen(false);
      }
    }, [selected]);

    useEffect(() => {
      if (!interacting) return;
      const handleEscape = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          setInteracting(false);
          setDetailOpen(false);
        }
      };
      window.addEventListener("keydown", handleEscape);
      return () => window.removeEventListener("keydown", handleEscape);
    }, [interacting]);

    useEffect(() => {
      sendPanorama();
    }, [incomingImages, sendPanorama]);

    useEffect(() => {
      const unsubscribe = subscribeDirectorDesk(getFrame, {
        onReady: () => {
          sendSession();
          sendPanorama();
        },
        onInteraction: () => actions.select(node.id),
        onExitInteraction: () => {
          setInteracting(false);
          setDetailOpen(false);
        },
        onPanoramaRemoved: (edgeId) => {
          if (edgeId) actions.removeDirectorIncomingEdge(node.id, edgeId);
        },
        onProjectChanged: (project) => {
          latestSceneRef.current = project;
          const directorData = node.directorData as { project?: unknown; legacyProject?: unknown } | undefined;
          const legacyProject = directorData?.legacyProject ?? (directorData?.project && !readDirectorProject(node) ? directorData.project : null);
          actions.update(node.id, {
            directorData: { project, ...(legacyProject ? { legacyProject } : {}) },
            updatedAt: new Date().toISOString(),
          });
        },
        onCaptures: async (captures) => {
          for (const capture of captures) {
            const result = await actions.exportDirectorAsset(node.id, capture.dataUrl, capture.fileName, capture.kind);
            if (!result) throw new Error('未能创建导出节点');
          }
        },
        // The card describes the scene without the user opening the desk: an empty box says
        // nothing about whether this node is still untouched or already carries a shoot.
        onSceneSummary: (value) => setSummary(value),
        onSelectionChanged: (value) => setSelection(value.name),
      });
      return unsubscribe;
    }, [actions, getFrame, node.id, sendPanorama, sendSession]);

    return (
      <>
      {labelRoot && createPortal(
        <div className="director-node-label">
          <span className="director-node-drag-handle" title={t("ui.ThreeDDirectorNode.title.cb901776")} aria-hidden="true" />
          <IconSymbol name="box" aria-hidden="true" />
          <input
            className="nodrag"
            aria-label={t("ui.ThreeDDirectorNode.arialabel.eea8c33e")}
            value={String(node.title || t("ui.ThreeDDirectorNode.text.1491bf0a"))}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) =>
              actions.update(node.id, {
                title: event.target.value,
                updatedAt: new Date().toISOString(),
              })
            }
          />
          {selected && (
            <button
              type="button"
              className="nodrag"
              title={t("ui.ThreeDDirectorNode.title.9cee0d10")}
              onClick={(event) => {
                event.stopPropagation();
                actions.delete(node.id);
              }}
            >
              <IconSymbol name="trash" />
            </button>
          )}
        </div>,
        labelRoot,
      )}
      <div
        className={`director-node${selected ? " selected" : ""}${resizing ? " resizing" : ""}${interacting ? " interacting" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          actions.select(node.id);
        }}
      >
        <div
          className={`director-node-workspace nopan nowheel${interacting ? " nodrag" : ""}`}
          onDoubleClick={(event) => {
            if (interacting) return;
            event.stopPropagation();
            actions.select(node.id);
            setInteracting(true);
            setDetailOpen(true);
          }}
        >
          <div className="director-node-placeholder">
            <IconSymbol name="box" />
            <strong>{t("ui.ThreeDDirectorNode.text.a3a5199b")}</strong>
            {summary && summary.actors + summary.cameras > 0 ? (
              <p className="director-node-summary">
                <span>{summary.actors} 人</span>
                <span>{summary.cameras} 机位</span>
                <span>{summary.shots} 镜</span>
                <span>{summary.duration.toFixed(0)}s</span>
              </p>
            ) : (
              <p>{t("ui.ThreeDDirectorNode.text.a42cbf47")}</p>
            )}
            {selection ? <p className="director-node-selection">选中 · {selection}</p> : null}
            {incomingImages.length > 1 ? (
              <p className="director-node-warning">仅使用最后一张参考图，另有 {incomingImages.length - 1} 张未使用</p>
            ) : null}
            <div className="director-node-handoff nodrag">
              {summary ? (
                <button
                  type="button"
                  title="把本节点的场景送入侧栏「3D导演台」继续制作"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    const scene = latestSceneRef.current ?? readDirectorProject(node);
                    if (!scene) return;
                    useDirectorSceneHandoffStore.getState().setHandoff({
                      document: scene,
                      sourceNodeId: node.id,
                      label: "节点场景",
                    });
                    useDirectorWorkspaceStore.getState().setOpen(true);
                  }}
                >
                  送到工作区
                </button>
              ) : null}
              {hasWorkspace ? (
                <button
                  type="button"
                  title="把侧栏「3D导演台」当前场景载入本节点"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    const scene = useDirectorWorkspaceExport.getState().request?.();
                    if (!scene) return;
                    actions.update(node.id, {
                      directorData: { project: scene },
                      updatedAt: new Date().toISOString(),
                    });
                    sendDirectorDeskSceneLoad(detailIframeRef.current, scene, "工作区场景");
                  }}
                >
                  载入工作区场景
                </button>
              ) : null}
            </div>
            <button
              type="button"
              className="director-node-open-button nodrag"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                actions.select(node.id);
                setInteracting(true);
                setDetailOpen(true);
              }}
            >
              {t("ui.ThreeDDirectorNode.text.56fb9a73")}</button>
          </div>
        </div>
      </div>
      {detailOpen && surface && createPortal(
        <div className="director-detail-backdrop" role="dialog" aria-label={t("ui.ThreeDDirectorNode.arialabel.fad461cc")}>
          <div className="director-detail-window">
            <button type="button" className="director-detail-close" aria-label="关闭 3D 导演台" onClick={() => { setInteracting(false); setDetailOpen(false); }}>×</button>
            <iframe
              ref={detailIframeRef}
              // 详情窗口使用独立布局；embedded=canvas 会触发导演台的缩略嵌入样式。
              src={directorDeskFrameSrc(node.id, "light")}
              title={t("ui.ThreeDDirectorNode.arialabel.fad461cc")}
              className="director-detail-frame"
              onLoad={() => { sendSession(); sendPanorama(); }}
            />
            <DirectorAgentPane className="director-detail-agent" nodeId={node.id} />
          </div>
        </div>,
        surface,
      )}
      </>
    );
  },
);
