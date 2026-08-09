import { memo, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Handle, Position, type ReactFlowState, useStore } from "@xyflow/react";
import { getModelInfo, getModelSchema, getTypeMeta } from "../../domain/catalog/ModelCatalog";
import { CanvasOverlayRootContext, MentionContext } from "./WorkflowCanvas";
import {
  aspectRatioStyle,
  isAspectRatioParam,
  modelDescription,
  optionLabel,
  optionValue,
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
import type { WorkflowNodeData, WorkflowNodeRenderer } from "./WorkflowCanvas";
import { useMediaPreviewCache } from "./useMediaPreviewCache";
import { isImeKeyEvent, useImeCommit } from "./imeComposition";
import { imageCanvasNodeDimensions } from "../../domain/graph/CanvasNodeDimensions";

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
function useLocalPreview(item: Record<string, unknown> | null, kind: string) {
  const path = String(item?.filePath || item?.path || "");
  const raw = String(item?.previewUrl || item?.url || item?.content || "");
  return useMediaPreviewCache({
    path,
    kind,
    mimeType: String(item?.mimeType || item?.type || ""),
    maxSize: 960,
    revision: String(item?.updatedAt || item?.createdAt || item?.id || ""),
    fallbackUrl: raw,
  });
}

function ScreenSpaceComposer({ nodeId, children }: { nodeId: string; children: ReactNode }) {
  const root = useContext(CanvasOverlayRootContext);
  const selectPlacement = useCallback((state: ReactFlowState) => {
    const internal = state.nodeLookup.get(nodeId);
    const [viewportX, viewportY, zoom] = state.transform;
    const position = internal?.internals.positionAbsolute;
    const width = Number(internal?.measured.width || internal?.width || 0);
    const height = Number(internal?.measured.height || internal?.height || 0);
    return {
      left: viewportX + (Number(position?.x || 0) + width / 2) * zoom,
      top: viewportY + (Number(position?.y || 0) + height) * zoom + 10,
    };
  }, [nodeId]);
  const placement = useStore(
    selectPlacement,
    (left, right) => left.left === right.left && left.top === right.top,
  );
  if (!root) return null;
  return createPortal(
    <div className="work-composer-anchor" style={placement}>{children}</div>,
    root,
  );
}

export const GenerationNode: WorkflowNodeRenderer = memo(({ node, selected, actions }) => {
  const [openMenu, setOpenMenu] = useState("");
  const mentionInCopilot = useContext(MentionContext);
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
  const {
    url: previewUrl,
    retryBuffered: retryBufferedPreview,
    buffered: bufferedPreview,
  } = useLocalPreview(active, activeKind);
  const kind = node.type.replace("Generation", "");
  const meta = getTypeMeta(node.type);
  const busy = ["running", "queued"].includes(String(node.status));
  const metaLabel = String(meta.label || node.type);
  const metaIcon = String(meta.icon || "spark");
  const schema = selected
    ? getModelSchema(node.type, String(node.model || ""))
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
      (!param.visibleWhen ||
        Object.entries(param.visibleWhen).every(([key, value]) => config[key] === value)),
  );
  function modelIcon(modelId: string) {
    const providerId = String(getModelInfo(modelId)?.provider || "");
    const configuredIcon =
      settingsStore.providerConfigs?.[providerId]?.iconId ||
      getProviderDefinition(providerId)?.iconId ||
      "";
    return resolveProviderIconId(providerId, modelId, configuredIcon);
  }
  const selectedModel = String(node.model || models[0] || "");
  const selectedPreset = getImageStylePreset(config.stylePresetId);
  const activeCameraConfig = normalizeCameraConfig(
    config.cameraConfig || DEFAULT_CAMERA_CONFIG,
  ) as Record<string, string>;
  const cameraControlEnabled = Boolean(config.cameraControl && config.cameraConfig);
  const textContent = String(selectedOutput?.content || node.textContent || node.prompt || "");
  const textPreview =
    textContent.length > MAX_TEXT_PREVIEW_CHARS
      ? `${textContent.slice(0, MAX_TEXT_PREVIEW_CHARS)}\n…双击查看完整内容`
      : textContent;
  function setConfig(key: string, value: unknown) {
    actions.update(node.id, { config: { ...config, [key]: value } });
  }
  function openDetail() {
    if (activeKind === "image" || activeKind === "video") {
      if (previewUrl) {
        openMediaViewer({
          src: previewUrl,
          kind: activeKind,
          title: selectedOutput?.title || String(node.title || metaLabel),
          filePath: String(selectedOutput?.filePath || uploaded?.path || ""),
        });
      }
    } else if (kind === "text" && textContent) {
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
  // Keep the media branch explicit: activeKind === 'image' && previewUrl ? <img /> : activeKind === 'video'.
  return (
    <div
      className="work-node-wrapper"
      onClick={(e) => {
        e.stopPropagation();
        actions.select(node.id);
      }}
    >
      <div className="work-visual-block">
        <div className="work-node-kicker">
          {mentionInCopilot && (
            <button
              className="node-mention-btn"
              title={activeKind === "image"
                ? `添加图片和节点到对话：${node.title || node.type}`
                : `引用节点：${node.title || node.type}`}
              onClick={(e) => {
                e.stopPropagation();
                mentionInCopilot(node.id);
              }}
            >
              @
            </button>
          )}
          <IconSymbol name={metaIcon} />
          <span>{metaLabel}</span>
          {selected && node.type === "imageGeneration" && activeKind === "image" && (
            <div className="work-node-kicker-actions">
              <button
                title="创建彩铅图片节点"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  void actions.applyColoredPencil(node.id);
                }}
              >
                <IconSymbol name="pencil" />
              </button>
            </div>
          )}
        </div>
        <div className={`work-node work-node-${kind}${selected ? " selected" : ""}`}>
          <Handle
            id="port-left"
            className="node-port node-port-in"
            type="source"
            position={Position.Left}
          />
          <Handle
            id="port-right"
            className="node-port node-port-out"
            type="source"
            position={Position.Right}
          />
          <div
            className={`work-preview ${
              node.type === "videoGeneration" ? "wide" : "square"
            } ${kind}`}
            title={previewUrl || textContent ? "双击查看详情" : ""}
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
                  <span>运行后在节点内显示文本</span>
                </div>
              )
            ) : activeKind === "image" && previewUrl ? (
              <img
                src={previewUrl}
                alt={String(node.title || metaLabel)}
                onLoad={(event) => {
                  const image = event.currentTarget;
                  const dimensions = imageCanvasNodeDimensions(
                    image.naturalWidth,
                    image.naturalHeight,
                  );
                  if (
                    Number(node.canvasWidth) !== dimensions.width ||
                    Number(node.canvasHeight) !== dimensions.height
                  ) {
                    actions.update(node.id, {
                      canvasWidth: dimensions.width,
                      canvasHeight: dimensions.height,
                    });
                  }
                }}
              />
            ) : activeKind === "video" && previewUrl ? (
              <video
                className="nodrag nopan nowheel"
                src={previewUrl}
                controls
                playsInline
                preload="auto"
                onPointerDown={(event) => event.stopPropagation()}
                onLoadedData={(event) => {
                  const video = event.currentTarget;
                  if (video.paused && video.currentTime === 0 && video.duration > 0) {
                    video.currentTime = Math.min(1 / 30, Math.max(0, video.duration - 0.04));
                  }
                }}
                onError={() => {
                  if (!bufferedPreview) retryBufferedPreview();
                }}
              />
            ) : activeKind === "audio" && previewUrl ? (
              <audio
                className="nodrag nopan nowheel"
                src={previewUrl}
                controls
                preload="metadata"
                onPointerDown={(event) => event.stopPropagation()}
                onError={() => {
                  if (!bufferedPreview) retryBufferedPreview();
                }}
              />
            ) : (
              <div className="work-empty-state">
                <IconSymbol className="work-empty-type-icon" name={metaIcon} />
                <button
                  type="button"
                  className="work-empty-upload nodrag nopan"
                  onClick={(event) => {
                    event.stopPropagation();
                    void actions.upload(node.id);
                  }}
                >
                  <IconSymbol name="upload" />
                  <span>上传{metaLabel.replace("生成", "")}</span>
                </button>
              </div>
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
        <div className="work-composer nodrag nopan nowheel" onClick={(e) => e.stopPropagation()}>
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
          {outputs.length > 0 && (
            <div className="work-inputs work-outputs">
              <span>Outputs</span>
              {outputs.map((output) => (
                <button
                  key={output.id}
                  className={output === selectedOutput ? "active" : ""}
                  onClick={() => actions.selectOutput(node.id, output.id)}
                >
                  {output.title}
                  <em>{output.resourceType}</em>
                </button>
              ))}
            </div>
          )}
          <div className="work-prompt-shell">
            <textarea
              placeholder="描述你想生成的画面、视频、音频或文本"
              rows={2}
              {...promptCommit}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !isImeKeyEvent(e.nativeEvent)) {
                  e.preventDefault();
                  actions.run(node.id);
                }
              }}
            />
            <button
              className={`work-run-btn${busy ? " running" : ""}`}
              disabled={busy}
              onClick={() => actions.run(node.id)}
            >
              <IconSymbol name={busy ? "refresh" : "send"} />
            </button>
          </div>
          <div className="work-param-row">
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
                            status: "idle",
                            progress: 0,
                            error: "",
                          });
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
            {params.map(
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
