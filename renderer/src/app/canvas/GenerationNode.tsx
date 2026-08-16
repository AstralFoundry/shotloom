import { memo, type ReactNode, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type ReactFlowState, useStore } from "@xyflow/react";
import { getGenerationInputModes, getModelInfo, getModelSchema, getTypeMeta, resolveModeIdForInputMode } from "../../domain/catalog/ModelCatalog";
import { CanvasNodeLabelRootContext, CanvasOverlayRootContext } from "./WorkflowCanvas";
import {
  aspectRatioStyle,
  isAspectRatioParam,
  modelDescription,
  optionLabel,
  optionValue,
  paramPresentation,
  paramOptionHint,
  paramVisualClass,
  paramVisualText,
} from "../../utils/modelPresentation.js";
import { resolveProviderIconId } from "../../domain/provider/ProviderBrandIcons.js";
import { getProviderDefinition } from "../../domain/provider/ProviderRegistry";
import { settingsStore } from "../../store/settingsStore.js";
import { getImageStylePreset, IMAGE_STYLE_PRESETS } from "../../utils/imageStylePresets.mjs";
import { IconSymbol } from "../components/IconSymbol";
import { ProviderBrandIcon } from "../components/ProviderBrandIcon";
import { CameraControlPanel } from "./CameraControlPanel";
import { DEFAULT_CAMERA_CONFIG, normalizeCameraConfig } from "../../utils/cameraConfig.js";
import { openMediaViewer, showToast } from "../store/overlayStore";
import type {
  WorkflowIncomingInput,
  WorkflowNodeData,
  WorkflowNodeRenderer,
} from "./WorkflowCanvas";
import { useMediaPreviewCache } from "./useMediaPreviewCache";
import { isImeKeyEvent, useImeCommit } from "./imeComposition";
import { reconcileMediaNodeDimensions } from "../../domain/graph/CanvasNodeDimensions";
import { textNodeContent } from "../../utils/textNodeContent.mjs";
import { desktopApi } from "../../services/desktopApi.js";
import { compileGenerationNodeConfig } from "../../domain/graph/GenerationNodeContract";

