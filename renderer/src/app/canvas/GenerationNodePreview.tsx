import { t } from '@/i18n';
import { useContext, useRef, useState } from "react";
import { reconcileMediaNodeDimensions } from "../../domain/graph/CanvasNodeDimensions";
import { desktopApi } from "../../services/desktopApi.ts";
import { showToast } from "../../store/notificationStore";
import { store } from "../../store/projectStore.ts";
import { copyTextNodeVersion, renameTextNodeVersion } from "../adapters/canvasAdapter";
import { openMediaViewer } from "../store/overlayStore";
import { IconSymbol } from "../components/IconSymbol";
import { GenerationNodeImageOverlays } from "./GenerationNodeImageOverlays";
import { formatMediaTime, GenerationAudioPreview } from "./GenerationAudioPreview";
import { CanvasPreviewZoomContext, type WorkflowNodeActions, type WorkflowNodeData } from "./WorkflowCanvas";
import { useGenerationLocalPreview } from "./generationNodeMedia";
import type { GenerationNodeState } from "./generationNodeState";

/**
 * 空文本节点的快捷入口只写入提示词，不触发运行，
 * 让用户在输入面板里先补充主题再自行发送。
 */
const TEXT_NODE_STARTERS = [
  {
    key: "script",
    labelKey: "ui.GenerationNodePreview.label.06b88dcf",
    icon: "film",
    promptKey: "canvas.textStarter.script",
  },
  {
    key: "proposal",
    labelKey: "ui.GenerationNodePreview.label.f143ab23",
    icon: "file",
    promptKey: "canvas.textStarter.proposal",
  },
  {
    key: "prompt",
    labelKey: "ui.GenerationNodePreview.label.48443cee",
    icon: "spark",
    promptKey: "canvas.textStarter.prompt",
  },
] as const;

