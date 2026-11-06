import { t, type MessageKey } from '@/i18n';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { getDomainRevision, subscribeDomain } from "../../store/domainReactivity";
import { getGenerationInputModes, getModelInfo, getModelSchema } from "../../domain/catalog/ModelCatalog";
import { compileGenerationNodeConfig } from "../../domain/graph/GenerationNodeContract";
import { DEFAULT_CAMERA_CONFIG } from "../../utils/cameraConfig.ts";
import { IMAGE_STYLE_PRESETS } from "../../utils/imageStylePresets.ts";
import { paramSummary } from "../../utils/modelPresentation.ts";
import { openMediaViewer } from "../store/overlayStore";
import { mediaPosterUrl } from "../../services/mediaPoster";
import { IconSymbol } from "../components/IconSymbol";
import { ProviderBrandIcon } from "../components/ProviderBrandIcon";
import { CameraControlPanel } from "./CameraControlPanel";
import { GenerationSettingsPanel } from "./GenerationSettingsPanel";
import { isImeKeyEvent } from "./imeComposition";
import { generationMediaKind, useGenerationLocalPreview } from "./generationNodeMedia";
import { editorCaretOffset, editorPrompt, referenceLabels, renderPromptEditor, setEditorCaret } from "./promptReferenceEditor";
import { findSmartReferences } from "@/utils/smartPromptReference";
import { Modal, Segmented, Input as AntInput } from "antd";
import { OPTIMIZER_MODES, type OptimizerMode, type OptimizerResult } from "@/domain/prompt/optimizer";
import { optimizePrompt } from "@/services/promptOptimizerService";
import { recordCanvasHistory } from "@/store/canvasHistoryStore";
import { generationModelDescription, generationModelIcon, toGenerationConfigParam, type GenerationNodeState } from "./generationNodeState";
import type { WorkflowIncomingInput, WorkflowNodeActions, WorkflowNodeData, WorkflowReferenceCandidate } from "./WorkflowCanvas";

const OPTIMIZER_MODE_LABELS: Record<OptimizerMode, MessageKey> = {
  expand: "canvas.optimizer.mode.expand",
  polish: "canvas.optimizer.mode.polish",
  style: "canvas.optimizer.mode.style",
  model: "canvas.optimizer.mode.model",
  reference: "canvas.optimizer.mode.reference",
};

function generationInputLabel(input: WorkflowIncomingInput) {
  return input.inputSlot === "firstFrame"
    ? t("ui.CanvasNodeToolbar.label.f19f6b6d") : input.inputSlot === "lastFrame" ? t("ui.CanvasNodeToolbar.label.35b12241")
      : input.inputSlot === "inputVideo" ? t("ui.GenerationNodeComposer.text.ce9406ae") : input.inputSlot === "referenceAudio" ? t("ui.GenerationNodeComposer.text.ebd234c7") : t("ui.GenerationNodeComposer.text.a1880f69");
}

function ComposerInputThumbnail({
  input,
  onRemove,
  label,
  number,
}: {
  input: WorkflowIncomingInput;
  onRemove: () => void;
  label?: string | undefined;
  number?: number | undefined;
}) {
  const kind = generationMediaKind(input);
  const { url } = useGenerationLocalPreview(input, kind, 1);
  const previewable = (kind === "image" || kind === "video") && Boolean(url);
  const openInputPreview = () => {
    if (!previewable) return;
    openMediaViewer({
      src: url,
      kind,
      title: input.name || (kind === "image" ? t("ui.GenerationNodeComposer.text.2132324c") : t("ui.GenerationNodeComposer.text.ce9406ae")),
      filePath: String(input.filePath || input.path || ""),
    });
  };
  return (
    <div className="work-composer-input" title={input.name} data-ref-number={number || undefined}>
      <button
        type="button"
        className="work-composer-input-preview"
        title={previewable ? t("ui.GenerationNodeComposer.text.e53e93fb", { value0: input.name }) : input.name}
        aria-label={previewable ? t("ui.GenerationNodeComposer.text.65bed149", { value0: input.name }) : input.name}
        disabled={!previewable}
        onClick={openInputPreview}
      >
        {kind === "image" && url ? (
          <img src={url} alt={input.name} />
        ) : kind === "video" && url ? (
          <video src={url} muted playsInline preload="metadata" />
        ) : (
          <IconSymbol name={kind === "audio" ? "waveform" : kind === "text" ? "text" : "file"} />
        )}
        {label && <span className="work-composer-input-label">{label}</span>}
      </button>
      <button className="work-composer-input-remove" type="button" title={t("ui.GenerationNodeComposer.title.b7ee8e96")} onClick={onRemove}>
        <IconSymbol name="x" />
      </button>
    </div>
  );
}

