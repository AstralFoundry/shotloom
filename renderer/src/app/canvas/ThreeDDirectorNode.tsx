import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconSymbol } from "../components/IconSymbol";
import type { WorkflowNodeData, WorkflowNodeRenderer } from "./WorkflowCanvas";
import "./ThreeDDirectorNode.css";

type IncomingImage = { edgeId: string; nodeId: string; name: string; url: string };
const PREVIEW_WIDTH = 1440;
const PREVIEW_HEIGHT = 880;

function readDirectorProject(node: WorkflowNodeData) {
  const directorData = node.directorData;
  if (!directorData || typeof directorData !== "object" || Array.isArray(directorData)) return null;
  const project = (directorData as Record<string, unknown>).project;
  return project && typeof project === "object" && !Array.isArray(project) ? project : null;
}

export const ThreeDDirectorNode: WorkflowNodeRenderer = memo(
  ({ node, selected, resizing, inputRevision, actions }) => {
    const [incomingImages, setIncomingImages] = useState<IncomingImage[]>([]);
    const [interacting, setInteracting] = useState(false);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const workspaceRef = useRef<HTMLDivElement>(null);

    const sendSession = useCallback(() => {
      iframeRef.current?.contentWindow?.postMessage(
        {
          type: "storyai:director-desk-session",
          payload: {
            instanceId: node.id,
            theme: "light",
            project: readDirectorProject(node),
          },
        },
        window.location.origin,
      );
    }, [node]);

    const sendPanorama = useCallback(() => {
      const image = incomingImages.at(-1);
      if (!image) {
        iframeRef.current?.contentWindow?.postMessage(
          { type: "storyai:director-desk-panorama-clear" },
          window.location.origin,
        );
        return;
      }
      iframeRef.current?.contentWindow?.postMessage(
        {
          type: "storyai:director-desk-panorama",
          payload: {
            edgeId: image.edgeId,
            sourceNodeId: image.nodeId,
            imageUrl: image.url,
            fileName: image.name,
          },
        },
        window.location.origin,
      );
    }, [incomingImages]);

    useEffect(() => {
      void actions.getDirectorIncomingImages(node.id).then(setIncomingImages);
    }, [actions, inputRevision, node.id]);

    useEffect(() => {
      if (!selected) setInteracting(false);
    }, [selected]);

    useEffect(() => {
      if (!interacting) return;
      const handleEscape = (event: KeyboardEvent) => {
        if (event.key === "Escape") setInteracting(false);
      };
      window.addEventListener("keydown", handleEscape);
      return () => window.removeEventListener("keydown", handleEscape);
    }, [interacting]);

    useEffect(() => {
      sendPanorama();
    }, [incomingImages, sendPanorama]);

    useLayoutEffect(() => {
      const workspace = workspaceRef.current;
      if (!workspace) return;
      let animationFrame = 0;
      const resize = () => {
        cancelAnimationFrame(animationFrame);
        animationFrame = requestAnimationFrame(() => {
          const iframe = iframeRef.current;
          if (!iframe) return;
          const scale = Math.min(
            workspace.clientWidth / PREVIEW_WIDTH,
            workspace.clientHeight / PREVIEW_HEIGHT,
          );
          if (scale > 0) iframe.style.transform = `scale(${scale})`;
        });
      };
      resize();
      const observer = new ResizeObserver(resize);
      observer.observe(workspace);
      return () => {
        cancelAnimationFrame(animationFrame);
        observer.disconnect();
      };
    }, []);

    useEffect(() => {
      const handleMessage = (event: MessageEvent) => {
        if (
          event.origin !== window.location.origin ||
          event.source !== iframeRef.current?.contentWindow
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
      <div
        className={`director-node${selected ? " selected" : ""}${resizing ? " resizing" : ""}${interacting ? " interacting" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          actions.select(node.id);
        }}
      >
        <header className="director-node-head">
          <span className="director-node-drag-handle" title="拖动 3D 导演台" aria-hidden="true" />
          <label className="director-node-kind">
            <IconSymbol name="box" />
            <input
              className="nodrag"
              value={String(node.title || "3D 导演台")}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) =>
                actions.update(node.id, {
                  title: event.target.value,
                  updatedAt: new Date().toISOString(),
                })
              }
            />
          </label>
          {interacting && (
            <button
              type="button"
              className="director-node-done-button nodrag"
              title="退出 3D 场景操作"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                setInteracting(false);
              }}
            >
              完成
            </button>
          )}
          {selected && (
            <button
              className="nodrag"
              title="删除"
              onClick={(event) => {
                event.stopPropagation();
                actions.delete(node.id);
              }}
            >
              <IconSymbol name="trash" />
            </button>
          )}
        </header>
        <div
          ref={workspaceRef}
          className={`director-node-workspace nopan nowheel${interacting ? " nodrag" : ""}`}
          onDoubleClick={(event) => {
            if (interacting) return;
            event.stopPropagation();
            actions.select(node.id);
            setInteracting(true);
          }}
        >
          <div className="director-node-preview">
            <iframe
              ref={iframeRef}
              src={`./director-desk.html?instanceId=${encodeURIComponent(node.id)}&theme=light&embedded=canvas`}
              title="3D 导演台"
              style={{
                width: PREVIEW_WIDTH,
                height: PREVIEW_HEIGHT,
              }}
              onFocus={() => actions.select(node.id)}
              onLoad={() => {
                sendSession();
                sendPanorama();
              }}
            />
          </div>
          {!interacting && <span className="director-node-entry-hint">双击操作 3D 场景</span>}
        </div>
      </div>
    );
  },
);
