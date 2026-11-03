import { t } from '@/i18n';
import { memo, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconSymbol } from "../components/IconSymbol";
import { useWorkbenchSurfaceRoot } from "../layout/workbenchSurface";
import {
  CanvasNodeLabelRootContext,
  type WorkflowNodeData,
  type WorkflowNodeRenderer,
} from "./WorkflowCanvas";
import {
  directorDeskFrameSrc,
  sendDirectorDeskPanorama,
  sendDirectorDeskSession,
  subscribeDirectorDesk,
  type DirectorDeskPanorama,
} from "../adapters/directorDeskBridge";
import "./ThreeDDirectorNode.css";

type IncomingImage = { edgeId: string; nodeId: string; name: string; url: string };
function readDirectorProject(node: WorkflowNodeData) {
  const directorData = node.directorData;
  if (!directorData || typeof directorData !== "object" || Array.isArray(directorData)) return null;
  const project = (directorData as Record<string, unknown>).project;
  return project && typeof project === "object" && !Array.isArray(project) ? project : null;
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
    const detailIframeRef = useRef<HTMLIFrameElement>(null);

    const getFrame = useCallback(() => detailIframeRef.current, []);

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
        onDeleteNode: () => actions.delete(node.id),
        onPanoramaRemoved: (edgeId) => {
          if (edgeId) actions.removeDirectorIncomingEdge(node.id, edgeId);
        },
        onProjectChanged: (project) =>
          actions.update(node.id, {
            directorData: { project },
            updatedAt: new Date().toISOString(),
          }),
        onCaptures: (captures) => {
          for (const capture of captures) {
            void actions.exportDirectorAsset(node.id, capture.dataUrl, capture.fileName, "image");
          }
        },
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
            <p>{t("ui.ThreeDDirectorNode.text.a42cbf47")}</p>
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
            <iframe
              ref={detailIframeRef}
              // 详情窗口使用独立布局；embedded=canvas 会触发导演台的缩略嵌入样式。
              src={directorDeskFrameSrc(node.id, "light")}
              title={t("ui.ThreeDDirectorNode.arialabel.fad461cc")}
              className="director-detail-frame"
              onLoad={() => { sendSession(); sendPanorama(); }}
            />
          </div>
        </div>,
        surface,
      )}
      </>
    );
  },
);