const referenceMentionGroups = [
  { id: "current" as const, label: t("ui.GenerationNodeComposer.text.65fe35c4") },
  { id: "asset" as const, label: t("ui.GenerationNodeComposer.text.3290074f") },
];

function ReferenceMentionThumb({ candidate }: { candidate: WorkflowReferenceCandidate }) {
  const { kind, media } = candidate;
  const { url } = useGenerationLocalPreview(media, kind, 1);
  const sourceFile = String(media.filePath || media.path || "");
  const sourceUrl = String(media.previewUrl || media.url || "");
  const [poster, setPoster] = useState("");
  useEffect(() => {
    if (kind !== "video") return;
    let active = true;
    void mediaPosterUrl({ sourceFile, sourceUrl }).then((value) => {
      if (active) setPoster(value);
    });
    return () => { active = false; };
  }, [kind, sourceFile, sourceUrl]);
  const preview = kind === "image" ? url : poster;
  return (
    <span className="work-reference-mention-thumb" aria-hidden="true">
      {preview ? <img src={preview} alt="" loading="lazy" />
        : kind === "video" && url ? <video src={url} muted playsInline preload="metadata" />
        : <IconSymbol name={kind === "audio" ? "waveform" : kind === "video" ? "video" : "image"} />}
    </span>
  );
}

