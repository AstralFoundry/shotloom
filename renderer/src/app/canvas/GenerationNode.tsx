import { memo, useEffect, useMemo, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { desktopApi } from "../../services/desktopApi.js";
import {
  getModelInfo,
  getModelSchema,
  getTypeMeta,
} from "../../domain/catalog/ModelCatalog";
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
import {
  resolveProviderIconId,
} from "../../domain/provider/ProviderBrandIcons.js";
import { getProviderDefinition } from "../../domain/provider/ProviderRegistry";
import { settingsStore } from "../../store/settingsStore.js";
import {
  getImageStylePreset,
  IMAGE_STYLE_PRESETS,
} from "../../utils/imageStylePresets.mjs";
import { IconSymbol } from "../components/IconSymbol";
import { ProviderBrandIcon } from "../components/ProviderBrandIcon";
import { CameraControlPanel } from "./CameraControlPanel";
import {
  DEFAULT_CAMERA_CONFIG,
  normalizeCameraConfig,
} from "../../utils/cameraConfig.js";
import { openMediaViewer, showToast } from "../store/overlayStore";
import type { WorkflowNodeData, WorkflowNodeRenderer } from "./WorkflowCanvas";
import { schedulePreviewLoad } from "./previewLoadQueue";
import { useImeCommit } from "./imeComposition";

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
const extKinds = {
  image: ["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp", "svg"],
  video: ["mp4", "mov", "webm", "m4v"],
  audio: ["mp3", "wav", "m4a", "aac", "ogg", "flac"],
  text: ["txt", "md", "json", "csv", "log"],
} as const;
function kindOf(
  item: Record<string, unknown>,
): "image" | "video" | "audio" | "text" | "" {
  const type = String(item.resourceType || item.mimeType || "").toLowerCase();
  const ext =
    String(item.fileName || item.filePath || item.url || item.previewUrl || "")
      .split(/[?#]/)[0].split(".").pop()?.toLowerCase() || "";
  return (Object.keys(extKinds) as Array<keyof typeof extKinds>).find((kind) =>
    type.includes(kind) || extKinds[kind].includes(ext as never)
  ) || (item.content ? "text" : "");
}
function useLocalPreview(item: Record<string, unknown> | null, kind: string) {
  const [url, setUrl] = useState("");
  const path = String(item?.filePath || item?.path || "");
  useEffect(() => {
    let cancelled = false;
    let created = "";
    let cancelLoad = () => {};
    if (path && ["image", "video", "audio"].includes(kind)) {
      cancelLoad = schedulePreviewLoad(async () => {
        if (cancelled) return;
        try {
          let buffer: ArrayBuffer | undefined;
          let mime = String(item?.mimeType || item?.type || `${kind}/*`);
          if (kind === "image" && desktopApi.file.readImagePreview) {
            try {
              buffer = await desktopApi.file.readImagePreview(path, 960);
              mime = "image/jpeg";
            } catch {
              buffer = await desktopApi.file.readArrayBuffer?.(path);
            }
          } else buffer = await desktopApi.file.readArrayBuffer?.(path);
          if (!cancelled && buffer?.byteLength) {
            created = URL.createObjectURL(new Blob([buffer], { type: mime }));
            setUrl(created);
          }
        } catch {}
      });
    }
    return () => {
      cancelled = true;
      cancelLoad();
      if (created) URL.revokeObjectURL(created);
      setUrl("");
    };
  }, [path, kind, item?.mimeType]);
  if (url) return url;
  const raw = String(item?.previewUrl || item?.url || item?.content || "");
  return /^(https?:|blob:|data:)/i.test(raw) ? raw : "";
}

export const GenerationNode: WorkflowNodeRenderer = memo(
  ({ node, selected, actions }) => {
    const [openMenu, setOpenMenu] = useState("");
    const promptCommit = useImeCommit<HTMLTextAreaElement>(
      String(node.prompt || ""),
      (value) => actions.update(node.id, { prompt: value }),
    );
    const outputs =
      (Array.isArray(node.generatedOutputs)
        ? node.generatedOutputs
        : []) as OutputData[];
    const selectedOutput = outputs.find((item) => item.selected) ||
      outputs[0] || null;
    const uploaded = node.uploadedFile && typeof node.uploadedFile === "object"
      ? node.uploadedFile as Record<string, unknown>
      : null;
    const outputKind = selectedOutput
      ? kindOf(selectedOutput as unknown as Record<string, unknown>)
      : "";
    const uploadKind = uploaded ? kindOf(uploaded) : "";
    const active = (selectedOutput || uploaded) as unknown as
      | Record<string, unknown>
      | null;
    const activeKind = selectedOutput ? outputKind : uploadKind;
    const selectedVideoPath = activeKind === "video"
      ? String(
        selectedOutput?.filePath ||
          (selectedOutput as unknown as Record<string, unknown> | null)?.path ||
          uploaded?.filePath || uploaded?.path || "",
      )
      : "";
    const previewUrl = useLocalPreview(active, activeKind);
    const kind = node.type.replace("Generation", "");
    const meta = getTypeMeta(node.type);
    const busy = ["running", "queued"].includes(String(node.status));
    const metaLabel = String(meta.label || node.type);
    const metaIcon = String(meta.icon || "spark");
    const schema = getModelSchema(node.type, String(node.model || ""));
    const config = node.config && typeof node.config === "object"
      ? node.config as Record<string, unknown>
      : {};
    const models =
      (Array.isArray(node.availableModels)
        ? node.availableModels
        : schema.models || []) as string[];
    const params = (schema.params || []).filter((
      param: { key: string; visibleWhen?: Record<string, unknown> },
    ) =>
      param.key !== "prompt" && param.key !== "model" &&
      (!param.visibleWhen ||
        Object.entries(param.visibleWhen).every(([key, value]) =>
          config[key] === value
        ))
    );
    function modelIcon(modelId: string) {
      const providerId = String(getModelInfo(modelId)?.provider || "");
      const configuredIcon = settingsStore.providerConfigs?.[providerId]
        ?.iconId || getProviderDefinition(providerId)?.iconId || "";
      return resolveProviderIconId(providerId, modelId, configuredIcon);
    }
    const selectedModel = String(node.model || models[0] || "");
    const selectedPreset = getImageStylePreset(config.stylePresetId);
    const activeCameraConfig = normalizeCameraConfig(
      config.cameraConfig || DEFAULT_CAMERA_CONFIG,
    ) as Record<string, string>;
    const cameraControlEnabled = Boolean(
      config.cameraControl && config.cameraConfig,
    );
    const textContent = String(
      selectedOutput?.content || node.textContent || node.prompt || "",
    );
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
                  output.id === selectedOutput.id
                    ? { ...output, content }
                    : output
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
            <IconSymbol name={metaIcon} />
            <span>{metaLabel}</span>
            {selected && node.type === "imageGeneration" &&
              activeKind === "image" && (
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
          <div
            className={`work-node work-node-${kind}${
              selected ? " selected" : ""
            }`}
          >
            <Handle
              id="target-left"
              className="node-port node-port-in"
              type="target"
              position={Position.Left}
            />
            <Handle
              id="source-right"
              className="node-port node-port-out"
              type="source"
              position={Position.Right}
            />
            <Handle
              id="source-left"
              className="edge-routing-port"
              type="source"
              position={Position.Left}
            />
            <Handle
              id="target-right"
              className="edge-routing-port"
              type="target"
              position={Position.Right}
            />
            <div
              className={`work-preview ${
                node.type === "videoGeneration" ? "wide" : "square"
              } ${kind}`}
              title={previewUrl || textContent ? "双击查看详情" : ""}
              onDoubleClick={openDetail}
            >
              {kind === "text"
                ? textContent
                  ? (
                    <div className="text-result-scroll">
                      <p>{textContent}</p>
                    </div>
                  )
                  : (
                    <div className="text-result-empty">
                      <IconSymbol name="chat" />
                      <span>运行后在节点内显示文本</span>
                    </div>
                  )
                : activeKind === "image" && previewUrl
                ? <img src={previewUrl} alt={String(node.title || metaLabel)} />
                : activeKind === "video" && previewUrl
                ? <video src={previewUrl} controls preload="metadata" />
                : activeKind === "audio" && previewUrl
                ? <audio src={previewUrl} controls preload="metadata" />
                : (
                  <div className="work-empty-state">
                    <IconSymbol
                      className="work-empty-type-icon"
                      name={metaIcon}
                    />
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
            {Boolean(node.error) && (
              <div className="work-error">{String(node.error)}</div>
            )}
          </div>
        </div>
        {selected && (
          <div
            className="work-composer nodrag nopan nowheel"
            onClick={(e) => e.stopPropagation()}
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
                          <span><strong>{preset.label}</strong><em>{preset.description}</em></span>
                          {preset.id === selectedPreset.id && <IconSymbol name="check" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {node.type === "videoGeneration" && (
                <button
                  className="video-export-trigger"
                  onClick={() => {
                    if (selectedVideoPath) {
                      actions.openVideoEditor(node.id);
                    } else showToast("当前节点还没有可剪辑的本地视频文件");
                  }}
                >导出剪辑</button>
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
                  if (
                    e.key === "Enter" && !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
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
                  onClick={() =>
                    setOpenMenu(openMenu === "model" ? "" : "model")}
                >
                  <ProviderBrandIcon
                    className="model-logo"
                    icon={modelIcon(selectedModel)}
                  />
                  <span>{getModelInfo(selectedModel)?.name || selectedModel || "选择模型"}</span>
                  <IconSymbol name="chevron-down" />
                </button>
                {openMenu === "model" && (
                  <div className="model-menu">
                    <p>选择生成模型</p>
                    {models.length
                      ? models.map((model) => (
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
                          <ProviderBrandIcon
                            className="model-logo"
                            icon={modelIcon(model)}
                          />
                          <span className="model-copy">
                            <strong>{getModelInfo(model)?.name || model}</strong>
                            <em>{String(modelDescription(model, node.type))}</em>
                          </span>
                          {model === selectedModel && <IconSymbol name="check" />}
                        </button>
                      ))
                      : <div className="model-menu-empty">暂无可用模型</div>}
                  </div>
                )}
              </div>
              {params.map((
                param: {
                  key: string;
                  label: string;
                  type?: string;
                  options?: unknown[];
                  default?: unknown;
                },
              ) =>
                param.type === "boolean"
                  ? (
                    <label key={param.key} className="param-toggle">
                      <input
                        type="checkbox"
                        checked={Boolean(config[param.key] ?? param.default)}
                        onChange={(e) => setConfig(param.key, e.target.checked)}
                      />
                      <span>{param.label}</span>
                    </label>
                  )
                  : isAspectRatioParam(param)
                  ? (() => {
                    const current = config[param.key] ?? param.default ?? "1:1";
                    return (
                      <div key={param.key} className="ratio-picker">
                        <button
                          type="button"
                          className="ratio-trigger"
                          title={param.label}
                          onClick={() => setOpenMenu(
                            openMenu === param.key ? "" : param.key,
                          )}
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
                  : (
                    <div key={param.key} className="param-picker">
                      <button
                        type="button"
                        className="param-trigger"
                        title={param.label}
                        onClick={() => setOpenMenu(
                          openMenu === param.key ? "" : param.key,
                        )}
                      >
                        <span>{param.label}</span>
                        <strong>{optionLabel(
                          param,
                          config[param.key] ?? param.default,
                        )}</strong>
                        <IconSymbol name="chevron-down" />
                      </button>
                      {openMenu === param.key && (
                        <div className={`param-menu${String(param.key).toLowerCase().includes("size") ? " size-menu" : ""}`}>
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
                                <span className={`param-option-visual ${paramVisualClass(param, value).join(" ")}`}>
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
                  )
              )}
              {node.type === "imageGeneration" && (
                <button
                  type="button"
                  className={`work-camera-btn${cameraControlEnabled ? " active" : ""}`}
                  title={cameraControlEnabled
                    ? `${activeCameraConfig.camera} · ${activeCameraConfig.lens} · ${activeCameraConfig.focalLength} · ${activeCameraConfig.aperture}`
                    : "打开摄影机配置"}
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
                onChange={(value) => actions.update(node.id, {
                  config: { ...config, cameraControl: true, cameraConfig: value },
                })}
                onToggle={(enabled) => actions.update(node.id, {
                  config: {
                    ...config,
                    cameraControl: enabled,
                    cameraConfig: config.cameraConfig || { ...DEFAULT_CAMERA_CONFIG },
                  },
                })}
                onClose={() => setOpenMenu("")}
              />
            )}
          </div>
        )}
      </div>
    );
  },
);

export const generationNodeRenderers = Object.fromEntries(
  [...generationTypes].map((type) => [type, GenerationNode]),
);
