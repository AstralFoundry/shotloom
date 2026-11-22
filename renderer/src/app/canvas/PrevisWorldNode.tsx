import { memo, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getLocale, t } from "@/i18n";
import { IconSymbol } from "../components/IconSymbol";
import { showToast } from "../../store/notificationStore";
import { useAgentPetSurface } from "../agent-chat/AgentPetWorkspace";
import { useWorkbenchSurfaceRoot } from "../layout/workbenchSurface";
import {
  CanvasNodeLabelRootContext,
  type WorkflowNodeData,
  type WorkflowNodeRenderer,
} from "./WorkflowCanvas";
import {
  previsCardSrc,
  previsWorldFrameSrc,
  sendPrevisCardScene,
  subscribePrevisCardReady,
  previsWorldSummary,
  readPrevisScene,
  sendPrevisImages,
  sendPrevisScene,
  sendPrevisSession,
  subscribePrevisWorld,
  type PrevisSceneDocument,
  type PrevisWorldImageNode,
} from "../adapters/previsBridge";
import "./PrevisWorldNode.css";

type IncomingImage = { edgeId: string; nodeId: string; name: string; url: string };

/** The node's saved world-engine scene, or null before the engine has written one. */
export function readNodeScene(node: WorkflowNodeData) {
  const directorData = node.directorData;
  if (!directorData || typeof directorData !== "object" || Array.isArray(directorData)) return null;
  return readPrevisScene((directorData as Record<string, unknown>).scene);
}

function toImageNodes(images: IncomingImage[]): PrevisWorldImageNode[] {
  return images.map((image) => ({ id: image.nodeId, title: image.name, metadata: { url: image.url } }));
}