interface OutputData {
  id: string;
  title?: string;
  selected?: boolean;
  resourceType?: string;
  mimeType?: string;
  fileName?: string;
  filePath?: string;
  previewUrl?: string;
  url?: string;
  content?: string;
}
const generationTypes = new Set([
  "imageGeneration",
  "videoGeneration",
  "audioGeneration",
  "textGeneration",
]);
const MAX_TEXT_PREVIEW_CHARS = 6000;
const extKinds = {
  image: ["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp", "svg"],
  video: ["mp4", "mov", "webm", "m4v"],
  audio: ["mp3", "wav", "m4a", "aac", "ogg", "flac"],
  text: ["txt", "md", "json", "csv", "log"],
} as const;
function kindOf(item: Record<string, unknown>): "image" | "video" | "audio" | "text" | "" {
  const type = String(item.resourceType || item.mimeType || "").toLowerCase();
  const ext =
    String(item.fileName || item.filePath || item.url || item.previewUrl || "")
      .split(/[?#]/)[0]
      .split(".")
      .pop()
      ?.toLowerCase() || "";
  return (
    (Object.keys(extKinds) as Array<keyof typeof extKinds>).find(
      (kind) => type.includes(kind) || extKinds[kind].includes(ext as never),
    ) || (item.content ? "text" : "")
  );
}
function canvasPreviewMaxSize(semanticZoom: number) {
  const dpr = Number(globalThis.devicePixelRatio) || 1;
  const needed = 350 * Math.max(1, semanticZoom) * dpr;
  if (needed > 1536) return 2048;
  if (needed > 960) return 1536;
  return 960;
}
function useLocalPreview(item: Record<string, unknown> | null, kind: string, previewZoom: number) {
  const path = String(item?.filePath || item?.path || "");
  const raw = String(item?.previewUrl || item?.url || item?.content || "");
  return useMediaPreviewCache({
    path,
    kind,
    mimeType: String(item?.mimeType || item?.type || ""),
    maxSize: kind === "image" ? canvasPreviewMaxSize(previewZoom) : undefined,
    revision: String(item?.updatedAt || item?.createdAt || item?.id || ""),
    fallbackUrl: raw,
  });
}

const AUDIO_WAVEFORM_BARS = [
  20, 38, 64, 42, 76, 48, 30, 58, 82, 46, 68, 34, 72, 52, 88, 40,
  62, 28, 54, 78, 44, 70, 36, 84, 50, 66, 32, 74, 46, 90, 56, 38,
  68, 42, 80, 34, 60, 48, 86, 54, 30, 72, 44, 64, 38, 78, 52, 28,
  70, 46, 82, 36, 58, 74, 42, 66, 32, 76, 48, 62, 40, 84, 54, 30,
];

function formatAudioTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const seconds = Math.floor(value);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function AudioWaveformPlayer({
  src,
  filePath,
  fileName,
  onError,
}: {
  src: string;
  filePath: string;
  fileName: string;
  onError: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const progress = duration > 0 ? currentTime / duration : 0;

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      await audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  }

  async function saveAudio() {
    if (!filePath) return showToast("当前音频没有可导出的本地文件");
    try {
      const buffer = await desktopApi.file.readArrayBuffer(filePath);
      const result = await desktopApi.file.saveArrayBuffer(fileName || "audio.m4a", buffer);
      if (result) showToast("音频已另存");
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "音频另存失败");
    }
  }

  return (
    <div className="audio-waveform-player nowheel">
      <button
        type="button"
        className="audio-waveform"
        aria-label="调整音频播放位置"
        onClick={(event) => {
          const audio = audioRef.current;
          if (!audio || !(duration > 0)) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          audio.currentTime = Math.max(0, Math.min(duration, (event.clientX - bounds.left) / bounds.width * duration));
          setCurrentTime(audio.currentTime);
        }}
      >
        {AUDIO_WAVEFORM_BARS.map((height, index) => (
          <span
            key={index}
            className={index / AUDIO_WAVEFORM_BARS.length <= progress ? "played" : ""}
            style={{ height: `${height}%` }}
          />
        ))}
      </button>
      <div className="audio-waveform-controls">
        <span>{formatAudioTime(currentTime)} / {formatAudioTime(duration)}</span>
        <button type="button" className="audio-waveform-play nodrag nopan" title={playing ? "暂停" : "播放"} onClick={() => void togglePlayback()}>
          {playing ? <IconSymbol name="pause" /> : <i className="audio-play-glyph" aria-hidden />}
        </button>
        <button type="button" className="audio-waveform-download nodrag nopan" title="另存音频" onClick={() => void saveAudio()}>
          <IconSymbol name="download" />
        </button>
      </div>
      <audio
        ref={audioRef}
        className="nodrag nopan nowheel audio-waveform-native"
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(Number(event.currentTarget.duration) || 0)}
        onDurationChange={(event) => setDuration(Number(event.currentTarget.duration) || 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={onError}
      />
    </div>
  );
}

function generationNodeDisplayTitle(
  node: WorkflowNodeData,
  output: OutputData | null,
  uploaded: Record<string, unknown> | null,
  typeLabel: string,
) {
  const genericNames = new Set([
    typeLabel.toLowerCase(),
    String(node.type || "").toLowerCase(),
  ]);
  const candidates = [output?.fileName, output?.title, uploaded?.name, node.title];
  for (const candidate of candidates) {
    const title = String(candidate || "").trim();
    if (!title) continue;
    const stem = title.replace(/\.[a-z0-9]{1,10}$/i, "").trim().toLowerCase();
    if (!genericNames.has(stem)) return title;
  }
  return typeLabel.replace(/生成$/, "") || "节点";
}

function ScreenSpaceComposer({
  nodeId,
  children,
}: {
  nodeId: string;
  children: ReactNode;
}) {
  const root = useContext(CanvasOverlayRootContext);
  const dragging = useStore((state: ReactFlowState) =>
    Boolean(state.nodeLookup.get(nodeId)?.dragging),
  );
  const [dragReleaseSettling, setDragReleaseSettling] = useState(false);
  const hidden = dragging || dragReleaseSettling;
  useLayoutEffect(() => {
    if (dragging) {
      setDragReleaseSettling(true);
      return;
    }
    if (!dragReleaseSettling) return;
    let revealFrame = 0;
    let revealTimer = 0;
    const settleFrame = requestAnimationFrame(() => {
      revealFrame = requestAnimationFrame(() => {
        revealTimer = window.setTimeout(() => setDragReleaseSettling(false), 64);
      });
    });
    return () => {
      cancelAnimationFrame(settleFrame);
      if (revealFrame) cancelAnimationFrame(revealFrame);
      if (revealTimer) window.clearTimeout(revealTimer);
    };
  }, [dragReleaseSettling, dragging]);
  const selectPlacement = useCallback((state: ReactFlowState) => {
    const internal = state.nodeLookup.get(nodeId);
    const [viewportX, viewportY, zoom] = state.transform;
    const position = internal?.internals.positionAbsolute;
    const width = Number(internal?.measured.width || internal?.width || 0);
    const height = Number(internal?.measured.height || internal?.height || 0);
    const rootWidth = Number(root?.clientWidth || 570);
    const composerWidth = Math.min(570, Math.max(320, rootWidth - 24));
    const desiredLeft = viewportX + (Number(position?.x || 0) + width / 2) * zoom;
    return {
      left: Math.max(composerWidth / 2 + 12, Math.min(rootWidth - composerWidth / 2 - 12, desiredLeft)),
      top: viewportY + (Number(position?.y || 0) + height) * zoom + 10,
      width: composerWidth,
    };
  }, [nodeId, root]);
  const placement = useStore(
    selectPlacement,
    (left, right) => left.left === right.left && left.top === right.top && left.width === right.width,
  );
  if (!root) return null;
  return createPortal(
    <div
      className={`work-composer-anchor${hidden ? " work-composer-anchor--hidden" : ""}`}
      style={placement}
      aria-hidden={hidden}
    >
      {children}
    </div>,
    root,
  );
}

function ComposerInputThumbnail({
  input,
  onRemove,
  label,
}: {
  input: WorkflowIncomingInput;
  onRemove: () => void;
  label?: string;
}) {
  const kind = kindOf(input);
  const { url } = useLocalPreview(input, kind, 1);
  return (
    <div className="work-composer-input" title={input.name}>
      {kind === "image" && url ? (
        <img src={url} alt={input.name} />
      ) : kind === "video" && url ? (
        <video src={url} muted playsInline preload="metadata" />
      ) : (
        <IconSymbol name={kind === "audio" ? "waveform" : kind === "text" ? "text" : "file"} />
      )}
      {label && <span className="work-composer-input-label">{label}</span>}
      <button type="button" title="移除参考素材" onClick={onRemove}>
        <IconSymbol name="x" />
      </button>
    </div>
  );
}

export const GenerationNode: WorkflowNodeRenderer = memo(({
  node,
  selected,
  semanticZoom = 1,
  previewZoom = semanticZoom,
  incomingInputs = [],
  actions,
}) => {
  const [openMenu, setOpenMenu] = useState("");
  const videoPreviewRef = useRef<HTMLVideoElement>(null);
  const [videoTime, setVideoTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoMuted, setVideoMuted] = useState(false);
  const labelRoot = useContext(CanvasNodeLabelRootContext);
  const promptCommit = useImeCommit<HTMLTextAreaElement>(String(node.prompt || ""), (value) =>
    actions.update(node.id, { prompt: value }),
  );
  const outputs = (
    Array.isArray(node.generatedOutputs) ? node.generatedOutputs : []
  ) as OutputData[];
  const selectedOutput = outputs.find((item) => item.selected) || outputs[0] || null;
  const uploaded =
    node.uploadedFile && typeof node.uploadedFile === "object"
      ? (node.uploadedFile as Record<string, unknown>)
      : null;
  const outputKind = selectedOutput
    ? kindOf(selectedOutput as unknown as Record<string, unknown>)
    : "";
  const uploadKind = uploaded ? kindOf(uploaded) : "";
  const active = (selectedOutput || uploaded) as unknown as Record<string, unknown> | null;
  const activeKind = selectedOutput ? outputKind : uploadKind;
  const activeFilePath = String(selectedOutput?.filePath || uploaded?.filePath || uploaded?.path || "");
  const activeFileName = String(
    selectedOutput?.fileName || uploaded?.name || node.title ||
      (activeKind === "video" ? "video.mp4" : "image.png"),
  );
  const {
    url: previewUrl,
    retryBuffered: retryBufferedPreview,
    buffered: bufferedPreview,
  } = useLocalPreview(active, activeKind, previewZoom);
  const kind = node.type.replace("Generation", "");
  const meta = getTypeMeta(node.type);
  const busy = ["running", "queued"].includes(String(node.status));
  const metaLabel = String(meta.label || node.type);
  const metaIcon = String(meta.icon || "spark");
  const displayTitle = generationNodeDisplayTitle(node, selectedOutput, uploaded, metaLabel);
  const schema = selected
    ? getModelSchema(node.type, String(node.model || ""), resolveModeIdForInputMode(String(node.model || ""), String(node.inputMode || "")))
    : { models: [], params: [] };
  const config =
    node.config && typeof node.config === "object" ? (node.config as Record<string, unknown>) : {};
  const models = (
    Array.isArray(node.availableModels) ? node.availableModels : schema.models || []
  ) as string[];
  const params = (schema.params || []).filter(
    (param: { key: string; visibleWhen?: Record<string, unknown> }) =>
      param.key !== "prompt" &&
      param.key !== "model" &&
      paramPresentation(param).control !== "hidden" &&
      (!param.visibleWhen ||
        Object.entries(param.visibleWhen).every(([key, value]) => config[key] === value)),
  );
  const explicitSummaryParams = params.filter((param: { presentation?: unknown }) => paramPresentation(param).summary === true);
  const hasExplicitPresentation = params.some((param: { presentation?: unknown }) => (
    Boolean(param.presentation) && typeof param.presentation === "object"
  ));
  const summaryParams = hasExplicitPresentation ? explicitSummaryParams : params.slice(0, 4);
  function modelIcon(modelId: string) {
    const providerId = String(getModelInfo(modelId)?.provider || "");
    const configuredIcon =
      settingsStore.providerConfigs?.[providerId]?.iconId ||
      getProviderDefinition(providerId)?.iconId ||
      "";
    return resolveProviderIconId(providerId, modelId, configuredIcon);
  }
  const selectedModel = String(node.model || models[0] || "");
  const inputModes = getGenerationInputModes(selectedModel);
  const activeInputMode = inputModes.find((item) => item.value === node.inputMode) || inputModes[0] || null;
  const mediaInputs = incomingInputs.filter((input) => input.inputRole !== "textContext");
  const fixedImageSlots = activeInputMode?.value === "firstLastFrame"
    ? ["firstFrame", "lastFrame"]
    : activeInputMode?.value === "firstFrame" ? ["firstFrame"] : [];
  const inputLabel = (input: WorkflowIncomingInput) => input.inputSlot === "firstFrame"
    ? "首帧" : input.inputSlot === "lastFrame" ? "尾帧"
      : input.inputSlot === "inputVideo" ? "参考视频" : input.inputSlot === "referenceAudio" ? "参考音频" : "参考";
  const selectedPreset = getImageStylePreset(config.stylePresetId);
  const activeCameraConfig = normalizeCameraConfig(
    config.cameraConfig || DEFAULT_CAMERA_CONFIG,
  ) as Record<string, string>;
  const cameraControlEnabled = Boolean(config.cameraControl && config.cameraConfig);
  const textContent = textNodeContent({ ...node, generatedOutputs: outputs });
  const textPreview =
    textContent.length > MAX_TEXT_PREVIEW_CHARS
      ? `${textContent.slice(0, MAX_TEXT_PREVIEW_CHARS)}\n…双击查看完整内容`
      : textContent;
  function setConfig(key: string, value: unknown) {
    actions.update(node.id, { config: { ...config, [key]: value } });
  }
  function booleanParamSummary(key: string, label: string, value: unknown) {
    if (/audio/i.test(key) || label.includes("声音") || label.includes("有声")) return value ? "有声" : "无声";
    if (/watermark/i.test(key) || label.includes("水印")) return value ? "水印" : "无水印";
    return value ? label : "关闭";
  }
  function openDetail() {
    if (activeKind === "image" || activeKind === "video") {
      if (previewUrl) {
        openMediaViewer({
          src: previewUrl,
          kind: activeKind,
          title: selectedOutput?.title || String(node.title || metaLabel),
          filePath: String(selectedOutput?.filePath || uploaded?.filePath || uploaded?.path || ""),
        });
      }
    } else if (kind === "text") {
      openMediaViewer({
        src: textContent,
        kind: "text",
        title: String(node.title || "文本详情"),
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
      });
    }
  }
  async function saveActiveMedia() {
    if (!activeFilePath) return showToast("当前媒体没有可导出的本地原始文件");
    try {
      const buffer = await desktopApi.file.readArrayBuffer(activeFilePath);
      const result = await desktopApi.file.saveArrayBuffer(activeFileName, buffer);
      if (result) showToast("媒体已另存");
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "媒体另存失败");
    }
  }
  // Keep the media branch explicit: activeKind === 'image' && previewUrl ? <img /> : activeKind === 'video'.
  const nodeLabel = (
    <div className={`work-node-kicker${displayTitle ? "" : " unlabeled"}`}>
      {displayTitle && (
        <IconSymbol className="work-node-type-icon" name={metaIcon} aria-hidden="true" />
      )}
      {displayTitle && <span title={displayTitle}>{displayTitle}</span>}
      {selected && node.type === "imageGeneration" && activeKind === "image" && (
        <div className="work-node-kicker-actions">
          <button
            title="创建彩铅图片节点"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              void actions.applyColoredPencil(node.id);
            }}
          >
            <IconSymbol name="pencil" />
          </button>
        </div>
      )}
    </div>
  );
  return (
    <div
      className="work-node-wrapper"
      onClick={(e) => {
        e.stopPropagation();
        actions.select(node.id);
      }}
    >
      {labelRoot && createPortal(nodeLabel, labelRoot)}
      <div className="work-visual-block">
        <div className={`work-node work-node-${kind}${selected ? " selected" : ""}`}>
          <div
            className={`work-preview ${
              node.type === "videoGeneration" ? "wide" : "square"
            } ${kind}`}
            title={kind === "text" ? "双击编辑节点内容" : previewUrl ? "双击查看详情" : ""}
            onDoubleClick={openDetail}
          >
            {kind === "text" ? (
              textContent ? (
                <div className="text-result-scroll">
                  <p>{textPreview}</p>
                </div>
              ) : (
                <div className="text-result-empty">
                  <IconSymbol name="chat" />
                  <span>模型返回或手动编写的内容显示在这里</span>
                  <button
                    type="button"
                    className="text-result-manual nodrag nopan"
                    onClick={(event) => {
                      event.stopPropagation();
                      openDetail();
                    }}
                  >
                    <IconSymbol name="pencil" />
                    自己编写内容
                  </button>
                </div>
              )
            ) : activeKind === "image" && previewUrl ? (
              <img
                src={previewUrl}
                alt={String(node.title || metaLabel)}
                onLoad={(event) => {
                  const image = event.currentTarget;
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
                onPointerEnter={(event) => {
                  const video = event.currentTarget;
                  video.muted = videoMuted;
                  video.volume = 1;
                  void video.play().catch(() => undefined);
                }}
                onPointerLeave={(event) => {
                  if (event.buttons) return;
                  const video = event.currentTarget;
                  video.pause();
                }}
                onLoadedData={(event) => {
                  const video = event.currentTarget;
                  if (video.paused && video.currentTime === 0 && video.duration > 0) {
                    video.currentTime = Math.min(1 / 30, Math.max(0, video.duration - 0.04));
                  }
                }}
                onDurationChange={(event) => setVideoDuration(Number(event.currentTarget.duration) || 0)}
                onTimeUpdate={(event) => setVideoTime(event.currentTarget.currentTime)}
                onError={() => {
                  if (!bufferedPreview) retryBufferedPreview();
                }}
              />
            ) : activeKind === "audio" && previewUrl ? (
              <AudioWaveformPlayer
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
            {activeKind === "video" && previewUrl && (
              <div
                className="work-video-status"
                style={{ fontSize: `${10 * Math.min(1, semanticZoom)}px` }}
              >
                <span>{formatAudioTime(videoTime)} / {formatAudioTime(videoDuration)}</span>
                <button
                  type="button"
                  className="work-video-sound nodrag nopan"
                  title={videoMuted ? "开启声音" : "关闭声音"}
                  aria-pressed={!videoMuted}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    const nextMuted = !videoMuted;
                    setVideoMuted(nextMuted);
                    if (videoPreviewRef.current) videoPreviewRef.current.muted = nextMuted;
                  }}
                >
                  <IconSymbol name={videoMuted ? "volume-x" : "volume"} />
                </button>
              </div>
            )}
            {(activeKind === "image" || activeKind === "video") && previewUrl && (
              <button
                type="button"
                className="work-preview-download nodrag nopan"
                title="另存原始文件"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  void saveActiveMedia();
                }}
              >
                <IconSymbol name="download" />
              </button>
            )}
            {outputs.length > 1 && (
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
          {Boolean(node.error) && <div className="work-error">{String(node.error)}</div>}
        </div>
      </div>
      {selected && (
        <ScreenSpaceComposer nodeId={node.id}>
        <div
          className="work-composer nodrag nopan nowheel"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="work-composer-row">
            <span className="work-type-chip">{metaLabel}</span>
            {node.type === "imageGeneration" && (
              <div className="preset-picker">
                <button
                  className="preset-trigger"
                  type="button"
                  onClick={() => setOpenMenu(openMenu === "preset" ? "" : "preset")}
                >
                  <span className="preset-icon" style={{ color: selectedPreset.tone }}>
                    <IconSymbol name={selectedPreset.icon} />
                  </span>
                  <span>{selectedPreset.label}</span>
                  <IconSymbol name="chevron-down" />
                </button>
                {openMenu === "preset" && (
                  <div className="preset-menu">
                    {IMAGE_STYLE_PRESETS.map((preset) => (
                      <button
                        key={preset.id || "none"}
                        type="button"
                        className={`preset-option${preset.id === selectedPreset.id ? " active" : ""}`}
                        onClick={() => {
                          const next = { ...config };
                          if (preset.id) next.stylePresetId = preset.id;
                          else delete next.stylePresetId;
                          actions.update(node.id, { config: next });
                          setOpenMenu("");
                        }}
                      >
                        <span className="preset-icon" style={{ color: preset.tone }}>
                          <IconSymbol name={preset.icon} />
                        </span>
                        <span>
                          <strong>{preset.label}</strong>
                          <em>{preset.description}</em>
                        </span>
                        {preset.id === selectedPreset.id && <IconSymbol name="check" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {["image", "video", "audio"].includes(activeKind) && (
              <button
                className="video-export-trigger"
                onClick={() => void actions.addToVideoEditor(node.id)}
              >
                <IconSymbol name="film" />
                加入剪辑
              </button>
            )}
          </div>
          <div className="work-prompt-shell">
            <div className="work-composer-inputs">
              {fixedImageSlots.length ? fixedImageSlots.map((slot) => {
                const input = mediaInputs.find((item) => item.inputSlot === slot);
                return input ? (
                  <ComposerInputThumbnail
                    key={slot}
                    input={input}
                    label={slot === "firstFrame" ? "首帧" : "尾帧"}
                    onRemove={() => actions.removeIncomingEdge(node.id, input.edgeId)}
                  />
                ) : (
                  <button
                    key={slot}
                    type="button"
                    className="work-composer-add work-composer-slot nodrag nopan"
                    title={`添加${slot === "firstFrame" ? "首帧" : "尾帧"}`}
                    onClick={() => void actions.addReference(node.id, slot)}
                  >
                    <IconSymbol name="plus" />
                    <span>{slot === "firstFrame" ? "首帧" : "尾帧"}</span>
                  </button>
                );
              }) : mediaInputs.map((input) => (
                <ComposerInputThumbnail
                  key={input.edgeId}
                  input={input}
                  label={inputLabel(input)}
                  onRemove={() => actions.removeIncomingEdge(node.id, input.edgeId)}
                />
              ))}
              {!fixedImageSlots.length && activeInputMode && mediaInputs.length < (activeInputMode.maxImages + activeInputMode.maxVideos + activeInputMode.maxAudios) && (
                <button
                  type="button"
                  className="work-composer-add nodrag nopan"
                  title="添加参考素材"
                  onClick={() => void actions.addReference(node.id)}
                >
                  <IconSymbol name="plus" />
                </button>
              )}
            </div>
            <textarea
              placeholder={kind === "text" ? "输入给大模型的文本生成提示词" : "描述你想生成的画面、视频或音频"}
              rows={2}
              {...promptCommit}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !isImeKeyEvent(e.nativeEvent)) {
                  e.preventDefault();
                  actions.run(node.id);
                }
              }}
            />
          </div>
          <div className="work-param-row">
            <div className="work-param-controls">
            <div className="work-model-picker">
              <button
                className="work-model-trigger"
                type="button"
                title="选择生成模型"
                onClick={() => setOpenMenu(openMenu === "model" ? "" : "model")}
              >
                <ProviderBrandIcon className="model-logo" icon={modelIcon(selectedModel)} />
                <span>{getModelInfo(selectedModel)?.name || selectedModel || "选择模型"}</span>
                <IconSymbol name="chevron-down" />
              </button>
              {openMenu === "model" && (
                <div className="model-menu">
                  <p>选择生成模型</p>
                  {models.length ? (
                    models.map((model) => (
                      <button
                        key={model}
                        type="button"
                        className={`model-option${model === selectedModel ? " active" : ""}`}
                        onClick={() => {
                          actions.update(node.id, {
                            model,
                            config: compileGenerationNodeConfig(
                              config,
                              getModelSchema(node.type, model).params,
                              node.outputSpec,
                            ),
                            status: "idle",
                            progress: 0,
                            error: "",
                          });
                          const nextMode = getGenerationInputModes(model)[0];
                          if (nextMode) actions.setInputMode(node.id, nextMode.value);
                          setOpenMenu("");
                        }}
                      >
                        <ProviderBrandIcon className="model-logo" icon={modelIcon(model)} />
                        <span className="model-copy">
                          <strong>{getModelInfo(model)?.name || model}</strong>
                          <em>{String(modelDescription(model, node.type))}</em>
                        </span>
                        {model === selectedModel && <IconSymbol name="check" />}
                      </button>
                    ))
                  ) : (
                    <div className="model-menu-empty">暂无可用模型</div>
                  )}
                </div>
              )}
            </div>
            <div className="generation-settings-picker">
              <button
                type="button"
                className={`generation-settings-trigger${openMenu === "generationSettings" ? " active" : ""}`}
                title="生成参数"
                onClick={() => setOpenMenu(openMenu === "generationSettings" ? "" : "generationSettings")}
              >
                {activeInputMode && <span>{activeInputMode.label}</span>}
                {summaryParams.slice(0, 4).map((param) => (
                  <span key={param.key}>
                    {param.type === "boolean"
                      ? booleanParamSummary(param.key, param.label, config[param.key] ?? param.default)
                      : optionLabel(param, config[param.key] ?? param.default)}
                  </span>
                ))}
                <IconSymbol name="chevron-down" />
              </button>
              {openMenu === "generationSettings" && (
                <div
                  className="generation-settings-panel nodrag nopan nowheel"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                >
                  {inputModes.length > 1 && (
                    <section>
                      <p>生成方式</p>
                      <div className="generation-settings-segments">
                        {inputModes.map((mode) => (
                          <button
                            key={mode.value}
                            type="button"
                            className={mode.value === activeInputMode?.value ? "active" : ""}
                            onClick={() => actions.setInputMode(node.id, mode.value)}
                          >
                            {mode.label}
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                  {params.map((param, paramIndex) => {
                    const current = config[param.key] ?? param.default;
                    const presentation = paramPresentation(param);
                    const control = presentation.control || (param.type === "boolean" ? "toggle" : (param.options || []).length ? "segmented" : param.type === "number" ? "number" : "text");
                    const previousGroup = paramIndex > 0 ? String(paramPresentation(params[paramIndex - 1]).group || "") : "";
                    const group = String(presentation.group || "");
                    const groupHeading = group && group !== previousGroup
                      ? <h5 className="generation-settings-group-title">{group}</h5>
                      : null;
                    if (control === "toggle") {
                      return (
                        <div className="generation-settings-param" key={param.key}>
                          {groupHeading}
                          <section>
                            <p>{param.label}</p>
                            <div className="generation-settings-chips">
                              <button type="button" className={Boolean(current) ? "active" : ""} onClick={() => setConfig(param.key, true)}>开启</button>
                              <button type="button" className={!Boolean(current) ? "active" : ""} onClick={() => setConfig(param.key, false)}>关闭</button>
                            </div>
                          </section>
                        </div>
                      );
                    }
                    if (control === "slider") {
                      const min = Number(presentation.min);
                      const max = Number(presentation.max);
                      const step = Number(presentation.step) || 1;
                      const value = Number(current ?? min);
                      return (
                        <div className="generation-settings-param" key={param.key}>
                          {groupHeading}
                          <section>
                            <p>{param.label}</p>
                            <div className="generation-settings-slider">
                              <input
                                className="nodrag nopan"
                                type="range"
                                min={min}
                                max={max}
                                step={step}
                                value={value}
                                onChange={(event) => setConfig(param.key, Number(event.target.value))}
                              />
                              <output>{value}{presentation.unit || ""}</output>
                            </div>
                          </section>
                        </div>
                      );
                    }
                    if (control === "select") {
                      return (
                        <div className="generation-settings-param" key={param.key}>
                          {groupHeading}
                          <section>
                            <p>{param.label}</p>
                            <select
                              className="generation-settings-input nodrag nopan"
                              value={String(current ?? "")}
                              onChange={(event) => {
                                const matched = (param.options || []).find((option) => String(optionValue(option)) === event.target.value);
                                setConfig(param.key, matched === undefined ? event.target.value : optionValue(matched));
                              }}
                            >
                              {(param.options || []).map((option) => {
                                const value = optionValue(option);
                                return <option key={String(value)} value={String(value)}>{optionLabel(param, value)}</option>;
                              })}
                            </select>
                          </section>
                        </div>
                      );
                    }
                    if (!(param.options || []).length) {
                      const numeric = control === "number";
                      return (
                        <div className="generation-settings-param" key={param.key}>
                          {groupHeading}
                          <section>
                            <p>{param.label}</p>
                            <input
                              className="generation-settings-input nodrag nopan"
                              type={numeric ? "number" : "text"}
                              min={numeric && Number.isFinite(Number(presentation.min)) ? Number(presentation.min) : undefined}
                              max={numeric && Number.isFinite(Number(presentation.max)) ? Number(presentation.max) : undefined}
                              step={numeric && Number.isFinite(Number(presentation.step)) ? Number(presentation.step) : undefined}
                              value={String(current ?? "")}
                              onChange={(event) => {
                                const value = event.target.value;
                                setConfig(param.key, numeric && value !== "" ? Number(value) : undefined);
                              }}
                            />
                          </section>
                        </div>
                      );
                    }
                    return (
                      <div className="generation-settings-param" key={param.key}>
                        {groupHeading}
                        <section>
                          <p>{param.label}</p>
                          <div className={`generation-settings-options${control === "ratio" || isAspectRatioParam(param) ? " ratios" : ""}`}>
                            {(param.options || []).map((option) => {
                              const value = optionValue(option);
                              const active = value === current;
                              return (
                                <button
                                  key={String(value)}
                                  type="button"
                                  className={active ? "active" : ""}
                                  onClick={() => setConfig(param.key, value)}
                                >
                                  {(control === "ratio" || isAspectRatioParam(param)) && (
                                    <span className="generation-settings-ratio"><span style={aspectRatioStyle(value)} /></span>
                                  )}
                                  <span>{optionLabel(param, value)}</span>
                                </button>
                              );
                            })}
                          </div>
                        </section>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {false && params.map(
              (param: {
                key: string;
                label: string;
                type?: string;
                options?: unknown[];
                default?: unknown;
              }) =>
                param.type === "boolean" ? (
                  <label key={param.key} className="param-toggle">
                    <input
                      type="checkbox"
                      checked={Boolean(config[param.key] ?? param.default)}
                      onChange={(e) => setConfig(param.key, e.target.checked)}
                    />
                    <span>{param.label}</span>
                  </label>
                ) : isAspectRatioParam(param) ? (
                  (() => {
                    const current = config[param.key] ?? param.default ?? "1:1";
                    return (
                      <div key={param.key} className="ratio-picker">
                        <button
                          type="button"
                          className="ratio-trigger"
                          title={param.label}
                          onClick={() => setOpenMenu(openMenu === param.key ? "" : param.key)}
                        >
                          <span className="ratio-preview">
                            <span style={aspectRatioStyle(current)} />
                          </span>
                          <span>{optionLabel(param, current)}</span>
                          <IconSymbol name="chevron-down" />
                        </button>
                        {openMenu === param.key && (
                          <div className="ratio-menu">
                            <p>{param.label}</p>
                            {(param.options || []).map((option) => {
                              const value = optionValue(option);
                              const active = value === current;
                              return (
                                <button
                                  key={String(value)}
                                  type="button"
                                  className={`ratio-option${active ? " active" : ""}`}
                                  onClick={() => {
                                    setConfig(param.key, value);
                                    setOpenMenu("");
                                  }}
                                >
                                  <span className="ratio-preview">
                                    <span style={aspectRatioStyle(value)} />
                                  </span>
                                  <strong>{optionLabel(param, value)}</strong>
                                  {active && <IconSymbol name="check" />}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })()
                ) : (
                  <div key={param.key} className="param-picker">
                    <button
                      type="button"
                      className="param-trigger"
                      title={param.label}
                      onClick={() => setOpenMenu(openMenu === param.key ? "" : param.key)}
                    >
                      <span>{param.label}</span>
                      <strong>{optionLabel(param, config[param.key] ?? param.default)}</strong>
                      <IconSymbol name="chevron-down" />
                    </button>
                    {openMenu === param.key && (
                      <div
                        className={`param-menu${String(param.key).toLowerCase().includes("size") ? " size-menu" : ""}`}
                      >
                        <p>{param.label}</p>
                        {(param.options || []).map((option) => {
                          const value = optionValue(option);
                          const current = config[param.key] ?? param.default;
                          const active = value === current;
                          return (
                            <button
                              key={String(value)}
                              type="button"
                              className={`param-option${active ? " active" : ""}`}
                              onClick={() => {
                                setConfig(param.key, value);
                                setOpenMenu("");
                              }}
                            >
                              <span
                                className={`param-option-visual ${paramVisualClass(param, value).join(" ")}`}
                              >
                                {paramVisualText(param, value)}
                              </span>
                              <span className="param-option-copy">
                                <strong>{optionLabel(param, value)}</strong>
                                <em>{paramOptionHint(param)}</em>
                              </span>
                              {active && <IconSymbol name="check" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ),
            )}
            {node.type === "imageGeneration" && (
              <button
                type="button"
                className={`work-camera-btn${cameraControlEnabled ? " active" : ""}`}
                title={
                  cameraControlEnabled
                    ? `${activeCameraConfig.camera} · ${activeCameraConfig.lens} · ${activeCameraConfig.focalLength} · ${activeCameraConfig.aperture}`
                    : "打开摄影机配置"
                }
                onClick={() => {
                  const opening = openMenu !== "camera";
                  setOpenMenu(opening ? "camera" : "");
                  if (opening && !cameraControlEnabled) {
                    actions.update(node.id, {
                      config: {
                        ...config,
                        cameraControl: true,
                        cameraConfig: { ...activeCameraConfig },
                      },
                    });
                  }
                }}
              >
                <IconSymbol name="camera" />
                <span>{cameraControlEnabled ? activeCameraConfig.focalLength : "镜头"}</span>
              </button>
            )}
            </div>
            <button
              className={`work-run-btn${busy ? " running" : ""}`}
              disabled={busy}
              title={busy ? "正在生成" : "开始生成"}
              onClick={() => actions.run(node.id)}
            >
              <IconSymbol name={busy ? "refresh" : "send"} />
            </button>
          </div>
          {node.type === "imageGeneration" && openMenu === "camera" && (
            <CameraControlPanel
              config={activeCameraConfig}
              enabled={cameraControlEnabled}
              onChange={(value) =>
                actions.update(node.id, {
                  config: { ...config, cameraControl: true, cameraConfig: value },
                })
              }
              onToggle={(enabled) =>
                actions.update(node.id, {
                  config: {
                    ...config,
                    cameraControl: enabled,
                    cameraConfig: config.cameraConfig || { ...DEFAULT_CAMERA_CONFIG },
                  },
                })
              }
              onClose={() => setOpenMenu("")}
            />
          )}
        </div>
        </ScreenSpaceComposer>
      )}
    </div>
  );
});

export const generationNodeRenderers = Object.fromEntries(
  [...generationTypes].map((type) => [type, GenerationNode]),
);
