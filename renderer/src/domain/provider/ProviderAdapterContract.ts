import type {
  CatalogInputConstraints,
  CatalogMode,
  CatalogModel,
  CatalogOutputConstraints,
  CatalogParam,
} from "../catalog/ModelCatalog";
import { validateModelProtocol } from "./ModelProtocolValidation";

export type ProviderModelType =
  | "textGeneration"
  | "imageGeneration"
  | "videoGeneration"
  | "audioGeneration";

export interface ProviderProtocolAdapter {
  kind: "adapter";
  id: string;
  name: string;
  type: ProviderModelType;
  defaultMode: string;
  modes: CatalogMode[];
}

export interface ProviderModeOverride {
  label?: string;
  inputConstraints?: CatalogInputConstraints;
  outputConstraints?: CatalogOutputConstraints;
  params?: Record<string, false | Partial<Omit<CatalogParam, "key">>>;
}

export interface ProviderModelBinding {
  kind: "model";
  /** 供应商 API 接收的官方模型 ID。 */
  id: string;
  name: string;
  type: ProviderModelType;
  adapterId: string;
  /** 仅用于迁移或显式覆盖目录身份；新配置通常省略。 */
  catalogId?: string;
  sortOrder?: number;
  enabled?: boolean;
  defaultMode?: string;
  enabledModes?: string[];
  modeOverrides?: Record<string, ProviderModeOverride>;
  overridesBuiltIn?: boolean;
}

export interface CompileProviderOptions {
  namespaceModelIds?: boolean;
}

const MODEL_TYPES = new Set<ProviderModelType>([
  "textGeneration",
  "imageGeneration",
  "videoGeneration",
  "audioGeneration",
]);
const CONTROL_TYPES = new Set([
  "segmented",
  "select",
  "ratio",
  "resolution",
  "slider",
  "number",
  "toggle",
  "text",
  "hidden",
]);

const clone = <T>(value: T): T => structuredClone(value);

function bindModelEndpointPaths(
  mode: CatalogMode,
  requestModelId: string,
): CatalogMode {
  const encodedModelId = requestModelId
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const bindEndpoint = <T extends { path: string } | undefined>(
    endpoint: T,
  ): T =>
    (endpoint
      ? {
          ...endpoint,
          path: endpoint.path.replaceAll("{{model}}", encodedModelId),
        }
      : endpoint) as T;
  return {
    ...mode,
    endpoint: bindEndpoint(mode.endpoint),
    taskEndpoint: bindEndpoint(mode.taskEndpoint),
    resultEndpoint: bindEndpoint(mode.resultEndpoint),
  };
}

function migrateParamPresentation(param: CatalogParam): CatalogParam {
  if (
    param.presentation &&
    typeof param.presentation === "object" &&
    !Array.isArray(param.presentation)
  ) {
    return clone(param);
  }
  let control: NonNullable<
    Exclude<CatalogParam["presentation"], string>
  >["control"];
  if (param.presentation === "aspectRatio") control = "ratio";
  else if (param.type === "boolean") control = "toggle";
  else if (param.options?.length) control = "select";
  else if (param.type === "number") control = "number";
  else control = "text";
  return {
    ...clone(param),
    presentation: { control },
  };
}

function validateParamPresentations(
  adapterId: string,
  modes: CatalogMode[],
  position: string,
) {
  for (const mode of modes) {
    for (const param of mode.params) {
      const presentation = param.presentation;
      if (
        !presentation ||
        typeof presentation !== "object" ||
        Array.isArray(presentation)
      ) {
        throw new Error(
          `${position} ${adapterId}/${mode.id} 的参数 ${param.key} 必须显式声明 presentation.control`,
        );
      }
      if (!CONTROL_TYPES.has(presentation.control)) {
        throw new Error(
          `${position} ${adapterId}/${mode.id} 的参数 ${param.key} 使用了不支持的控件 ${presentation.control}`,
        );
      }
      if (
        ["segmented", "select", "ratio", "resolution"].includes(
          presentation.control,
        ) &&
        !param.options?.length
      ) {
        throw new Error(
          `${position} ${adapterId}/${mode.id} 的参数 ${param.key} 使用 ${presentation.control} 时必须提供 options`,
        );
      }
      if (
        presentation.control === "slider" &&
        (!Number.isFinite(presentation.min) ||
          !Number.isFinite(presentation.max) ||
          Number(presentation.max) <= Number(presentation.min))
      ) {
        throw new Error(
          `${position} ${adapterId}/${mode.id} 的参数 ${param.key} 使用 slider 时必须提供有效 min/max`,
        );
      }
      if (presentation.control === "toggle" && param.type !== "boolean") {
        throw new Error(
          `${position} ${adapterId}/${mode.id} 的参数 ${param.key} 使用 toggle 时 type 必须是 boolean`,
        );
      }
      if (
        ["slider", "number"].includes(presentation.control) &&
        param.type !== "number"
      ) {
        throw new Error(
          `${position} ${adapterId}/${mode.id} 的参数 ${param.key} 使用数字控件时 type 必须是 number`,
        );
      }
    }
  }
}