export function GenerationNodeComposer({
  node,
  state,
  actions,
  promptRef,
}: {
  node: WorkflowNodeData;
  state: GenerationNodeState;
  actions: WorkflowNodeActions;
  promptRef: RefObject<HTMLDivElement | null>;
}) {
  const [openMenu, setOpenMenu] = useState("");
  const [mention, setMention] = useState<{ query: string; start: number; end: number; index: number } | null>(null);
  const composing = useRef(false);
  const lastRenderedReferences = useRef("");
  const domainRevision = useSyncExternalStore(subscribeDomain, getDomainRevision);
  const candidates = useMemo(() => actions.listReferenceCandidates(node.id), [actions, node.id, domainRevision]);
  const mentionOptions = mention
    ? candidates
      .filter((item) => item.name.toLocaleLowerCase().includes(mention.query.toLocaleLowerCase()))
      .sort((a, b) => referenceMentionGroups.findIndex((group) => group.id === a.group)
        - referenceMentionGroups.findIndex((group) => group.id === b.group))
      .slice(0, 8)
    : [];
  const mentionGroups = referenceMentionGroups
    .map((group) => ({ ...group, items: mentionOptions.filter((item) => item.group === group.id) }))
    .filter((group) => group.items.length);
  const {
    activeCameraConfig, activeInputMode, busy, cameraControlEnabled, config, fixedImageSlots,
    kind, mediaInputs, models, selectedModel, selectedPreset, summaryParams,
  } = state;
  const references = Array.isArray(node.promptReferences) ? node.promptReferences as Array<{ alias: string; nodeId: string }> : [];
  const inputLabels = referenceLabels(mediaInputs);
  const referencesKey = JSON.stringify({ references, inputs: inputLabels.map((item) => [item.nodeId, item.kind, item.number, item.input.previewUrl, item.input.filePath]) });
  useLayoutEffect(() => {
    const element = promptRef.current;
    if (!element || composing.current) return;
    const focused = document.activeElement === element;
    if (focused && editorPrompt(element) === String(node.prompt || "") && lastRenderedReferences.current === referencesKey) return;
    const caret = focused ? editorCaretOffset(element) : 0;
    renderPromptEditor(element, String(node.prompt || ""), references, mediaInputs);
    lastRenderedReferences.current = referencesKey;
    if (focused) setEditorCaret(element, caret);
  }, [node.prompt, referencesKey]);

  function setConfig(key: string, value: unknown) {
    const preset = state.params.find(param => param.key === key)?.valueDefaults?.[String(value)];
    actions.update(node.id, { config: { ...config, ...preset, [key]: value } });
  }

  function updateMention(value: string, caret: number) {
    const before = value.slice(0, caret);
    const start = before.lastIndexOf("@");
    if (start < 0 || (start > 0 && /[\w.@]/.test(before[start - 1] || ""))) return setMention(null);
    const query = before.slice(start + 1);
    if (/[\s@，。！？、,]/.test(query)) return setMention(null);
    // 文件名里的点不是句子结尾：只要还有候选名接得上，选择列表就继续开着。
    if (/[.;:]/.test(query) && !candidates.some((item) =>
      item.name.toLocaleLowerCase().startsWith(query.toLocaleLowerCase()))) return setMention(null);
    if (references.some((item) => item.alias === query)) return setMention(null);
    setMention({ query, start, end: caret, index: 0 });
  }

  const smartTargets = inputLabels
    .filter((item) => item.number > 0)
    .map((item) => ({
      nodeId: item.nodeId,
      kind: item.kind,
      number: item.number,
      alias: references.find((reference) => reference.nodeId === item.nodeId)?.alias || "",
    }));
  const smartMatches = findSmartReferences(String(node.prompt || ""), smartTargets);

  async function applySmartReferences() {
    const element = promptRef.current;
    if (!element || !smartMatches.length) return;
    // 转换是一次成批改写，记一步撤销；逐字输入本来就不进历史，这里单独补上。
    recordCanvasHistory(t("canvas.composer.smartReference"));
    let text = editorPrompt(element);
    for (const match of [...smartMatches].sort((left, right) => right.start - left.start)) {
      const result = await actions.insertReferenceMention(node.id, match.nodeId, text, match.start, match.end);
      if (result) text = result.prompt;
    }
    requestAnimationFrame(() => {
      const current = promptRef.current;
      if (!current) return;
      current.focus();
      setEditorCaret(current, text.length);
    });
  }

  const [optimizer, setOptimizer] = useState<{
    open: boolean;
    mode: OptimizerMode;
    busy: boolean;
    draft: string;
    result: OptimizerResult | null;
    error: string;
  }>({ open: false, mode: "expand", busy: false, draft: "", result: null, error: "" });
  const optimizerAbort = useRef<AbortController | null>(null);

  async function runOptimizer(mode: OptimizerMode) {
    optimizerAbort.current?.abort();
    const controller = new AbortController();
    optimizerAbort.current = controller;
    setOptimizer((current) => ({ ...current, mode, busy: true, error: "" }));
    try {
      const result = await optimizePrompt({
        prompt: String(node.prompt || ""),
        mode,
        signal: controller.signal,
        targetModel: String(node.model || ""),
        generationType: (["image", "video", "audio", "text"].includes(kind) ? kind : "image") as "image" | "video" | "audio" | "text",
        references: inputLabels
          .filter((item) => item.number > 0)
          .map((item) => ({ kind: item.kind, name: String(item.input.name || "") })),
      });
      if (controller.signal.aborted) return;
      setOptimizer((current) => ({ ...current, busy: false, result, draft: result.prompt }));
    } catch (error) {
      if (controller.signal.aborted) return;
      setOptimizer((current) => ({ ...current, busy: false, error: (error as Error)?.message || "" }));
    }
  }

  function openOptimizer() {
    setOptimizer((current) => ({ ...current, open: true, error: "", result: null, draft: String(node.prompt || "") }));
    void runOptimizer("expand");
  }

  function closeOptimizer() {
    optimizerAbort.current?.abort();
    optimizerAbort.current = null;
    setOptimizer((current) => ({ ...current, open: false, busy: false }));
  }

  function adoptOptimizerResult() {
    if (!optimizer.draft.trim()) return;
    recordCanvasHistory(t("canvas.optimizer.title"));
    actions.update(node.id, { prompt: optimizer.draft });
    closeOptimizer();
  }

  async function chooseMention(sourceId: string) {
    const element = promptRef.current;
    if (!mention || !element) return;
    const { start, end } = mention;
    const draft = editorPrompt(element);
    setMention(null);
    const result = await actions.insertReferenceMention(node.id, sourceId, draft, start, end);
    if (!result) return;
    requestAnimationFrame(() => {
      const element = promptRef.current;
      if (!element) return;
      // The layout effect renders the updated references and media inputs. This
      // callback captures the old canvas view data, so only restore focus and caret.
      element.focus();
      setEditorCaret(element, result.caret);
    });
  }

  return (
    <div
      className="work-composer nodrag nopan nowheel"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="work-composer-row">
        {node.type === "imageGeneration" && selectedPreset && (
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
                <div className="preset-menu-scroll">
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
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          className="work-smart-reference"
          disabled={!String(node.prompt || "").trim()}
          title={t("canvas.optimizer.title")}
          onClick={openOptimizer}
        >
          {t("canvas.optimizer.action")}
        </button>
        {smartTargets.length > 0 && (
          <button
            type="button"
            className="work-smart-reference"
            disabled={!smartMatches.length}
            title={t("canvas.composer.smartReferenceHint")}
            onClick={() => void applySmartReferences()}
          >
            {t("canvas.composer.smartReference")}
            {smartMatches.length ? ` (${smartMatches.length})` : ""}
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
                label={slot === "firstFrame" ? t("ui.CanvasNodeToolbar.label.f19f6b6d") : t("ui.CanvasNodeToolbar.label.35b12241")}
                onRemove={() => actions.removeIncomingEdge(node.id, input.edgeId)}
              />
            ) : (
              <button
                key={slot}
                type="button"
                className="work-composer-add work-composer-slot nodrag nopan"
                title={t("ui.GenerationNodeComposer.text.802ee9f7", { value0: slot === "firstFrame" ? t("ui.CanvasNodeToolbar.label.f19f6b6d") : t("ui.CanvasNodeToolbar.label.35b12241") })}
                onClick={() => void actions.addReference(node.id, slot)}
              >
                <IconSymbol name="plus" />
                <span>{slot === "firstFrame" ? t("ui.CanvasNodeToolbar.label.f19f6b6d") : t("ui.CanvasNodeToolbar.label.35b12241")}</span>
              </button>
            );
          }) : mediaInputs.map((input) => (
            <ComposerInputThumbnail
              key={input.edgeId}
              input={input}
              number={inputLabels.find((item) => item.nodeId === input.nodeId)?.number}
              label={generationMediaKind(input) === "image" ? undefined : generationInputLabel(input)}
              onRemove={() => actions.removeIncomingEdge(node.id, input.edgeId)}
            />
          ))}
          {!fixedImageSlots.length && activeInputMode && mediaInputs.length < (activeInputMode.maxImages + activeInputMode.maxVideos + activeInputMode.maxAudios) && (
            <button
              type="button"
              className="work-composer-add nodrag nopan"
              title={t("ui.canvasAdapter.text.c65f9eb1")}
              onClick={() => void actions.addReference(node.id)}
            >
              <IconSymbol name="plus" />
            </button>
          )}
        </div>
        <div
          ref={promptRef}
          className="work-prompt-editor"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={kind === "text" ? t("ui.GenerationNodeComposer.text.5e562b19") : kind === "audio" ? t("ui.GenerationNodeComposer.text.ba131651") : t("ui.GenerationNodeComposer.text.42b7e53a")}
          data-placeholder={kind === "text"
            ? t("ui.GenerationNodeComposer.text.5e562b19")
            : kind === "audio"
              ? t("ui.GenerationNodeComposer.text.ba131651")
              : t("ui.GenerationNodeComposer.text.42b7e53a")}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={(event) => {
            composing.current = false;
            const value = editorPrompt(event.currentTarget);
            actions.update(node.id, { prompt: value });
            updateMention(value, editorCaretOffset(event.currentTarget));
          }}
          onInput={(event) => {
            if (composing.current) return;
            const value = editorPrompt(event.currentTarget);
            actions.update(node.id, { prompt: value });
            updateMention(value, editorCaretOffset(event.currentTarget));
          }}
          onClick={(event) => updateMention(editorPrompt(event.currentTarget), editorCaretOffset(event.currentTarget))}
          onBlur={(event) => {
            setMention(null);
            renderPromptEditor(event.currentTarget, editorPrompt(event.currentTarget), references, mediaInputs);
          }}
          onKeyDown={(e) => {
            if (mention && !isImeKeyEvent(e.nativeEvent)) {
              if (e.key === "Escape") {
                e.preventDefault();
                setMention(null);
                return;
              }
              if (mentionOptions.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                e.preventDefault();
                setMention({ ...mention, index: (mention.index + (e.key === "ArrowDown" ? 1 : -1) + mentionOptions.length) % mentionOptions.length });
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (mentionOptions.length) void chooseMention(mentionOptions[mention.index]?.id || mentionOptions[0]?.id || "");
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey && !isImeKeyEvent(e.nativeEvent)) {
              e.preventDefault();
              actions.run(node.id);
            }
          }}
        ></div>
        {mention && (
          <div className="work-reference-mention-menu" role="listbox" aria-label={t("ui.GenerationNodeComposer.arialabel.114587bd")}>
            {mentionGroups.length ? mentionGroups.map((group) => (
              <div className="work-reference-mention-group" key={group.id}>
                <p className="work-reference-mention-title">{group.label}</p>
                {group.items.map((item) => {
                  const index = mentionOptions.indexOf(item);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={index === mention.index}
                      className={index === mention.index ? "active" : ""}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => void chooseMention(item.id)}
                    >
                      <ReferenceMentionThumb candidate={item} />
                      <span className="work-reference-mention-name" title={item.name}>{item.name}</span>
                    </button>
                  );
                })}
              </div>
            )) : <p className="work-reference-mention-empty">{t("ui.GenerationNodeComposer.text.1dbf26b6")}</p>}
          </div>
        )}
      </div>
      <div className="work-param-row">
        <div className="work-param-controls">
        <div className="work-model-picker">
          <button
            className="work-model-trigger"
            type="button"
            title={t("ui.GenerationNodeComposer.title.d2757972")}
            onClick={() => setOpenMenu(openMenu === "model" ? "" : "model")}
          >
            <ProviderBrandIcon className="model-logo" icon={generationModelIcon(selectedModel)} />
            <span>{getModelInfo(selectedModel)?.name || selectedModel || t("ui.GenerationNodeComposer.text.4e769dd2")}</span>
            <IconSymbol name="chevron-down" />
          </button>
          {openMenu === "model" && (
            <div className="model-menu">
              <p>{t("ui.GenerationNodeComposer.title.d2757972")}</p>
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
                          getModelSchema(node.type, model).params.map(toGenerationConfigParam),
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
                    <ProviderBrandIcon className="model-logo" icon={generationModelIcon(model)} />
                    <span className="model-copy">
                      <strong>{getModelInfo(model)?.name || model}</strong>
                      <em>{generationModelDescription(model, node.type)}</em>
                    </span>
                    {model === selectedModel && <IconSymbol name="check" />}
                  </button>
                ))
              ) : (
                <div className="model-menu-empty">{t("ui.GenerationNodeComposer.text.28c223e1")}</div>
              )}
            </div>
          )}
        </div>
        <div className="generation-settings-picker">
          <button
            type="button"
            className={`generation-settings-trigger${openMenu === "generationSettings" ? " active" : ""}`}
            title={t("ui.GenerationNodeComposer.title.8da679fb")}
            onClick={() => setOpenMenu(openMenu === "generationSettings" ? "" : "generationSettings")}
          >
            {activeInputMode && <span>{activeInputMode.label}</span>}
            {summaryParams.slice(0, 4).map((param) => (
              <span key={param.key}>
                {paramSummary(param, config[param.key] ?? param.default)}
              </span>
            ))}
            <IconSymbol name="chevron-down" />
          </button>
          {openMenu === "generationSettings" && (
            <GenerationSettingsPanel
              nodeId={node.id}
              state={state}
              actions={actions}
              onConfigChange={setConfig}
            />
          )}
        </div>
        {node.type === "imageGeneration" && (
          <button
            type="button"
            className={`work-camera-btn${cameraControlEnabled ? " active" : ""}`}
            title={
              cameraControlEnabled
                ? `${activeCameraConfig.camera} · ${activeCameraConfig.lens} · ${activeCameraConfig.focalLength} · ${activeCameraConfig.aperture}`
                : t("ui.GenerationNodeComposer.text.6ab25245")
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
            <span>{cameraControlEnabled ? activeCameraConfig.focalLength : t("ui.CameraControlPanel.label.c7d1925f")}</span>
          </button>
        )}
        </div>
        <button
          className={`work-run-btn${busy ? " running" : ""}`}
          disabled={busy}
          title={busy ? t("ui.GenerationNodeComposer.text.5f57664c") : t("ui.GenerationNodeComposer.text.6793e8ac")}
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

      <Modal
        title={t("canvas.optimizer.title")}
        open={optimizer.open}
        onCancel={closeOptimizer}
        width={640}
        footer={[
          <button key="cancel" type="button" className="button ghost" onClick={closeOptimizer}>
            {t("canvas.optimizer.cancel")}
          </button>,
          <button key="retry" type="button" className="button ghost" disabled={optimizer.busy} onClick={() => void runOptimizer(optimizer.mode)}>
            {t("canvas.optimizer.retry")}
          </button>,
          <button key="adopt" type="button" className="button primary" disabled={optimizer.busy || !optimizer.draft.trim()} onClick={adoptOptimizerResult}>
            {t("canvas.optimizer.adopt")}
          </button>,
        ]}
      >
        <Segmented
          value={optimizer.mode}
          onChange={(value) => void runOptimizer(value as OptimizerMode)}
          options={OPTIMIZER_MODES.map((mode) => ({ value: mode, label: t(OPTIMIZER_MODE_LABELS[mode]) }))}
        />
        {optimizer.busy && <p className="optimizer-hint">{t("canvas.optimizer.running")}</p>}
        {optimizer.error && <p className="optimizer-hint">{t("canvas.optimizer.failed")}</p>}
        {optimizer.result && (
          <>
            {!optimizer.result.structured && <p className="optimizer-hint">{t("canvas.optimizer.unstructured")}</p>}
            <AntInput.TextArea
              value={optimizer.draft}
              onChange={(event) => setOptimizer((current) => ({ ...current, draft: event.target.value }))}
              autoSize={{ minRows: 4, maxRows: 10 }}
              aria-label={t("canvas.optimizer.title")}
            />
            {optimizer.result.avoid.length > 0 && <p className="optimizer-hint">{t("canvas.optimizer.avoid")}：{optimizer.result.avoid.join("；")}</p>}
            {optimizer.result.notes.length > 0 && <p className="optimizer-hint">{t("canvas.optimizer.notes")}：{optimizer.result.notes.join("；")}</p>}
            {optimizer.result.assumptions.length > 0 && <p className="optimizer-hint">{t("canvas.optimizer.assumptions")}：{optimizer.result.assumptions.join("；")}</p>}
            {optimizer.result.alternatives.length > 0 && <p className="optimizer-hint">{t("canvas.optimizer.alternatives")}：{optimizer.result.alternatives.join("；")}</p>}
          </>
        )}
      </Modal>
    </div>
  );
}
