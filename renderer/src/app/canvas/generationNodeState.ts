import { t } from '@/i18n';
import { isActiveTaskStatus } from '../../domain/tasks/TaskStatus';
import { createNodeMediaCatalog, localMediaPath } from "../../utils/nodeMedia.ts";
import {
  getGenerationInputModes,
  getModelInfo,
  getModelModeConfig,
  getModelSchema,
  getTypeMeta,
  resolveModeIdForInputMode,
  type ModelSchema,
} from "../../domain/catalog/ModelCatalog";
import { findProviderAdapter } from "../../domain/provider/adapters";
import { resolveProviderIconId } from "../../domain/provider/ProviderBrandIcons.ts";
import { DEFAULT_CAMERA_CONFIG, normalizeCameraConfig } from "../../utils/cameraConfig.ts";
import { getImageStylePreset } from "../../utils/imageStylePresets.ts";
import { modelTraitNote, modelTypeLabel, paramPresentation } from "../../utils/modelPresentation.ts";
import { textNodeContent } from "../../utils/textNodeContent.ts";
import { type GenerationConfigParam } from "../../domain/graph/GenerationNodeContract";
import type { WorkflowIncomingInput, WorkflowNodeData } from "./WorkflowCanvas";
import { generationMediaKind } from "./generationNodeMedia";

export interface GenerationOutput {
  id: string;
  title?: string;
  selected?: boolean;
  resourceType?: string;
  mimeType?: string;
  fileName?: string;
  filePath?: string;
  path?: string;
  previewUrl?: string;
  url?: string;
  content?: string;
}

export type GenerationSchemaParam = ModelSchema["params"][number];

const emptySchema: ModelSchema = { models: [], params: [] };
export const MAX_TEXT_PREVIEW_CHARS = 6000;

/**
 * 用户把手上的文件放进节点，而不是模型生成出来的结果。
 * 这三类来源的节点内容就是那个文件本身，没有"改提示词再生成一次"的语义，
 * 所以节点下方的输入面板不出现。
 * 裁剪/标注/宫格/截帧/导演台/拼接是对已有素材的加工产物，对话产物是 Agent 的中间结果，
 * 它们都还要在节点上继续写提示词，因此不在这个集合里。
 */
const uploadedResourceSourceTypes = new Set(["canvas-upload", "node-upload", "material-library"]);

/**
 * 目录条目的 presentation 是可选键，值也可能是 undefined；
 * 配置契约只接受有值的可选键，所以缺失时不写出该键。
 */
export function toGenerationConfigParam(param: GenerationSchemaParam): GenerationConfigParam {
  const { presentation, ...rest } = param;
  return {
    ...rest,
    ...(presentation === undefined ? {} : { presentation }),
  };
}

export function generationModelIcon(modelId: string) {
  const providerId = String(getModelInfo(modelId)?.provider || "");
  return resolveProviderIconId(
    providerId,
    modelId,
    findProviderAdapter(providerId)?.iconId || "",
  );
}

/**
 * 模型下拉里的一行说明：厂商名与接口路径逐字段取自模型目录，
 * 只有观感描述是手写文案。曾经按模型 ID 猜厂商，把 openai.json 里的
 * gpt-image 系列说成了 StarRouter。
 */
export function generationModelDescription(modelId: string, nodeType = "") {
  const info = getModelInfo(modelId);
  const providerId = String(info?.provider || "");
  const providerName = providerId ? findProviderAdapter(providerId)?.name || providerId : "";
  const path = String(getModelModeConfig(modelId)?.endpoint?.path || "");
  const facts = [providerName, path].filter(Boolean).join(" ");
  const trait = modelTraitNote(modelId);
  if (facts && trait) return `${facts} · ${trait}`;
  return facts || trait || t("ui.generationNodeState.text.1b285687", { value0: modelTypeLabel(String(info?.type || nodeType || "")) });
}

export function generationNodeDisplayTitle(
  node: WorkflowNodeData,
  output: GenerationOutput | null,
  uploaded: Record<string, unknown> | null,
  typeLabel: string,
) {
  const titleOverride = String(node.titleOverride || "").trim();
  if (titleOverride) return titleOverride;
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
  return typeLabel.replace(/生成$/, "") || t("ui.generationNodeState.text.e840cd6f");
}

/**
 * 节点渲染的每个派生值都只有一份来源：媒体体、输入面板和参数面板共用这一份结果，
 * 避免同一个字段在不同子组件里按不同规则重算。
 */
