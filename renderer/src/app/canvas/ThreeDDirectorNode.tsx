import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Handle, Position } from "@xyflow/react";
import { IconSymbol } from "../components/IconSymbol";
import type { WorkflowNodeData, WorkflowNodeRenderer } from "./WorkflowCanvas";
import "./ThreeDDirectorNode.css";

type IncomingImage = { nodeId: string; name: string; url: string };
const PREVIEW_WIDTH = 1440;

function readDirectorProject(node: WorkflowNodeData) {
  const directorData = node.directorData;
  if (!directorData || typeof directorData !== "object" || Array.isArray(directorData)) return null;
  const project = (directorData as Record<string, unknown>).project;
  return project && typeof project === "object" && !Array.isArray(project) ? project : null;
}

export const ThreeDDirectorNode: WorkflowNodeRenderer = memo(({ node, selected, actions }) => {
  const [incomingImages, setIncomingImages] = useState<IncomingImage[]>([]);
  const [previewLayout, setPreviewLayout] = useState({
    scale: .375,
    width: PREVIEW_WIDTH,
    height: 880,
  });
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
    const image = incomingImages[0];
    if (!image) return;
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: "storyai:director-desk-panorama",
        payload: {
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
  }, [actions, node.id]);

  useEffect(() => {
    if (incomingImages.length === 0) return;
    sendPanorama();
  }, [incomingImages, sendPanorama]);

  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const resize = () => {
      const scale = Math.min(workspace.clientWidth / PREVIEW_WIDTH, 1);
      if (!scale) return;
      const next = {
        scale,
        width: workspace.clientWidth / scale,
        height: workspace.clientHeight / scale,
      };
      setPreviewLayout((current) =>
        Math.abs(current.scale - next.scale) < .001 &&
          Math.abs(current.width - next.width) < 1 &&
          Math.abs(current.height - next.height) < 1
          ? current
          : next
      );
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== iframeRef.current?.contentWindow) return;
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
          const fileName = typeof value.fileName === "string" && value.fileName
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
      className={`director-node${selected ? " selected" : ""}`}
      onClick={(event) => {
        event.stopPropagation();
        actions.select(node.id);
      }}
    >
      <Handle id="target-left" className="director-port director-port-in" type="target" position={Position.Left} />
      <Handle id="source-right" className="director-port director-port-out" type="source" position={Position.Right} />
      <Handle id="source-left" className="edge-routing-port" type="source" position={Position.Left} />
      <Handle id="target-right" className="edge-routing-port" type="target" position={Position.Right} />
      <header className="director-node-head">
        <label className="director-node-kind">
          <IconSymbol name="box" />
          <input
            className="nodrag"
            value={String(node.title || "3D 导演台")}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => actions.update(node.id, {
              title: event.target.value,
              updatedAt: new Date().toISOString(),
            })}
          />
        </label>
        {selected && (
          <button
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
        className="director-node-workspace nodrag nopan nowheel"
      >
        <div
          className="director-node-preview"
        >
          <iframe
            ref={iframeRef}
            src={`./director-desk.html?instanceId=${encodeURIComponent(node.id)}&theme=light&embedded=canvas`}
            title="3D 导演台"
            style={{
              width: previewLayout.width,
              height: previewLayout.height,
              transform: `scale(${previewLayout.scale})`,
            }}
            onFocus={() => actions.select(node.id)}
            onLoad={() => {
              sendSession();
              sendPanorama();
            }}
          />
        </div>
      </div>
    </div>
  );
});
