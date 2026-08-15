import { getBuiltInAdapterTemplates } from "@/domain/catalog/ModelCatalog";
import { buildCustomCatalogModels } from "@/domain/provider/CustomModelCatalog";
import {
  parseProtocolAdapterPackage,
  type ProviderModelBinding,
  type ProviderModelType,
  type ProviderProtocolAdapter,
} from "@/domain/provider/ProviderAdapterContract";
import type { ProviderConfig } from "@/domain/provider/ProviderRegistry";
import { saveAppSettings, settingsStore } from "@/store/settingsStore";
import { clonePlainData } from "@/utils/plainDataClone.mjs";
import { registerAgentTool } from "../core/toolRegistry";
import type { JsonObject, JsonSchema } from "../core/types";

interface ProviderSetupInput extends JsonObject {
  providerId: string;
  settingsRevision: string;
  providerConfig?: JsonObject;
  protocolAdapters?: JsonObject[];
  modelBindings: JsonObject[];
  replaceExistingProtocols?: boolean;
  replaceExistingBindings?: boolean;
}

const MODEL_TYPES: ProviderModelType[] = [
  "textGeneration",
  "imageGeneration",
  "videoGeneration",
  "audioGeneration",
];
const INPUT_MODES = [
  "reference",
  "firstFrame",
  "firstLastFrame",
  "videoExtension",
];
const INPUT_SLOTS = [
  "reference",
  "firstFrame",
  "lastFrame",
  "inputVideo",
  "referenceAudio",
];

function settingsRevision(): string {
  return String(settingsStore.updatedAt || "unsaved");
}

function publicBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.replace(/[?#].*$/, "");
  }
}

function adapterSummary(
  adapter: ProviderProtocolAdapter,
  source: string,
  includeDefinition: boolean,
) {
  return {
    id: adapter.id,
    name: adapter.name,
    type: adapter.type,
    source,
    defaultMode: adapter.defaultMode,
    modes: adapter.modes.map((mode) => ({
      id: mode.id,
      label: mode.label || mode.id,
      method: mode.endpoint.method,
      path: mode.endpoint.path,
      scope: mode.endpoint.scope || "root",
      inputFormat: mode.inputFormat || "json",
      inputMode: mode.inputMode || "",
      inputSlots: mode.inputSlots || [],
      params: mode.params.map((param) => ({
        key: param.key,
        control:
          typeof param.presentation === "object"
            ? param.presentation?.control
            : param.presentation || "",
        options: param.options || [],
      })),
      result: mode.resultEndpoint
        ? { kind: "endpoint", ...mode.resultEndpoint }
        : mode.resultBody
          ? { kind: "body", ...mode.resultBody }
          : mode.resultUrlPath ||
            mode.resultBase64Path ||
            mode.resultTextPath ||
            mode.resultHexPath ||
            "",
    })),
    ...(includeDefinition ? { definition: clonePlainData(adapter) } : {}),
  };
}

function allAdapters(customAdapters: ProviderProtocolAdapter[]) {
  const adapters = new Map<string, ProviderProtocolAdapter>();
  getBuiltInAdapterTemplates().forEach(({ adapter }) => {
    adapters.set(adapter.id, adapter);
  });
  customAdapters.forEach((adapter) => adapters.set(adapter.id, adapter));
  return adapters;
}

function parseBindings(value: JsonObject[]): ProviderModelBinding[] {
  return clonePlainData(value).map(
    (item: ProviderModelBinding, index: number) => {
      if (
        item?.kind !== "model" ||
        !item.id ||
        !item.name ||
        !MODEL_TYPES.includes(item.type) ||
        !item.adapterId
      ) {
        throw new Error(
          `第 ${index + 1} 个模型必须包含 kind:model、id、name、有效 type 和 adapterId`,
        );
      }
      return item;
    },
  );
}

