import type { CatalogModel } from "../catalog/ModelCatalog";

const ALLOWED_INPUT_SLOTS = new Set([
  "reference",
  "firstFrame",
  "lastFrame",
  "inputVideo",
  "referenceAudio",
]);
const ALLOWED_PARAM_TYPES = new Set(["string", "number", "boolean", "select"]);
const ALLOWED_POLL_STATES = new Set(["running", "completed", "failed"]);

function validateParamList(
  params: CatalogModel["modes"][number]["params"],
  requestTemplate: unknown,
  label: string,
) {
  if (!Array.isArray(params)) throw new Error(`${label} 的 params 必须是数组`);
  const keys = new Set<string>();
  const serializedTemplate = JSON.stringify(requestTemplate) ?? "";
  for (const [index, param] of params.entries()) {
    const paramLabel = `${label} 的第 ${index + 1} 个参数`;
    if (!param || typeof param !== "object" || !param.key || !param.label) {
      throw new Error(`${paramLabel} 缺少 key 或 label`);
    }
    if (keys.has(param.key))
      throw new Error(`${label} 的参数 ${param.key} 重复`);
    keys.add(param.key);
    if (!ALLOWED_PARAM_TYPES.has(param.type)) {
      throw new Error(
        `${paramLabel} type 只能是 string、number、boolean 或 select，不能是 ${String(param.type)}`,
      );
    }
    if (param.numeric !== undefined && typeof param.numeric !== "boolean") {
      throw new Error(
        `${paramLabel} 的 numeric 只能是布尔值，不能用对象描述 min/max`,
      );
    }
    if (param.type === "number" && param.numeric !== true) {
      throw new Error(`${paramLabel} 是 number，必须填写 numeric:true`);
    }
    if (
      param.options !== undefined &&
      (!Array.isArray(param.options) || !param.options.length)
    ) {
      throw new Error(`${paramLabel} 的 options 必须是非空数组`);
    }
    if (param.type === "select" && !param.options?.length) {
      throw new Error(`${paramLabel} 是 select，必须提供非空 options`);
    }
    if (!serializedTemplate.includes(`{{params.${param.key}}}`)) {
      throw new Error(`${paramLabel} 未在 requestTemplate 中使用`);
    }
  }

  for (const match of serializedTemplate.matchAll(/\{\{params\.([^}]+)\}\}/g)) {
    if (!keys.has(match[1])) {
      throw new Error(
        `${label} 的 requestTemplate 引用了未声明参数 ${match[1]}`,
      );
    }
  }
}

function validateOutputConstraints(
  constraints: CatalogModel["modes"][number]["outputConstraints"],
  label: string,
) {
  if (
    !constraints ||
    typeof constraints !== "object" ||
    Array.isArray(constraints)
  ) {
    throw new Error(`${label} 的 outputConstraints 必须是对象`);
  }
  if (constraints.durations !== undefined) {
    if (
      !Array.isArray(constraints.durations) ||
      constraints.durations.some(
        (value) => !Number.isFinite(value) || value <= 0,
      )
    ) {
      throw new Error(
        `${label} 的 outputConstraints.durations 必须是正数数组，不能写成 min/max 对象`,
      );
    }
  }
  if (
    constraints.formats !== undefined &&
    (!Array.isArray(constraints.formats) ||
      constraints.formats.some((value) => typeof value !== "string" || !value))
  ) {
    throw new Error(
      `${label} 的 outputConstraints.formats 必须是非空字符串数组`,
    );
  }
}