export function GenerationNodePreview({
  node,
  selected,
  state,
  actions,
  imageCropMode,
  onImageCropClose,
  imageAnnotationOpen,
  onImageAnnotationClose,
  imageWatermarkOpen,
  onImageWatermarkClose,
  imageAngleOpen,
  onImageAngleClose,
  imageLightingOpen,
  onImageLightingClose,
  semanticZoom,
  onStarter,
}: {
  node: WorkflowNodeData;
  selected: boolean;
  state: GenerationNodeState;
  actions: WorkflowNodeActions;
  imageCropMode: "crop" | "grid" | null;
  onImageCropClose: (() => void) | undefined;
  imageAnnotationOpen: boolean;
  onImageAnnotationClose: (() => void) | undefined;
  imageWatermarkOpen: boolean;
  onImageWatermarkClose: (() => void) | undefined;
  imageAngleOpen: boolean;
  onImageAngleClose: (() => void) | undefined;
  imageLightingOpen: boolean;
  onImageLightingClose: (() => void) | undefined;
  semanticZoom: number;
  onStarter: (prompt: string) => void;
}) {
  const {
    activeFilePath, activeFileName, activeKind, kind, metaIcon, metaLabel,
    outputs, previewItem, selectedOutput, textContent, textPreview, uploaded, uploadedResource,
  } = state;
  const videoPreviewRef = useRef<HTMLVideoElement>(null);
  const [videoTime, setVideoTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoMuted, setVideoMuted] = useState(false);
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 });
  const annotationAnchorRef = useRef<HTMLDivElement>(null);
  const previewZoom = useContext(CanvasPreviewZoomContext);
  const {
    url: previewUrl,
    retryBuffered: retryBufferedPreview,
    buffered: bufferedPreview,
  } = useGenerationLocalPreview(previewItem, activeKind, previewZoom);

  function openDetail(withTextAgent: boolean) {
    if (activeKind === "image" || activeKind === "video") {
      if (previewUrl) {
        openMediaViewer({
          src: previewUrl,
          kind: activeKind,
          title: selectedOutput?.title || String(node.title || metaLabel),
          filePath: String(selectedOutput?.filePath || uploaded?.filePath || uploaded?.path || ""),
          ...(activeKind === "video" ? { onCaptureFrame: (seconds: number) => actions.captureVideoFrame(node.id, seconds) } : {}),
        });
      }
    } else if (kind === "text") {
      openMediaViewer({
        src: textContent,
        kind: "text",
        title: String(node.title || t("ui.CanvasNodeToolbar.text.d3321cbb")),
        filePath: String(selectedOutput?.filePath || ""),
        onSave: (content) => {
          actions.update(node.id, {
            textContent: content,
            generatedOutputs: selectedOutput
              ? outputs.map((output) =>
                  output.id === selectedOutput.id ? { ...output, content } : output,
                )
              : outputs,
            updatedAt: new Date().toISOString(),
          });
        },
        getTextVersions: () => ((store.project.nodes.find((item: WorkflowNodeData) => item.id === node.id) as WorkflowNodeData | undefined)?.textVersions || []) as Array<{ id: string; content: string; createdAt: string; name?: string }>,
        onRenameVersion: (id, name) => renameTextNodeVersion(node.id, id, name),
        onCopyVersion: (id) => copyTextNodeVersion(node.id, id),
        textAgentNodeId: withTextAgent ? node.id : "",
      });
    }
  }
  async function saveActiveMedia() {
    if (!activeFilePath) return showToast(t("ui.GenerationNodePreview.text.72a68cc7"));
    try {
      const buffer = await desktopApi.file.readArrayBuffer(activeFilePath);
      const result = await desktopApi.file.saveArrayBuffer(activeFileName, buffer);
      if (result) showToast(t("ui.GenerationNodePreview.text.4816d758"));
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : t("ui.GenerationNodePreview.text.a02b8ed5"));
    }
  }

  // Keep the media branch explicit: activeKind === 'image' && previewUrl ? <img /> : activeKind === 'video'.
  return (
    <div className="work-visual-block">
      <div className={`work-node work-node-${kind}${selected ? " selected" : ""}`}>
        <div
          ref={annotationAnchorRef}
          className={`work-preview ${
            node.type === "videoGeneration" ? "wide" : "square"
          } ${kind}`}
          title={kind === "text" ? t("ui.GenerationNodePreview.text.cffe591f") : previewUrl ? t("ui.GenerationNodePreview.text.2d640c70") : ""}
          onDoubleClick={imageCropMode ? undefined : () => openDetail(false)}
          onPointerEnter={() => {
            if (activeKind !== "video" || !previewUrl) return;
            const video = videoPreviewRef.current;
            if (!video) return;
            video.muted = videoMuted;
            video.volume = 1;
            void video.play().catch(() => undefined);
          }}
          onPointerLeave={(event) => {
            if (activeKind !== "video" || !previewUrl || event.buttons) return;
            videoPreviewRef.current?.pause();
          }}
        >
          {kind === "text" ? (
            textContent ? (
              <div className="text-result-scroll">
                <p>{textPreview}</p>
              </div>
            ) : (
              <div className="text-result-empty">
                <IconSymbol className="text-result-sheet" name="sheet" />
                <div className="text-result-starters nodrag nopan">
                  <span>{t("ui.GenerationNodePreview.text.a83a3995")}</span>
                  <button
                    type="button"
                    className="text-result-starter"
                    onClick={(event) => {
                      event.stopPropagation();
                      // 只有"自己编写内容"这条路径带文本 Agent；双击和工具栏入口保持纯编辑器。
                      openDetail(true);
                    }}
                  >
                    <IconSymbol name="pencil" />
                    {t("ui.GenerationNodePreview.text.9a83bc76")}</button>
                  {/* 生成型 starter 会把提示词写进下方输入面板；纯上传资源节点没有那个面板。 */}
                  {!uploadedResource && TEXT_NODE_STARTERS.map((starter) => (
                    <button
                      key={starter.key}
                      type="button"
                      className="text-result-starter"
                      onClick={(event) => {
                        event.stopPropagation();
                        onStarter(t(starter.promptKey));
                      }}
                    >
                      <IconSymbol name={starter.icon} />
                      {t(starter.labelKey)}
                    </button>
                  ))}
                </div>
              </div>
            )
          ) : activeKind === "image" && previewUrl ? (
            <img
              src={previewUrl}
              alt={String(node.title || metaLabel)}
              onLoad={(event) => {
                const image = event.currentTarget;
                setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
                const dimensions = reconcileMediaNodeDimensions(
                  node,
                  image.naturalWidth,
                  image.naturalHeight,
                );
                if (dimensions) {
                  actions.update(node.id, {
                    canvasWidth: dimensions.width,
                    canvasHeight: dimensions.height,
                  });
                }
              }}
            />
          ) : activeKind === "video" && previewUrl ? (
            <video
              ref={videoPreviewRef}
              className="nowheel"
              src={previewUrl}
              draggable={false}
              muted={videoMuted}
              loop
              playsInline
              preload="auto"
              onLoadedMetadata={(event) => {
                const video = event.currentTarget;
                setVideoDuration(Number(video.duration) || 0);
                const dimensions = reconcileMediaNodeDimensions(
                  node,
                  video.videoWidth,
                  video.videoHeight,
                );
                if (dimensions) {
                  actions.update(node.id, {
                    canvasWidth: dimensions.width,
                    canvasHeight: dimensions.height,
                  });
                }
              }}
              onLoadedData={(event) => {
                const video = event.currentTarget;
                if (video.paused && video.currentTime === 0 && video.duration > 0) {
                  video.currentTime = Math.min(1 / 30, Math.max(0, video.duration - 0.04));
                }
              }}
              onDurationChange={(event) => setVideoDuration(Number(event.currentTarget.duration) || 0)}
              onTimeUpdate={(event) => setVideoTime(event.currentTarget.currentTime)}
              onPlay={() => setVideoPlaying(true)}
              onPause={() => setVideoPlaying(false)}
              onError={() => {
                if (!bufferedPreview) retryBufferedPreview();
              }}
            />
          ) : activeKind === "audio" && previewUrl ? (
            <GenerationAudioPreview
              src={previewUrl}
              filePath={String(selectedOutput?.filePath || uploaded?.filePath || uploaded?.path || "")}
              fileName={String(selectedOutput?.fileName || uploaded?.name || node.title || "audio.m4a")}
              onError={() => {
                if (!bufferedPreview) retryBufferedPreview();
              }}
            />
          ) : (
            <div className="work-empty-state">
              <IconSymbol className="work-empty-type-icon" name={metaIcon} />
            </div>
          )}
          <GenerationNodeImageOverlays
            node={node}
            actions={actions}
            activeKind={activeKind}
            activeFilePath={activeFilePath}
            previewUrl={previewUrl}
            imageWidth={imageSize.width}
            imageHeight={imageSize.height}
            semanticZoom={semanticZoom}
            anchorRef={annotationAnchorRef}
            imageCropMode={imageCropMode}
            onImageCropClose={onImageCropClose}
            imageAnnotationOpen={imageAnnotationOpen}
            onImageAnnotationClose={onImageAnnotationClose}
            imageWatermarkOpen={imageWatermarkOpen}
            onImageWatermarkClose={onImageWatermarkClose}
            imageAngleOpen={imageAngleOpen}
            onImageAngleClose={onImageAngleClose}
            imageLightingOpen={imageLightingOpen}
            onImageLightingClose={onImageLightingClose}
          />
          {activeKind === "video" && previewUrl && (
            <div className="work-video-status">
              <span>{formatMediaTime(videoTime)} / {formatMediaTime(videoDuration)}</span>
            </div>
          )}
          {activeKind === "video" && previewUrl && (
            <div
              className="work-video-controls nodrag nopan"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className="work-video-control-button"
                title={videoPlaying ? t("ui.GenerationAudioPreview.text.130448bc") : t("ui.GenerationAudioPreview.text.21925350")}
                aria-label={videoPlaying ? t("ui.GenerationNodePreview.text.a8505ca8") : t("ui.GenerationNodePreview.text.af7d6e03")}
                onClick={(event) => {
                  event.stopPropagation();
                  const video = videoPreviewRef.current;
                  if (!video) return;
                  if (video.paused) void video.play().catch(() => undefined);
                  else video.pause();
                }}
              >
                <IconSymbol name={videoPlaying ? "pause" : "play"} />
              </button>
              <span className="work-video-controls-time">
                {formatMediaTime(videoTime)} / {formatMediaTime(videoDuration)}
              </span>
              <div className="work-video-controls-spacer" />
              <button
                type="button"
                className="work-video-control-button"
                title={videoMuted ? t("ui.GenerationNodePreview.text.27eabe57") : t("ui.GenerationNodePreview.text.cfb8c7ff")}
                aria-pressed={!videoMuted}
                onClick={(event) => {
                  event.stopPropagation();
                  const nextMuted = !videoMuted;
                  setVideoMuted(nextMuted);
                  if (videoPreviewRef.current) videoPreviewRef.current.muted = nextMuted;
                }}
              >
                <IconSymbol name={videoMuted ? "volume-x" : "volume"} />
              </button>
              <button
                type="button"
                className="work-video-control-button"
                title={t("ui.GenerationNodePreview.title.50f84bc4")}
                aria-label={t("ui.GenerationNodePreview.title.50f84bc4")}
                onClick={(event) => {
                  event.stopPropagation();
                  const video = videoPreviewRef.current;
                  if (video?.requestFullscreen) void video.requestFullscreen().catch(() => undefined);
                }}
              >
                <IconSymbol name="maximize" />
              </button>
              <button
                type="button"
                className="work-video-progress"
                aria-label={t("ui.GenerationNodePreview.arialabel.a4ba074b")}
                onClick={(event) => {
                  event.stopPropagation();
                  const video = videoPreviewRef.current;
                  if (!video || !(videoDuration > 0)) return;
                  const bounds = event.currentTarget.getBoundingClientRect();
                  video.currentTime = Math.max(0, Math.min(videoDuration, (event.clientX - bounds.left) / bounds.width * videoDuration));
                  setVideoTime(video.currentTime);
                }}
              >
                <span style={{ width: `${videoDuration > 0 ? Math.min(100, videoTime / videoDuration * 100) : 0}%` }} />
              </button>
            </div>
          )}
          {!imageCropMode && (activeKind === "image" || activeKind === "video") && previewUrl && (
            <button
              type="button"
              className="work-preview-download nodrag nopan"
              title={t("ui.GenerationNodePreview.title.b7ca89a9")}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                void saveActiveMedia();
              }}
            >
              <IconSymbol name="download" />
            </button>
          )}
          {!imageCropMode && outputs.length > 1 && (
            <div className="generation-output-dots">
              {outputs.map((output) => (
                <button
                  key={output.id}
                  className={output === selectedOutput ? "active" : ""}
                  title={output.title}
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.selectOutput(node.id, output.id);
                  }}
                />
              ))}
            </div>
          )}
        </div>
        {node.status === "running" && (
          <div className="work-progress">
            <span style={{ width: `${Number(node.progress) || 0}%` }} />
          </div>
        )}
        {Boolean(node.error) && (
          <div className="work-error" title={String(node.error)}>{String(node.error)}</div>
        )}
      </div>
    </div>
  );
}