export function generationNodeState(
  node: WorkflowNodeData,
  selected: boolean,
  incomingInputs: WorkflowIncomingInput[],
) {
  const media = createNodeMediaCatalog();
  const outputs = media.outputs(node) as GenerationOutput[];
  const selectedOutput = outputs.length ? media.selected(node) as GenerationOutput : null;
  const uploaded =
    node.uploadedFile && typeof node.uploadedFile === "object"
      ? (node.uploadedFile as Record<string, unknown>)
      : null;
  const outputKind = selectedOutput
    ? generationMediaKind(selectedOutput as unknown as Record<string, unknown>)
    : "";
  const uploadKind = uploaded ? generationMediaKind(uploaded) : "";
  const active = (selectedOutput || uploaded) as unknown as Record<string, unknown> | null;
  const activeKind = selectedOutput ? outputKind : uploadKind;
  // 生成结果优先：节点一旦有了模型产物就不再是"纯上传资源"，输入面板照常出现。
  const uploadedResource = !selectedOutput && Boolean(uploaded)
    && uploadedResourceSourceTypes.has(String(node.sourceType || uploaded?.source || ""));
  const activeFilePath = localMediaPath(active);
  const activeFileName = String(
    selectedOutput?.fileName || uploaded?.name || node.title ||
      (activeKind === "video" ? "video.mp4" : "image.png"),
  );
  const annotatedPreviewPath = String((node as Record<string, unknown>).annotationImagePath || "");
  const annotatedPreviewUrl = String((node as Record<string, unknown>).annotationImageUrl || "");
  const previewItem = annotatedPreviewPath || annotatedPreviewUrl
    ? { ...(active || {}), filePath: annotatedPreviewPath, previewUrl: annotatedPreviewUrl }
    : active;
  const kind = node.type.replace("Generation", "");
  const meta = getTypeMeta(node.type);
  const busy = isActiveTaskStatus(node.status);
  const metaLabel = String(meta.label || node.type);
  const metaIcon = String(meta.icon || "spark");
  const displayTitle = generationNodeDisplayTitle(node, selectedOutput, uploaded, metaLabel);
  const schema = selected
    ? getModelSchema(
        node.type,
        String(node.model || ""),
        resolveModeIdForInputMode(String(node.model || ""), String(node.inputMode || "")),
      )
    : emptySchema;
  const config =
    node.config && typeof node.config === "object" ? (node.config as Record<string, unknown>) : {};
  const models = (
    Array.isArray(node.availableModels) ? node.availableModels : schema.models || []
  ) as string[];
  const params = (schema.params || []).filter(
    (param: GenerationSchemaParam) =>
      param.key !== "prompt" &&
      param.key !== "model" &&
      paramPresentation(param).control !== "hidden" &&
      (!param.visibleWhen ||
        Object.entries(param.visibleWhen).every(([key, value]) => config[key] === value)),
  );
  const explicitSummaryParams = params.filter((param) => paramPresentation(param).summary === true);
  // A numeric control's bounds do not opt the model out of the default summary.
  const hasExplicitSummary = params.some((param) => typeof paramPresentation(param).summary === "boolean");
  const summaryParams = hasExplicitSummary ? explicitSummaryParams : params.slice(0, 4);
  const selectedModel = String(node.model || models[0] || "");
  const inputModes = getGenerationInputModes(selectedModel);
  const activeInputMode = inputModes.find((item) => item.value === node.inputMode) || inputModes[0] || null;
  const mediaInputs = incomingInputs.filter((input) => input.inputRole !== "textContext");
  const fixedImageSlots = activeInputMode?.value === "firstLastFrame"
    ? ["firstFrame", "lastFrame"]
    : activeInputMode?.value === "firstFrame" ? ["firstFrame"] : [];
  const selectedPreset = getImageStylePreset(config.stylePresetId);
  const activeCameraConfig = normalizeCameraConfig(
    config.cameraConfig || DEFAULT_CAMERA_CONFIG,
  ) as Record<string, string>;
  const cameraControlEnabled = Boolean(config.cameraControl && config.cameraConfig);
  const textContent = textNodeContent({ ...node, generatedOutputs: outputs });
  const textPreview =
    textContent.length > MAX_TEXT_PREVIEW_CHARS
      ? t("ui.generationNodeState.text.b25045d7", { value0: textContent.slice(0, MAX_TEXT_PREVIEW_CHARS) })
      : textContent;
  return {
    outputs,
    selectedOutput,
    uploaded,
    uploadedResource,
    active,
    activeKind,
    activeFilePath,
    activeFileName,
    previewItem,
    kind,
    metaIcon,
    metaLabel,
    busy,
    displayTitle,
    config,
    models,
    params,
    summaryParams,
    selectedModel,
    inputModes,
    activeInputMode,
    mediaInputs,
    fixedImageSlots,
    selectedPreset,
    activeCameraConfig,
    cameraControlEnabled,
    textContent,
    textPreview,
  };
}

export type GenerationNodeState = ReturnType<typeof generationNodeState>;