function validateAdapter(
  adapter: ProviderProtocolAdapter,
  position = "当前 Adapter",
) {
  if (!adapter?.id || !adapter.name || !MODEL_TYPES.has(adapter.type)) {
    throw new Error(`${position} 缺少 id、name 或有效 type`);
  }
  validateModelProtocol(
    {
      id: adapter.id,
      name: adapter.name,
      provider: "__adapter__",
      type: adapter.type,
      sortOrder: 0,
      enabled: true,
      defaultMode: adapter.defaultMode,
      modes: adapter.modes,
    },
    position,
  );
  validateParamPresentations(adapter.id, adapter.modes, position);
}

function applyModeOverride(
  mode: CatalogMode,
  override: ProviderModeOverride | undefined,
  label: string,
): CatalogMode {
  if (!override) return clone(mode);
  const knownParams = new Map(mode.params.map((param) => [param.key, param]));
  for (const key of Object.keys(override.params || {})) {
    if (!knownParams.has(key))
      throw new Error(`${label} 覆盖了 Adapter 未声明的参数 ${key}`);
  }
  const params = mode.params.flatMap((param) => {
    const patch = override.params?.[param.key];
    if (patch === false) return [];
    return [{ ...clone(param), ...(patch ? clone(patch) : {}) }];
  });
  return {
    ...clone(mode),
    ...(override.label ? { label: override.label } : {}),
    ...(override.inputConstraints
      ? { inputConstraints: clone(override.inputConstraints) }
      : {}),
    ...(override.outputConstraints
      ? { outputConstraints: clone(override.outputConstraints) }
      : {}),
    params,
  };
}

export function compileProviderModelBinding(
  provider: string,
  adapter: ProviderProtocolAdapter,
  binding: ProviderModelBinding,
  index = 0,
  options: CompileProviderOptions = {},
): CatalogModel {
  if (
    !binding?.id ||
    !binding.name ||
    !MODEL_TYPES.has(binding.type) ||
    !binding.adapterId
  ) {
    throw new Error(`模型 Binding 缺少 id、name、有效 type 或 adapterId`);
  }
  if (binding.type !== adapter.type) {
    throw new Error(
      `模型 ${binding.id} 的类型 ${binding.type} 与 Adapter ${adapter.id} 的类型 ${adapter.type} 不一致`,
    );
  }
  const adapterModeIds = new Set(adapter.modes.map((mode) => mode.id));
  const enabledModeIds = binding.enabledModes?.length
    ? new Set(binding.enabledModes)
    : adapterModeIds;
  for (const modeId of enabledModeIds) {
    if (!adapterModeIds.has(modeId))
      throw new Error(`模型 ${binding.id} 启用了不存在的 mode ${modeId}`);
  }
  for (const modeId of Object.keys(binding.modeOverrides || {})) {
    if (!adapterModeIds.has(modeId))
      throw new Error(`模型 ${binding.id} 覆盖了不存在的 mode ${modeId}`);
  }
  const modes = adapter.modes
    .filter((mode) => enabledModeIds.has(mode.id))
    .map((mode) =>
      applyModeOverride(
        mode,
        binding.modeOverrides?.[mode.id],
        `模型 ${binding.id}/${mode.id}`,
      ),
    )
    .map((mode) => bindModelEndpointPaths(mode, binding.id.trim()));
  const defaultMode = binding.defaultMode || adapter.defaultMode;
  const requestModelId = binding.id.trim();
  const catalogId =
    binding.catalogId?.trim() ||
    (binding.overridesBuiltIn || options.namespaceModelIds === false
      ? requestModelId
      : `${provider}:${requestModelId}`);
  const model: CatalogModel = {
    id: catalogId,
    requestModelId,
    name: binding.name.trim() || binding.id.trim(),
    provider,
    type: binding.type,
    sortOrder: Number(binding.sortOrder) || 900 + index,
    enabled: binding.enabled !== false,
    defaultMode,
    modes,
    ...(binding.overridesBuiltIn ? { overridesBuiltIn: true } : {}),
  };
  validateModelProtocol(model, `模型 ${binding.id}`);
  validateParamPresentations(binding.id, model.modes, `模型 ${binding.id}`);
  return model;
}

