import { memo, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconSymbol } from "../components/IconSymbol";
import { useWorkbenchSurfaceRoot } from "../layout/workbenchSurface";
import {
  CanvasNodeLabelRootContext,
  type WorkflowNodeData,
  type WorkflowNodeRenderer,
} from "./WorkflowCanvas";
import "./ThreeDDirectorNode.css";

type IncomingImage = { edgeId: string; nodeId: string; name: string; url: string };
function readDirectorProject(node: WorkflowNodeData) {
  const directorData = node.directorData;
  if (!directorData || typeof directorData !== "object" || Array.isArray(directorData)) return null;
  const project = (directorData as Record<string, unknown>).project;
  return project && typeof project === "object" && !Array.isArray(project) ? project : null;
}

export const ThreeDDirectorNode: WorkflowNodeRenderer = memo(
  ({ node, selected, resizing, inputRevision, actions, semanticZoom = 1 }) => {
    const labelRoot = useContext(CanvasNodeLabelRootContext);
    const surface = useWorkbenchSurfaceRoot();
    const [incomingImages, setIncomingImages] = useState<IncomingImage[]>([]);
    const [interacting, setInteracting] = useState(false);
    const [detailOpen, setDetailOpen] = useState(false);
    const detailIframeRef = useRef<HTMLIFrameElement>(null);

    const postToDirectorFrames = useCallback((message: unknown) => {
      detailIframeRef.current?.contentWindow?.postMessage(message, window.location.origin);
    }, []);

    const sendSession = useCallback(() => {
      postToDirectorFrames({
        type: "storyai:director-desk-session",
        payload: {
          instanceId: node.id,
          theme: "light",
          project: readDirectorProject(node),
        },
      });
    }, [node, postToDirectorFrames]);

    const sendPanorama = useCallback(() => {
      const image = incomingImages.at(-1);
      if (!image) {
        postToDirectorFrames({ type: "storyai:director-desk-panorama-clear" });
        return;
      }
      postToDirectorFrames({
        type: "storyai:director-desk-panorama",
        payload: {
          edgeId: image.edgeId,
          sourceNodeId: image.nodeId,
          imageUrl: image.url,
          fileName: image.name,
        },
      });
    }, [incomingImages, postToDirectorFrames]);

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
      const handleMessage = (event: MessageEvent) => {
        if (
          event.origin !== window.location.origin ||
          event.source !== detailIframeRef.current?.contentWindow
        )
          return;
        const message = event.data as { type?: string; payload?: Record<string, unknown> };
        if (message.type === "storyai:director-desk-ready") {
          sendSession();
          sendPanorama();
          return;
        }
        if (message.type === "storyai:director-desk-interaction") {
          actions.select(node.id);
          return;
        }
        if (message.type === "storyai:director-desk-exit-interaction") {
          setInteracting(false);
          setDetailOpen(false);
          return;
        }
        // 详情窗口没有自己的标题栏，导演台顶栏的 × 是唯一的关闭入口。
        if (message.type === "storyai:director-desk-close") {
          setInteracting(false);
          setDetailOpen(false);
          return;
        }
        if (message.type === "storyai:director-desk-delete-node") {
          actions.delete(node.id);
          return;
        }
        if (message.type === "storyai:director-desk-panorama-removed") {
          const edgeId = String(message.payload?.edgeId || "");
          if (edgeId) actions.removeDirectorIncomingEdge(node.id, edgeId);
          return;
        }
        if (message.type === "storyai:director-desk-project-changed") {
          const project = message.payload?.project;
          if (project && typeof project === "object" && !Array.isArray(project)) {
            actions.update(node.id, {
              directorData: { project },
              updatedAt: new Date().toISOString(),
            });
          }
          return;
        }
        if (message.type === "storyai:director-desk-captures-sent") {
          const captures = Array.isArray(message.payload?.captures) ? message.payload.captures : [];
          captures.forEach((capture, index) => {
            if (!capture || typeof capture !== "object") return;
            const value = capture as { dataUrl?: unknown; fileName?: unknown };
            if (typeof value.dataUrl !== "string" || !value.dataUrl) return;
            const fileName =
              typeof value.fileName === "string" && value.fileName
                ? value.fileName
                : `director-desk-capture-${index + 1}.png`;
            void actions.exportDirectorAsset(node.id, value.dataUrl, fileName, "image");
          });
        }
      };
      window.addEventListener("message", handleMessage);
      return () => window.removeEventListener("message", handleMessage);
    }, [actions, node.id, sendPanorama, sendSession]);

    return (
      <>
      {labelRoot && createPortal(
        <div className="director-node-label">
          <span className="director-node-drag-handle" title="拖动 3D 导演台" aria-hidden="true" />
          <IconSymbol name="box" aria-hidden="true" />
          <input
            className="nodrag"
            aria-label="3D 导演台标题"
            value={String(node.title || "3D 导演台")}
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
              title="删除 3D 导演台"
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
            <strong>导演台</strong>
            <p>在 3D 空间中搭建场景并进行多视角截图。</p>
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
              打开导演台
            </button>
          </div>
        </div>
      </div>
      {detailOpen && surface && createPortal(
        <div className="director-detail-backdrop" role="dialog" aria-label="3D 导演台详情">
          <div className="director-detail-window">
            <iframe
              ref={detailIframeRef}
              // 详情窗口使用独立布局；embedded=canvas 会触发导演台的缩略嵌入样式。
              src={`./director-desk.html?instanceId=${encodeURIComponent(node.id)}&theme=light`}
              title="3D 导演台详情"
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