/** 校验用户粘贴的声明式协议，避免无法渲染或无法选择的配置进入目录。 */
export function validateModelProtocol(
  model: CatalogModel,
  position = "当前模型",
) {
  if (
    !Array.isArray(model.modes) ||
    !model.modes.some((mode) => mode?.id === model.defaultMode)
  ) {
    throw new Error(`${position} ${model.id} 的 defaultMode 没有对应的 mode`);
  }

  const selectionModes = new Set<string>();
  for (const [modeIndex, mode] of model.modes.entries()) {
    if (!mode || typeof mode !== "object" || Array.isArray(mode)) {
      throw new Error(
        `${position} ${model.id} 的第 ${modeIndex + 1} 个 mode 必须是对象`,
      );
    }
    const label = `${position} ${model.id}/${mode.id || "<missing mode>"}`;
    if (
      !mode.id ||
      !mode.endpoint?.path ||
      !mode.endpoint?.method ||
      mode.requestTemplate === undefined
    ) {
      throw new Error(`${label} 缺少 mode id、endpoint 或 requestTemplate`);
    }
    if (
      mode.inputFormat &&
      mode.inputFormat !== "json" &&
      mode.inputFormat !== "multipart"
    ) {
      throw new Error(`${label} 的 inputFormat 只能是 json 或 multipart`);
    }
    if (mode.endpoint.scope === "v1" && mode.endpoint.path.startsWith("/v1")) {
      throw new Error(`${label} 同时使用 scope:v1 和 /v1 路径，会组成重复地址`);
    }

    validateParamList(mode.params, mode.requestTemplate, label);
    validateOutputConstraints(mode.outputConstraints, label);

    const serializedTemplate = JSON.stringify(mode.requestTemplate) ?? "";
    if (
      mode.requestFields?.imageContentType === "inlineData" &&
      serializedTemplate.includes("{{content}}")
    ) {
      throw new Error(
        `${label} 不能用 imageContentType:inlineData 配合 {{content}}；Gemini 原生图片必须使用 imageContentFormat:google-inline 和 inlineImage 变量`,
      );
    }
    if (serializedTemplate.includes("{{inlineImage.")) {
      if (mode.requestFields?.imageContentFormat !== "google-inline") {
        throw new Error(
          `${label} 使用 inlineImage 时必须填写 requestFields.imageContentFormat:google-inline`,
        );
      }
      if (!mode.inputConstraints?.images?.min) {
        throw new Error(`${label} 使用 inlineImage 时必须声明图片输入约束`);
      }
    }

    for (const [kind, constraint] of Object.entries(
      mode.inputConstraints || {},
    )) {
      if (
        !constraint ||
        typeof constraint !== "object" ||
        !("min" in constraint) ||
        !("max" in constraint)
      )
        continue;
      const min = Number(constraint.min);
      const max = Number(constraint.max);
      if (
        !Number.isFinite(min) ||
        !Number.isFinite(max) ||
        min < 0 ||
        max < min
      ) {
        throw new Error(
          `${label} 的 ${kind} 数量范围无效：min ${String(constraint.min)}、max ${String(constraint.max)}`,
        );
      }
    }

    if (mode.inputSlots !== undefined && !Array.isArray(mode.inputSlots)) {
      throw new Error(`${label} 的 inputSlots 必须是字符串数组`);
    }
    if (
      mode.inputVariants !== undefined &&
      !Array.isArray(mode.inputVariants)
    ) {
      throw new Error(`${label} 的 inputVariants 必须是数组`);
    }
    const semanticModes = [
      { inputMode: mode.inputMode, inputSlots: mode.inputSlots },
    ];
    for (const variant of mode.inputVariants || []) {
      if (!variant || typeof variant !== "object" || Array.isArray(variant)) {
        throw new Error(`${label} 的 inputVariants 项必须是对象`);
      }
      if (!Array.isArray(variant.inputSlots)) {
        throw new Error(
          `${label} 的 inputVariants.${variant.inputMode || "<missing>"}.inputSlots 必须是字符串数组`,
        );
      }
      const rawVariant = variant as typeof variant & Record<string, unknown>;
      const transportFields = [
        "endpoint",
        "inputFormat",
        "requestTemplate",
        "auth",
        "taskEndpoint",
        "resultTextPath",
        "resultUrlPath",
        "resultBase64Path",
        "resultHexPath",
        "resultMimeType",
        "resultFileExtension",
        "resultBody",
        "resultEndpoint",
      ];
      const misplaced = transportFields.find(
        (key) => rawVariant[key] !== undefined,
      );
      if (misplaced) {
        throw new Error(
          `${label} 的 inputVariants 不能覆盖 ${misplaced}；不同传输协议必须拆成独立 mode`,
        );
      }
      semanticModes.push(variant);
    }
    for (const semanticMode of semanticModes) {
      if (
        semanticMode.inputSlots?.some((slot) => !ALLOWED_INPUT_SLOTS.has(slot))
      ) {
        throw new Error(
          `${label} 的 inputSlots 必须是合法的字符串数组，不能填写 role 对象`,
        );
      }
      if (!semanticMode.inputMode && model.type === "textGeneration") continue;
      const selectionKey = semanticMode.inputMode || "no-media-input";
      if (selectionModes.has(selectionKey)) {
        throw new Error(
          `${label} 重复声明输入模式 ${selectionKey}；不能仅按 URL/Base64 或 API 家族拆分不可选择的 mode`,
        );
      }
      selectionModes.add(selectionKey);
    }

    if (
      mode.pollStatusMap &&
      Object.values(mode.pollStatusMap).some(
        (status) => !ALLOWED_POLL_STATES.has(status),
      )
    ) {
      throw new Error(
        `${label} 的 pollStatusMap 只能映射为 running、completed 或 failed`,
      );
    }
    if (
      mode.isAsync &&
      (!mode.taskEndpoint?.path ||
        !mode.taskIdPath ||
        !mode.statusPath ||
        !mode.pollStatusMap)
    ) {
      throw new Error(
        `${label} 是异步接口，缺少 taskEndpoint、taskIdPath、statusPath 或 pollStatusMap`,
      );
    }

    const hasTextResult = Boolean(mode.resultTextPath);
    const hasMediaResult = Boolean(
      mode.resultUrlPath ||
      mode.resultBase64Path ||
      mode.resultHexPath ||
      mode.resultBody ||
      mode.resultEndpoint?.path,
    );
    if (mode.resultBody) {
      if (mode.isAsync)
        throw new Error(
          `${label} 的 resultBody 只能描述提交接口直接返回的二进制内容`,
        );
      if (
        mode.resultBody.encoding !== "binary" ||
        !mode.resultBody.mimeType ||
        !mode.resultBody.fileExtension
      ) {
        throw new Error(
          `${label} 的 resultBody 缺少 encoding:binary、mimeType 或 fileExtension`,
        );
      }
    }
    if (
      mode.resultHexPath &&
      (!mode.resultMimeType || !mode.resultFileExtension)
    ) {
      throw new Error(
        `${label} 的 Hex 结果必须声明 resultMimeType 和 resultFileExtension`,
      );
    }
    if (mode.resultEndpoint) {
      if (!mode.isAsync)
        throw new Error(
          `${label} 的 resultEndpoint 目前只用于异步任务完成后的二进制下载`,
        );
      if (
        !mode.resultEndpoint.method ||
        !mode.resultEndpoint.path ||
        !mode.resultEndpoint.scope ||
        !mode.resultEndpoint.mimeType ||
        !mode.resultEndpoint.fileExtension
      ) {
        throw new Error(
          `${label} 的 resultEndpoint 缺少 method、path、scope、mimeType 或 fileExtension`,
        );
      }
    }
    if (model.type === "textGeneration" && !hasTextResult) {
      throw new Error(`${label} 缺少 resultTextPath`);
    }
    if (model.type !== "textGeneration" && !hasMediaResult) {
      throw new Error(`${label} 缺少媒体结果来源`);
    }

    if (mode.inputFormat !== "multipart") continue;
    const constraints = mode.inputConstraints || {};
    const fields = mode.requestFields || {};
    if ((constraints.images?.max || 0) > 0 && !fields.multipartImage) {
      throw new Error(
        `${label} 是 multipart 图片接口，但缺少 requestFields.multipartImage`,
      );
    }
    if ((constraints.videos?.max || 0) > 0 && !fields.multipartVideo) {
      throw new Error(
        `${label} 是 multipart 视频接口，但缺少 requestFields.multipartVideo`,
      );
    }
    if ((constraints.audios?.max || 0) > 0 && !fields.multipartAudio) {
      throw new Error(
        `${label} 是 multipart 音频接口，但缺少 requestFields.multipartAudio`,
      );
    }
  }
}