export function compileProviderModels(
  provider: string,
  adapters: ProviderProtocolAdapter[] = [],
  bindings: ProviderModelBinding[] = [],
  options: CompileProviderOptions = {},
): CatalogModel[] {
  const adapterMap = new Map<string, ProviderProtocolAdapter>();
  adapters.forEach((adapter, index) => {
    validateAdapter(adapter, `第 ${index + 1} 个 Adapter`);
    if (adapterMap.has(adapter.id))
      throw new Error(`Adapter ID “${adapter.id}” 重复`);
    adapterMap.set(adapter.id, adapter);
  });
  const modelIds = new Set<string>();
  const catalogIds = new Set<string>();
  return bindings.map((binding, index) => {
    if (modelIds.has(binding.id))
      throw new Error(`模型 Binding ID “${binding.id}” 重复`);
    modelIds.add(binding.id);
    const adapter = adapterMap.get(binding.adapterId);
    if (!adapter)
      throw new Error(
        `模型 ${binding.id} 引用了不存在的 Adapter ${binding.adapterId}`,
      );
    const model = compileProviderModelBinding(
      provider,
      adapter,
      binding,
      index,
      options,
    );
    if (catalogIds.has(model.id))
      throw new Error(`模型目录 ID “${model.id}” 重复`);
    catalogIds.add(model.id);
    return model;
  });
}

export function parseProtocolAdapterPackage(
  value: unknown,
): ProviderProtocolAdapter[] {
  if (!Array.isArray(value) || !value.length) {
    throw new Error("协议包必须是包含 kind:adapter 项的非空 JSON 数组");
  }
  const adapters = value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`协议包第 ${index + 1} 项必须是对象`);
    }
    const item = clone(entry) as ProviderProtocolAdapter | ProviderModelBinding;
    if (item.kind !== "adapter") {
      throw new Error(
        `协议包第 ${index + 1} 项必须是 kind:adapter；模型请在 API 厂商中批量添加`,
      );
    }
    return item;
  });
  compileProviderModels("__protocol_library__", adapters, []);
  return adapters;
}

export function migrateCatalogModelsToProviderAdapters(
  models: CatalogModel[] = [],
): {
  adapters: ProviderProtocolAdapter[];
  bindings: ProviderModelBinding[];
} {
  return models
    .flatMap((model, index) => {
      if (!model?.id || !Array.isArray(model.modes) || !model.modes.length)
        return [];
      const adapterId = `${String(model.id).replace(/[^a-zA-Z0-9:_-]+/g, "-")}-adapter`;
      return [
        {
          adapters: [
            {
              kind: "adapter" as const,
              id: adapterId,
              name: `${model.name || model.id} 协议`,
              type: model.type as ProviderModelType,
              defaultMode: model.defaultMode,
              modes: clone(model.modes).map((mode) => ({
                ...mode,
                params: mode.params.map(migrateParamPresentation),
              })),
            },
          ],
          bindings: [
            {
              kind: "model" as const,
              id: model.requestModelId || model.id,
              name: model.name || model.id,
              type: model.type as ProviderModelType,
              adapterId,
              catalogId: model.id,
              sortOrder: Number(model.sortOrder) || 900 + index,
              enabled: model.enabled !== false,
              ...(model.overridesBuiltIn ? { overridesBuiltIn: true } : {}),
            },
          ],
        },
      ];
    })
    .reduce(
      (result, entry) => ({
        adapters: [...result.adapters, ...entry.adapters],
        bindings: [...result.bindings, ...entry.bindings],
      }),
      {
        adapters: [] as ProviderProtocolAdapter[],
        bindings: [] as ProviderModelBinding[],
      },
    );
}