function mergeSetup(input: ProviderSetupInput) {
  const providerId = String(input.providerId || "").trim();
  if (String(input.settingsRevision || "") !== settingsRevision()) {
    throw new Error("API 设置已发生变化，请重新读取厂商设置后再提交");
  }

  const providerConfigs = clonePlainData(
    settingsStore.providerConfigs,
  ) as Record<string, ProviderConfig>;
  let config = providerConfigs[providerId];
  if (!config) {
    const draft = clonePlainData(input.providerConfig || {}) as JsonObject;
    const displayName = String(draft.displayName || "").trim();
    const baseUrl = publicBaseUrl(String(draft.baseUrl || "").trim());
    if (!displayName || !baseUrl) {
      throw new Error(
        `API 厂商 “${providerId}” 尚不存在；创建时 providerConfig 必须包含 displayName 和完整 baseUrl`,
      );
    }
    try {
      const parsed = new URL(baseUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
    } catch {
      throw new Error("providerConfig.baseUrl 必须是完整的 HTTP(S) 地址");
    }
    config = {
      displayName,
      custom: true,
      apiKey: "",
      baseUrl,
      iconId: String(draft.iconId || "") || undefined,
      modelBindings: [],
      disabledModelIds: [],
    };
    providerConfigs[providerId] = config;
  }

  const proposedAdapters = input.protocolAdapters?.length
    ? parseProtocolAdapterPackage(input.protocolAdapters)
    : [];
  const builtInIds = new Set(
    getBuiltInAdapterTemplates().map(({ adapter }) => adapter.id),
  );
  const protocols = clonePlainData(
    settingsStore.protocolAdapters,
  ) as ProviderProtocolAdapter[];
  const protocolById = new Map(
    protocols.map((adapter) => [adapter.id, adapter]),
  );
  const changedProtocolIds: string[] = [];
  proposedAdapters.forEach((adapter) => {
    if (builtInIds.has(adapter.id)) {
      throw new Error(
        `协议 ${adapter.id} 与内置协议 ID 冲突；应直接引用内置协议或使用新的 ID`,
      );
    }
    const existing = protocolById.get(adapter.id);
    if (
      existing &&
      JSON.stringify(existing) !== JSON.stringify(adapter) &&
      input.replaceExistingProtocols !== true
    ) {
      throw new Error(
        `自定义协议 ${adapter.id} 已存在；确认替换时传 replaceExistingProtocols:true`,
      );
    }
    if (!existing || JSON.stringify(existing) !== JSON.stringify(adapter)) {
      changedProtocolIds.push(adapter.id);
      protocolById.set(adapter.id, adapter);
    }
  });

  const bindings = parseBindings(input.modelBindings || []);
  if (!bindings.length) throw new Error("至少需要提交一个模型 Binding");
  const currentBindings = config.modelBindings || [];
  const bindingById = new Map(
    currentBindings.map((binding) => [binding.id, binding]),
  );
  const changedBindingIds: string[] = [];
  bindings.forEach((binding) => {
    const existing = bindingById.get(binding.id);
    if (
      existing &&
      JSON.stringify(existing) !== JSON.stringify(binding) &&
      input.replaceExistingBindings !== true
    ) {
      throw new Error(
        `模型 ${binding.id} 已存在；确认更新时传 replaceExistingBindings:true`,
      );
    }
    if (!existing || JSON.stringify(existing) !== JSON.stringify(binding)) {
      changedBindingIds.push(binding.id);
      bindingById.set(binding.id, binding);
    }
  });
  config.modelBindings = [...bindingById.values()];
  const protocolAdapters = [...protocolById.values()];
  const compiled = buildCustomCatalogModels(providerConfigs, protocolAdapters)
    .filter((model) => model.provider === providerId)
    .map((model) => ({
      catalogId: model.id,
      requestModelId: model.requestModelId || model.id,
      name: model.name,
      type: model.type,
      modes: model.modes.map((mode) => mode.id),
    }));
  return {
    providerId,
    providerConfigs,
    protocolAdapters,
    changedProtocolIds,
    changedBindingIds,
    compiled,
    credentialRequired: !config.apiKey?.trim(),
  };
}

const endpointSchema: JsonSchema = {
  type: "object",
  required: ["method", "path", "scope"],
  properties: {
    method: { type: "string" },
    path: { type: "string" },
    scope: { type: "string", enum: ["root", "v1"] },
    mimeType: { type: "string" },
    fileExtension: { type: "string" },
  },
  additionalProperties: false,
};

const mediaConstraintSchema: JsonSchema = {
  type: "object",
  required: ["min", "max"],
  properties: {
    min: { type: "number" },
    max: { type: "number" },
    roles: { type: "array", items: { type: "string" } },
    formats: { type: "array", items: { type: "string" } },
    maskRequired: { type: "boolean" },
    valueFormat: { type: "string" },
    minDuration: { type: "number" },
    maxDuration: { type: "number" },
    maxTotalDuration: { type: "number" },
    maxBytes: { type: "number" },
    requiresAnyOf: { type: "array", items: { type: "string" } },
  },
  additionalProperties: false,
};

const inputConstraintsSchema: JsonSchema = {
  type: "object",
  properties: {
    images: mediaConstraintSchema,
    videos: mediaConstraintSchema,
    audios: mediaConstraintSchema,
    text: {
      type: "object",
      required: ["maxTokens"],
      properties: { maxTokens: { type: "number" } },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

const outputConstraintsSchema: JsonSchema = {
  type: "object",
  properties: {
    maxCount: { type: "number" },
    durations: { type: "array", items: { type: "number" } },
    defaultDuration: { type: "number" },
    fps: { type: "number" },
    formats: { type: "array", items: { type: "string" } },
    supportsStreaming: { type: "boolean" },
    supportsToolCalls: { type: "boolean" },
    supportsStructuredOutput: { type: "boolean" },
    maxTokens: { type: "number" },
  },
  additionalProperties: false,
};

const paramSchema: JsonSchema = {
  type: "object",
  required: ["key", "label", "type", "presentation"],
  properties: {
    key: { type: "string" },
    label: { type: "string" },
    type: { type: "string" },
    required: { type: "boolean" },
    default: {},
    numeric: { type: "boolean" },
    options: { type: "array", items: {} },
    conflictsWith: { type: "array", items: { type: "string" } },
    visibleWhen: { type: "object", additionalProperties: true },
    presentation: {
      type: "object",
      required: ["control"],
      properties: {
        control: {
          type: "string",
          enum: [
            "segmented",
            "select",
            "ratio",
            "resolution",
            "slider",
            "number",
            "toggle",
            "text",
            "hidden",
          ],
        },
        group: { type: "string" },
        summary: { type: "boolean" },
        unit: { type: "string" },
        min: { type: "number" },
        max: { type: "number" },
        step: { type: "number" },
      },
      additionalProperties: false,
    },
    optionLabels: { type: "object", additionalProperties: { type: "string" } },
  },
  additionalProperties: false,
};

const modeSchema: JsonSchema = {
  type: "object",
  required: [
    "id",
    "label",
    "endpoint",
    "inputConstraints",
    "outputConstraints",
    "params",
    "requestTemplate",
  ],
  properties: {
    id: { type: "string" },
    label: { type: "string" },
    endpoint: endpointSchema,
    taskEndpoint: endpointSchema,
    isAsync: { type: "boolean" },
    inputFormat: { type: "string", enum: ["json", "multipart"] },
    inputConstraints: inputConstraintsSchema,
    outputConstraints: outputConstraintsSchema,
    requestFields: { type: "object", additionalProperties: { type: "string" } },
    imageValueFormat: { type: "string" },
    referenceImageFormat: { type: "string" },
    pollStatusMap: { type: "object", additionalProperties: { type: "string" } },
    auth: {
      type: "object",
      required: ["type"],
      properties: {
        type: { type: "string", enum: ["bearer", "header", "none"] },
        name: { type: "string" },
        prefix: { type: "string" },
      },
      additionalProperties: false,
    },
    headers: { type: "object", additionalProperties: { type: "string" } },
    requestTemplate: {
      description:
        "最终请求 JSON；占位符必须保留为字符串，例如 {{model}}、{{prompt}}、{{messages}}、{{params.size}}",
    },
    taskIdPath: { type: "string" },
    statusPath: { type: "string" },
    progressPath: { type: "string" },
    errorPath: { type: "string" },
    resultTextPath: { type: "string" },
    resultUrlPath: { type: "string" },
    resultBase64Path: { type: "string" },
    resultHexPath: { type: "string" },
    resultMimeType: { type: "string" },
    resultFileExtension: { type: "string" },
    resultBody: {
      type: "object",
      required: ["encoding", "mimeType", "fileExtension"],
      properties: {
        encoding: { type: "string", enum: ["binary"] },
        mimeType: { type: "string" },
        fileExtension: { type: "string" },
      },
      additionalProperties: false,
    },
    resultEndpoint: endpointSchema,
    resultDownloadAuth: { type: "boolean" },
    capabilities: { type: "array", items: { type: "string" } },
    params: { type: "array", items: paramSchema },
    inputMode: { type: "string", enum: INPUT_MODES },
    inputSlots: { type: "array", items: { type: "string", enum: INPUT_SLOTS } },
    inputVariants: {
      type: "array",
      items: {
        type: "object",
        required: ["inputMode", "inputSlots", "inputConstraints"],
        properties: {
          inputMode: { type: "string", enum: INPUT_MODES },
          label: { type: "string" },
          inputSlots: {
            type: "array",
            items: { type: "string", enum: INPUT_SLOTS },
          },
          inputConstraints: inputConstraintsSchema,
          requestFields: {
            type: "object",
            additionalProperties: { type: "string" },
          },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

const adapterSchema: JsonSchema = {
  type: "object",
  required: ["kind", "id", "name", "type", "defaultMode", "modes"],
  properties: {
    kind: { type: "string", enum: ["adapter"] },
    id: { type: "string" },
    name: { type: "string" },
    type: { type: "string", enum: MODEL_TYPES },
    defaultMode: { type: "string" },
    modes: { type: "array", minItems: 1, items: modeSchema },
  },
  additionalProperties: false,
};

const setupSchema: JsonSchema = {
  type: "object",
  required: [
    "providerId",
    "settingsRevision",
    "providerConfig",
    "modelBindings",
  ],
  properties: {
    providerId: { type: "string" },
    settingsRevision: {
      type: "string",
      description: "inspect_provider_setup 返回的 settingsRevision",
    },
    providerConfig: {
      type: "object",
      description:
        "目标厂商尚不存在时创建不含密钥的连接草稿；API Key 始终由用户在设置界面填写",
      properties: {
        displayName: { type: "string" },
        baseUrl: { type: "string" },
        iconId: { type: "string" },
      },
      additionalProperties: false,
    },
    protocolAdapters: {
      type: "array",
      description:
        "仅在没有完全匹配协议时提交新 Adapter。不要复制 inspect 返回的摘要；必须使用这里声明的完整结构",
      items: adapterSchema,
    },
    modelBindings: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["kind", "id", "name", "type", "adapterId"],
        properties: {
          kind: { type: "string", enum: ["model"] },
          id: { type: "string" },
          name: { type: "string" },
          type: { type: "string", enum: MODEL_TYPES },
          adapterId: { type: "string" },
          sortOrder: { type: "number" },
          enabled: { type: "boolean" },
          defaultMode: { type: "string" },
          enabledModes: { type: "array", items: { type: "string" } },
          modeOverrides: { type: "object" },
        },
        additionalProperties: false,
      },
    },
    replaceExistingProtocols: { type: "boolean" },
    replaceExistingBindings: { type: "boolean" },
  },
  additionalProperties: false,
};

export function registerProviderSetupTools(): void {
  registerAgentTool({
    id: "inspect_provider_setup",
    title: "读取 API 厂商接入设置",
    description:
      "用户要求接入供应商或批量添加模型时先调用。返回已配置厂商（不含 API Key）、当前模型绑定和可复用协议摘要。先依据官方文档比较 endpoint、传输格式、输入语义、请求字段和结果解析；不要让用户代替 Agent 猜技术协议。protocolIds 可读取候选协议完整定义。",
    effect: "read",
    inputSchema: {
      type: "object",
      properties: {
        providerId: { type: "string" },
        modelTypes: {
          type: "array",
          items: { type: "string", enum: MODEL_TYPES },
        },
        protocolIds: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
    summarizeInput: (input) => String(input.providerId || "全部 API 厂商"),
    execute: (input) => {
      const requestedProviderId = String(input.providerId || "").trim();
      const requestedTypes = new Set(
        ((input.modelTypes as string[] | undefined) || []).map(String),
      );
      const requestedProtocolIds = new Set(
        ((input.protocolIds as string[] | undefined) || []).map(String),
      );
      const configuredProviders = settingsStore.providerConfigs as Record<
        string,
        ProviderConfig
      >;
      const providers = Object.entries(configuredProviders)
        .filter(([id]) => !requestedProviderId || id === requestedProviderId)
        .map(([id, config]) => ({
          id,
          displayName: config.displayName || id,
          baseUrl: publicBaseUrl(config.baseUrl || ""),
          credentialConfigured: Boolean(config?.apiKey?.trim()),
          modelBindings: clonePlainData(config.modelBindings || []),
          disabledModelIds: [...(config.disabledModelIds || [])],
        }));
      const providerMissing = requestedProviderId && !providers.length;

      const customAdapters = clonePlainData(
        settingsStore.protocolAdapters,
      ) as ProviderProtocolAdapter[];
      const sources = new Map<string, string>();
      getBuiltInAdapterTemplates().forEach(({ providerId, adapter }) => {
        sources.set(adapter.id, `内置 · ${providerId}`);
      });
      customAdapters.forEach((adapter) => sources.set(adapter.id, "自定义"));
      const protocols = [...allAdapters(customAdapters).values()]
        .filter(
          (adapter) => !requestedTypes.size || requestedTypes.has(adapter.type),
        )
        .filter(
          (adapter) =>
            !requestedProtocolIds.size || requestedProtocolIds.has(adapter.id),
        )
        .map((adapter) =>
          adapterSummary(
            adapter,
            sources.get(adapter.id) || "内置",
            requestedProtocolIds.has(adapter.id),
          ),
        );
      return {
        settingsRevision: settingsRevision(),
        providers,
        protocols,
        workflow: providerMissing
          ? "目标厂商尚不存在。仍需比较返回的协议；依据官方文档确定公开 base URL 后，可在 validate/apply 中传 providerConfig 创建不含密钥的厂商草稿。协议与模型可以先保存，API Key 由用户随后在设置界面填写。"
          : "根据官方文档选择完全匹配的协议；没有完全匹配项时生成新的全局 Adapter。随后先调用 validate_provider_setup，再调用 apply_provider_setup。不要凭厂商名称猜兼容协议。",
      };
    },
  });

  registerAgentTool<ProviderSetupInput>({
    id: "validate_provider_setup",
    title: "校验 API 厂商协议与模型",
    description:
      "在保存前编译整套全局 Adapter 和所有厂商 Binding，检查协议字段、参数控件、输入模式、响应解析、模型类型及引用完整性。必须按 input schema 生成完整 Adapter，不能把 inspect 返回的协议摘要当作 Adapter。失败后根据具体错误修正并重试本工具，不要跳过，也不要降级为相似但语义不同的协议。",
    effect: "read",
    inputSchema: setupSchema,
    summarizeInput: (input) =>
      `${input.providerId} · ${input.modelBindings?.length || 0} 个模型`,
    execute: (input, context) => {
      const setup = mergeSetup(input);
      const validationToken = `provider-setup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const drafts =
        (context.state.get("providerSetupDrafts") as Map<
          string,
          ProviderSetupInput
        >) || new Map<string, ProviderSetupInput>();
      drafts.set(validationToken, clonePlainData(input));
      context.state.set("providerSetupDrafts", drafts);
      return {
        success: true,
        validationToken,
        providerId: setup.providerId,
        changedProtocolIds: setup.changedProtocolIds,
        changedBindingIds: setup.changedBindingIds,
        compiledModels: setup.compiled,
        credentialRequired: setup.credentialRequired,
        instruction:
          "校验通过。只有用户已要求应用这些设置时才调用 apply_provider_setup，并只传 validationToken；不要重新生成协议 JSON。",
      };
    },
  });

  registerAgentTool<{ validationToken: string }>({
    id: "apply_provider_setup",
    title: "保存 API 厂商协议与模型",
    description:
      "用户已要求接入厂商或添加模型，且 validate_provider_setup 已通过时调用。只提交校验回执中的 validationToken，原子保存已校验草稿；不要重新生成或重复提交协议 JSON。不接收、不读取也不返回 API Key。",
    effect: "settings_write",
    inputSchema: {
      type: "object",
      required: ["validationToken"],
      properties: { validationToken: { type: "string" } },
      additionalProperties: false,
    },
    summarizeInput: () => "保存已校验的 API 厂商配置",
    execute: async (input, context) => {
      const drafts = context.state.get("providerSetupDrafts") as
        | Map<string, ProviderSetupInput>
        | undefined;
      const draft = drafts?.get(String(input.validationToken || ""));
      if (!draft) {
        throw new Error(
          "validationToken 无效或已过期；请重新调用 validate_provider_setup，修正错误后继续，不要跳过",
        );
      }
      const setup = mergeSetup(draft);
      if (context.signal.aborted)
        throw new DOMException("操作已取消", "AbortError");
      await saveAppSettings({
        protocolAdapters: setup.protocolAdapters,
        providerConfigs: setup.providerConfigs,
      });
      drafts?.delete(input.validationToken);
      return {
        success: true,
        applied: true,
        appliedCount:
          setup.changedProtocolIds.length + setup.changedBindingIds.length,
        providerId: setup.providerId,
        protocolIds: setup.changedProtocolIds,
        modelIds: setup.changedBindingIds,
        compiledModels: setup.compiled,
        credentialRequired: setup.credentialRequired,
        nextAction: setup.credentialRequired
          ? "厂商协议和模型已保存；请用户在 API 厂商设置中填写 API Key 后启用调用"
          : "厂商协议、模型和路由已可用",
      };
    },
  });
}