export const PrevisWorldNode: WorkflowNodeRenderer = memo(
  ({ node, selected, resizing, inputRevision, actions }) => {
    const labelRoot = useContext(CanvasNodeLabelRootContext);
    const surface = useWorkbenchSurfaceRoot();
    const [incomingImages, setIncomingImages] = useState<IncomingImage[]>([]);
    const [interacting, setInteracting] = useState(false);
    const [detailOpen, setDetailOpen] = useState(false);
    useAgentPetSurface('director', detailOpen && Boolean(surface));
    const scene = readNodeScene(node);
    const summary = previsWorldSummary(scene);
    const miniScene = scene && scene.objects.length > 0 ? scene : null;
    const miniFrameRef = useRef<HTMLIFrameElement>(null);
    const sentMiniRef = useRef<string>("");
    const detailIframeRef = useRef<HTMLIFrameElement>(null);
    const getFrame = useCallback(() => detailIframeRef.current, []);

    const sendSession = useCallback(() => {
      sendPrevisSession(detailIframeRef.current, {
        instanceId: node.id,
        scene: readNodeScene(node),
        imageNodes: toImageNodes(incomingImages),
        brandName: "Shotloom",
        locale: getLocale(),
      });
    }, [incomingImages, node]);

    const sendImages = useCallback(() => {
      sendPrevisImages(detailIframeRef.current, toImageNodes(incomingImages));
    }, [incomingImages]);

    useEffect(() => {
      let active = true;
      void actions.getDirectorIncomingImages(node.id).then((images) => {
        if (active) setIncomingImages(images);
      });
      return () => { active = false; };
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
      sendImages();
    }, [incomingImages, sendImages]);

    // Domain state is mutated in place, so depend on the serialized document, not its identity.
    const sceneJson = JSON.stringify(scene);
    useEffect(() => {
      sendPrevisScene(detailIframeRef.current, scene);
    }, [sceneJson, detailOpen]);

    // The card page posts a handshake once its listener is installed; the scene may have
    // changed between iframe load and that point, so this is the reliable sync point.
    useEffect(() => subscribePrevisCardReady(() => miniFrameRef.current, () => {
      sendPrevisCardScene(miniFrameRef.current, miniScene, getLocale());
      if (miniScene) sentMiniRef.current = `${miniScene.id}:${miniScene.updatedAt}`;
    }), [sceneJson]);

    // Keep the card's mini viewport in sync with the saved scene; the iframe is lazy and
    // only exists once the scene has at least one object.
    useEffect(() => {
      const frame = miniFrameRef.current;
      if (!frame || !miniScene) return;
      const signature = `${miniScene.id}:${miniScene.updatedAt}`;
      if (sentMiniRef.current === signature) return;
      sentMiniRef.current = signature;
      sendPrevisCardScene(frame, miniScene, getLocale());
    }, [sceneJson]);

    useEffect(() => {
      const unsubscribe = subscribePrevisWorld(getFrame, {
        onReady: () => sendSession(),
        onSceneChanged: (scene: PrevisSceneDocument) => {
          actions.update(node.id, {
            directorData: { ...((node.directorData as Record<string, unknown>) || {}), scene },
            updatedAt: new Date().toISOString(),
          });
        },
        onCaptures: async (captures) => {
          for (const capture of captures) {
            const result = await actions.exportDirectorAsset(node.id, capture.dataUrl, capture.fileName, capture.kind);
            if (!result) throw new Error("未能创建导出节点");
          }
        },
        onAddToCanvas: async (capture) => {
          const result = await actions.exportDirectorAsset(node.id, capture.dataUrl, capture.fileName, capture.kind);
          if (!result) throw new Error("未能创建导出节点");
          if (capture.renderMode === "beauty" || capture.renderMode === "clay") {
            actions.createDirectorVideo(result.nodeId, capture.fileName, capture.prompt || "");
          }
        },
        onAddPrompt: (title, prompt) => actions.exportDirectorPrompt(node.id, title, prompt),
        onFlush: () => actions.flushDirectorScene(node.id),
        onClose: () => {
          setInteracting(false);
          setDetailOpen(false);
        },
        onError: (error) => showToast(error, "error"),
      });
      return unsubscribe;
    }, [actions, getFrame, node, sendSession]);

    return (
      <>
        {labelRoot && createPortal(
          <div className="previs-node-label">
            <span className="previs-node-drag-handle" title={t("ui.previsWorld.dragTitle")} aria-hidden="true" />
            <IconSymbol name="box" aria-hidden="true" />
            <input
              className="nodrag"
              aria-label={t("ui.previsWorld.titleLabel")}
              value={String(node.title || t("ui.previsWorld.defaultTitle"))}
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
                title={t("ui.previsWorld.delete")}
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
          className={`previs-node${selected ? " selected" : ""}${resizing ? " resizing" : ""}${interacting ? " interacting" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            actions.select(node.id);
          }}
        >
          <div
            className={`previs-node-workspace nopan nowheel${interacting ? " nodrag" : ""}`}
            onDoubleClick={(event) => {
              if (interacting) return;
              event.stopPropagation();
              actions.select(node.id);
              setInteracting(true);
              setDetailOpen(true);
            }}
          >
            <div className="previs-card">
              <header className="previs-card-header">
                <span className="previs-card-kicker">
                  <span className="previs-card-mark"><IconSymbol name="film" aria-hidden="true" /></span>
                  <span>PREVIS / 3D</span>
                </span>
                <span className="previs-card-status"><i className="previs-card-dot" aria-hidden="true" />{t("ui.previsWorld.cardStatus")}</span>
              </header>
              <div className="previs-card-title-row">
                <div className="previs-card-title-block">
                  <h3 className="previs-card-title" title={String(node.title || "")}>{String(node.title || t("ui.previsWorld.defaultTitle"))}</h3>
                  <p className="previs-card-shot" title={summary?.shotName || t("ui.previsWorld.noShot")}>{summary?.shotName || t("ui.previsWorld.noShot")}</p>
                </div>
                <span className="previs-card-duration"><IconSymbol name="clock" aria-hidden="true" />{summary?.shotDuration ?? 0}s</span>
              </div>
              <div className="previs-card-preview-shell">
                <button
                  type="button"
                  className="previs-card-preview nodrag"
                  title={t("ui.previsWorld.open")}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    actions.select(node.id);
                    setInteracting(true);
                    setDetailOpen(true);
                  }}
                >
                  {miniScene ? null : (
                    <span className="previs-card-empty">
                      <span className="previs-card-empty-mark"><IconSymbol name="film" aria-hidden="true" /></span>
                      <strong>{t("ui.previsWorld.emptyTitle")}</strong>
                      <span>{t("ui.previsWorld.emptyHint")}</span>
                    </span>
                  )}
                </button>
                {miniScene ? (
                  <iframe
                    ref={miniFrameRef}
                    className="previs-card-mini"
                    title={t("ui.previsWorld.previewLabel")}
                    src={previsCardSrc(node.id, getLocale())}
                    onLoad={() => {
                      const frame = miniFrameRef.current;
                      if (frame) sendPrevisCardScene(frame, miniScene, getLocale());
                      sentMiniRef.current = `${miniScene.id}:${miniScene.updatedAt}`;
                    }}
                  />
                ) : null}
                <span className="previs-card-cta"><IconSymbol name="film" aria-hidden="true" />{t("ui.previsWorld.open")}</span>
              </div>
              <footer className="previs-card-footer">
                <span className="previs-card-stat" title={`${summary?.objects ?? 0} ${t("ui.previsWorld.objectCount")}`}><IconSymbol name="box" aria-hidden="true" /><b>{summary?.objects ?? 0}</b><span>{t("ui.previsWorld.objectCount")}</span></span>
                <span className="previs-card-stat" title={`${summary?.cameras ?? 0} ${t("ui.previsWorld.cameraCount")}`}><IconSymbol name="camera" aria-hidden="true" /><b>{summary?.cameras ?? 0}</b><span>{t("ui.previsWorld.cameraCount")}</span></span>
                <span className="previs-card-stat" title={`${summary?.lights ?? 0} ${t("ui.previsWorld.lightCount")}`}><IconSymbol name="sun" aria-hidden="true" /><b>{summary?.lights ?? 0}</b><span>{t("ui.previsWorld.lightCount")}</span></span>
                <span className="previs-card-footer-action"><IconSymbol name="cursor" aria-hidden="true" />{t("ui.previsWorld.doubleClick")}</span>
              </footer>
            </div>
          </div>
        </div>
        {detailOpen && surface && createPortal(
          <div className="previs-detail-backdrop" role="dialog" aria-label={t("ui.previsWorld.detailLabel")}>
            <div className="previs-detail-window">
              <iframe
                ref={detailIframeRef}
                src={previsWorldFrameSrc(node.id, "light")}
                title={t("ui.previsWorld.detailLabel")}
                className="previs-detail-frame"
                onLoad={() => sendSession()}
              />
            </div>
          </div>,
          surface,
        )}
      </>
    );
  },
);
