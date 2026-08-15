import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { clonePlainData } from "../renderer/src/utils/plainDataClone.mjs";

let server;
let buildCustomCatalogModels;
let getModelInfo;
let getBuiltInProviderPackage;
let getBuiltInAdapterTemplates;
let getGenerationInputModes;
let getModelInputCapabilityForRoles;
let resolveModelRuntimeContract;
let setExternalCatalogModels;
let validateModelProtocol;
let compileProviderModels;
let migrateCatalogModelsToProviderAdapters;
let parseProtocolAdapterPackage;
let migrateProviderSettings;
let getProviderTransport;

before(async () => {
  server = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  ({ buildCustomCatalogModels } = await server.ssrLoadModule(
    "/src/domain/provider/CustomModelCatalog.ts",
  ));
  ({
    getBuiltInProviderPackage,
    getBuiltInAdapterTemplates,
    getGenerationInputModes,
    getModelInfo,
    getModelInputCapabilityForRoles,
    resolveModelRuntimeContract,
    setExternalCatalogModels,
  } = await server.ssrLoadModule("/src/domain/catalog/ModelCatalog.ts"));
  ({ validateModelProtocol } = await server.ssrLoadModule(
    "/src/domain/provider/ModelProtocolValidation.ts",
  ));
  ({
    compileProviderModels,
    migrateCatalogModelsToProviderAdapters,
    parseProtocolAdapterPackage,
  } = await server.ssrLoadModule(
    "/src/domain/provider/ProviderAdapterContract.ts",
  ));
  ({ migrateProviderSettings } = await server.ssrLoadModule(
    "/src/store/settingsStore.js",
  ));
  ({ getProviderTransport } = await server.ssrLoadModule(
    "/src/domain/provider/TransportRegistry.ts",
  ));
});

after(async () => {
  setExternalCatalogModels?.([]);
  await server?.close();
});

function buildCatalogModels(providerConfigs) {
  const adapters = Object.values(providerConfigs).flatMap(
    (config) => config.protocolAdapters || [],
  );
  const configs = Object.fromEntries(
    Object.entries(providerConfigs).map(([id, config]) => [
      id,
      {
        ...config,
        protocolAdapters: undefined,
      },
    ]),
  );
  return buildCustomCatalogModels(configs, adapters);
}

test("全局 Adapter 与厂商 Binding 可以从响应式设置转为持久化普通数据", () => {
  const adapter = new Proxy(
    {
      kind: "adapter",
      id: "custom-image-api",
      name: "Custom Image API",
      type: "imageGeneration",
      defaultMode: "generate",
      modes: [
        new Proxy(
          {
            id: "generate",
            endpoint: { path: "/images/generations", method: "POST" },
            requestTemplate: { model: "{{model}}", prompt: "{{prompt}}" },
            outputConstraints: {},
            params: [],
          },
          {},
        ),
      ],
    },
    {},
  );
  const settings = new Proxy(
    {
      protocolAdapters: [adapter],
      providerConfigs: new Proxy(
        {
          custom: new Proxy(
            {
              apiKey: "test-key",
              baseUrl: "https://example.com/v1",
              modelBindings: [
                {
                  kind: "model",
                  id: "custom-image-model",
                  name: "Custom Image Model",
                  type: "imageGeneration",
                  adapterId: "custom-image-api",
                },
              ],
            },
            {},
          ),
        },
        {},
      ),
    },
    {},
  );

  assert.throws(() => structuredClone(settings), /clone/i);
  const plain = clonePlainData(settings);
  assert.doesNotThrow(() => structuredClone(plain));
  assert.notEqual(plain.protocolAdapters[0], adapter);
});

test("内置厂商向设置界面公开同契约的 Adapter 与 Binding", () => {
  const providerPackage = getBuiltInProviderPackage("openai");
  assert.ok(providerPackage.adapters.length > 0);
  assert.ok(providerPackage.bindings.length > 0);
  assert.equal(
    providerPackage.adapters.every((adapter) => adapter.kind === "adapter"),
    true,
  );
  assert.equal(
    providerPackage.bindings.every((binding) => binding.kind === "model"),
    true,
  );
  assert.equal(
    providerPackage.bindings.every((binding) =>
      providerPackage.adapters.some(
        (adapter) => adapter.id === binding.adapterId,
      ),
    ),
    true,
  );
  providerPackage.adapters.length = 0;
  assert.ok(
    getBuiltInProviderPackage("openai").adapters.length > 0,
    "界面读取不能修改内置目录",
  );
});

test("自定义厂商可以从全局内置协议库选择 Adapter 模板", () => {
  const templates = getBuiltInAdapterTemplates();
  assert.ok(
    templates.some(
      (item) =>
        item.providerId === "openai" && item.adapter.type === "imageGeneration",
    ),
  );
  assert.ok(
    templates.some(
      (item) =>
        item.providerId === "google" && item.adapter.type === "videoGeneration",
    ),
  );
  const firstId = templates[0].adapter.id;
  templates[0].adapter.id = "mutated";
  assert.equal(getBuiltInAdapterTemplates()[0].adapter.id, firstId);
});

test("自定义厂商目录从响应式 Adapter 与 Binding 编译模型", () => {
  const adapter = new Proxy(
    {
      kind: "adapter",
      id: "openai-chat-api",
      name: "OpenAI Chat API",
      type: "textGeneration",
      defaultMode: "chat",
      modes: [
        new Proxy(
          {
            id: "chat",
            endpoint: { path: "/chat/completions", method: "POST" },
            requestTemplate: { model: "{{model}}", messages: "{{messages}}" },
            outputConstraints: { supportsToolCalls: false },
            params: [],
            resultTextPath: "choices.*.message.content",
          },
          {},
        ),
      ],
    },
    {},
  );
  const configs = new Proxy(
    {
      myProvider: new Proxy(
        {
          protocolAdapters: [adapter],
          modelBindings: [
            {
              kind: "model",
              id: "custom-chat-model",
              name: "Custom Chat Model",
              type: "textGeneration",
              adapterId: "openai-chat-api",
            },
          ],
        },
        {},
      ),
    },
    {},
  );

  const catalog = buildCatalogModels(configs);
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].provider, "myProvider");
  assert.equal(catalog[0].id, "myProvider:custom-chat-model");
  assert.equal(catalog[0].requestModelId, "custom-chat-model");
  assert.notEqual(catalog[0].modes[0], adapter.modes[0]);
  assert.doesNotThrow(() => structuredClone(catalog));
});

test("跨厂商复用内置模型 ID 时保留两个可选择的供应商路由", () => {
  const configs = {
    startrouter: {
      protocolAdapters: [
        {
          kind: "adapter",
          id: "openai-chat-api",
          name: "OpenAI Chat API",
          type: "textGeneration",
          defaultMode: "text-generation",
          modes: [
            {
              id: "text-generation",
              label: "文本对话",
              endpoint: { path: "/chat/completions", method: "POST" },
              requestTemplate: { model: "{{model}}", messages: "{{messages}}" },
              inputConstraints: {},
              outputConstraints: { supportsToolCalls: true },
              params: [],
              resultTextPath: "choices.*.message.content",
            },
          ],
        },
      ],
      modelBindings: [
        {
          kind: "model",
          id: "deepseek-v4-pro",
          name: "DeepSeek V4 Pro via StarRouter",
          type: "textGeneration",
          adapterId: "openai-chat-api",
          enabled: true,
        },
      ],
    },
  };

  setExternalCatalogModels(buildCatalogModels(configs));
  assert.equal(getModelInfo("deepseek-v4-pro").provider, "deepseek");
  assert.equal(
    getModelInfo("startrouter:deepseek-v4-pro").provider,
    "startrouter",
  );
  const contract = resolveModelRuntimeContract(
    "textGeneration",
    "startrouter:deepseek-v4-pro",
  );
  assert.equal(contract.requestModelId, "deepseek-v4-pro");
  const request = getProviderTransport("startrouter").compileRequest({
    taskType: "textGeneration",
    model: "startrouter:deepseek-v4-pro",
    modelContract: contract,
    prompt: "hello",
  });
  assert.equal(request.protocolVariables.model, "deepseek-v4-pro");
});

test("自定义图片协议声明图片数量后可恢复缺失的参考图 role", () => {
  setExternalCatalogModels(
    buildCatalogModels({
      custom: {
        protocolAdapters: [
          {
            kind: "adapter",
            id: "image-edit-api",
            name: "Image Edit API",
            type: "imageGeneration",
            defaultMode: "edit",
            modes: [
              {
                id: "edit",
                inputMode: "reference",
                inputSlots: ["reference"],
                endpoint: { path: "/images/edits", method: "POST" },
                requestTemplate: {
                  image: "{{imageUrl}}",
                  prompt: "{{prompt}}",
                },
                inputConstraints: { images: { min: 1, max: 4 } },
                outputConstraints: {},
                params: [],
                resultUrlPath: "data.*.url",
              },
            ],
          },
        ],
        modelBindings: [
          {
            kind: "model",
            id: "custom-image-edit",
            name: "Custom Image Edit",
            type: "imageGeneration",
            adapterId: "image-edit-api",
          },
        ],
      },
    }),
  );

  assert.equal(
    getGenerationInputModes("custom:custom-image-edit")[0].value,
    "reference",
  );
  const resolution = getModelInputCapabilityForRoles(
    "imageGeneration",
    "custom:custom-image-edit",
    ["referenceImage"],
    "edit",
  );
  assert.equal(resolution.supported, true);
  assert.equal(resolution.capability.supportsReferenceImages, true);
});

test("自定义音频协议把 Hex 结果声明传入运行时", () => {
  setExternalCatalogModels(
    buildCatalogModels({
      custom: {
        protocolAdapters: [
          {
            kind: "adapter",
            id: "hex-tts-api",
            name: "Hex TTS API",
            type: "audioGeneration",
            defaultMode: "tts",
            modes: [
              {
                id: "tts",
                endpoint: {
                  path: "/audio/speech",
                  method: "POST",
                  scope: "root",
                },
                requestTemplate: { input: "{{prompt}}" },
                inputConstraints: {},
                outputConstraints: { formats: ["mp3"] },
                params: [],
                resultHexPath: "data.audio",
                resultMimeType: "audio/mpeg",
                resultFileExtension: "mp3",
              },
            ],
          },
        ],
        modelBindings: [
          {
            kind: "model",
            id: "custom-tts",
            name: "Custom TTS",
            type: "audioGeneration",
            adapterId: "hex-tts-api",
          },
        ],
      },
    }),
  );

  const contract = resolveModelRuntimeContract(
    "audioGeneration",
    "custom:custom-tts",
  );
  assert.equal(contract.resultHexPath, "data.audio");
  assert.equal(contract.resultMimeType, "audio/mpeg");
  assert.equal(contract.resultFileExtension, "mp3");
});

test("多个模型 Binding 复用同一个协议并可覆盖参数展示", () => {
  const adapters = [
    {
      kind: "adapter",
      id: "shared-image-api",
      name: "Shared Image API",
      type: "imageGeneration",
      defaultMode: "generate",
      modes: [
        {
          id: "generate",
          label: "图片生成",
          endpoint: {
            method: "POST",
            path: "/images/generations",
            scope: "root",
          },
          inputConstraints: {},
          outputConstraints: {},
          params: [
            {
              key: "quality",
              label: "质量",
              type: "string",
              options: ["standard", "high"],
              default: "standard",
              presentation: {
                control: "segmented",
                group: "输出",
                summary: true,
              },
            },
          ],
          requestTemplate: {
            model: "{{model}}",
            prompt: "{{prompt}}",
            quality: "{{params.quality}}",
          },
          resultUrlPath: "data.*.url",
        },
      ],
    },
  ];
  const models = compileProviderModels("cheap-provider", adapters, [
    {
      kind: "model",
      id: "image-fast",
      name: "Image Fast",
      type: "imageGeneration",
      adapterId: "shared-image-api",
    },
    {
      kind: "model",
      id: "image-hd",
      name: "Image HD",
      type: "imageGeneration",
      adapterId: "shared-image-api",
      modeOverrides: { generate: { params: { quality: { default: "high" } } } },
    },
  ]);

  assert.deepEqual(
    models.map((model) => model.id),
    ["cheap-provider:image-fast", "cheap-provider:image-hd"],
  );
  assert.deepEqual(
    models.map((model) => model.requestModelId),
    ["image-fast", "image-hd"],
  );
  assert.equal(models[0].modes[0].params[0].default, "standard");
  assert.equal(models[1].modes[0].params[0].default, "high");
  assert.equal(models[0].provider, "cheap-provider");
});

test("一个全局 Adapter 可被多个 API 厂商引用且厂商配置不保存协议副本", () => {
  const adapter = {
    kind: "adapter",
    id: "shared-chat-api",
    name: "Shared Chat API",
    type: "textGeneration",
    defaultMode: "chat",
    modes: [
      {
        id: "chat",
        label: "文本对话",
        endpoint: { method: "POST", path: "/chat/completions", scope: "root" },
        inputConstraints: {},
        outputConstraints: {},
        params: [],
        requestTemplate: { model: "{{model}}", messages: "{{messages}}" },
        resultTextPath: "choices.*.message.content",
      },
    ],
  };
  const configs = {
    providerA: {
      apiKey: "a",
      baseUrl: "https://a.example.com",
      modelBindings: [
        {
          kind: "model",
          id: "chat-a",
          name: "Chat A",
          type: "textGeneration",
          adapterId: adapter.id,
        },
      ],
    },
    providerB: {
      apiKey: "b",
      baseUrl: "https://b.example.com",
      modelBindings: [
        {
          kind: "model",
          id: "chat-b",
          name: "Chat B",
          type: "textGeneration",
          adapterId: adapter.id,
        },
      ],
    },
  };

  const models = buildCustomCatalogModels(configs, [adapter]);
  assert.deepEqual(
    models.map((model) => model.id),
    ["providerA:chat-a", "providerB:chat-b"],
  );
  assert.equal(Object.hasOwn(configs.providerA, "protocolAdapters"), false);
  assert.equal(Object.hasOwn(configs.providerB, "protocolAdapters"), false);
});

test("Adapter 参数必须声明界面可以稳定渲染的控件", () => {
  const adapter = {
    kind: "adapter",
    id: "incomplete-api",
    name: "Incomplete API",
    type: "videoGeneration",
    defaultMode: "generate",
    modes: [
      {
        id: "generate",
        label: "视频生成",
        endpoint: { method: "POST", path: "/videos", scope: "root" },
        inputConstraints: {},
        outputConstraints: {},
        params: [
          {
            key: "duration",
            label: "时长",
            type: "number",
            numeric: true,
            default: 5,
          },
        ],
        requestTemplate: { duration: "{{params.duration}}" },
        resultUrlPath: "data.url",
      },
    ],
  };
  assert.throws(
    () =>
      compileProviderModels(
        "custom",
        [adapter],
        [
          {
            kind: "model",
            id: "video-model",
            name: "Video Model",
            type: "videoGeneration",
            adapterId: "incomplete-api",
          },
        ],
      ),
    /必须显式声明 presentation\.control/,
  );

  adapter.modes[0].params[0].presentation = { control: "number" };
  assert.throws(
    () =>
      compileProviderModels(
        "custom",
        [adapter],
        [
          {
            kind: "model",
            id: "video-model",
            name: "Video Model",
            type: "videoGeneration",
            adapterId: "incomplete-api",
            modeOverrides: {
              generate: {
                params: { duration: { presentation: { control: "toggle" } } },
              },
            },
          },
        ],
      ),
    /使用 toggle 时 type 必须是 boolean/,
  );
});

test("协议导入只接受 Adapter 数组", () => {
  const adapter = {
    kind: "adapter",
    id: "chat-api",
    name: "Chat API",
    type: "textGeneration",
    defaultMode: "chat",
    modes: [
      {
        id: "chat",
        label: "文本对话",
        endpoint: { method: "POST", path: "/chat", scope: "root" },
        inputConstraints: {},
        outputConstraints: {},
        params: [],
        requestTemplate: { model: "{{model}}", messages: "{{messages}}" },
        resultTextPath: "choices.*.message.content",
      },
    ],
  };
  const binding = {
    kind: "model",
    id: "self-hosted-chat",
    name: "Self-hosted Chat",
    type: "textGeneration",
    adapterId: "chat-api",
  };
  assert.deepEqual(parseProtocolAdapterPackage([adapter]), [adapter]);
  assert.throws(
    () => parseProtocolAdapterPackage([adapter, binding]),
    /模型请在 API 厂商中批量添加/,
  );
  assert.throws(
    () => parseProtocolAdapterPackage({ adapters: [adapter] }),
    /必须是包含 kind:adapter 项的非空 JSON 数组/,
  );
});

test("旧逐模型协议单向迁移并按已声明类型补齐控件", () => {
  const migrated = migrateCatalogModelsToProviderAdapters([
    {
      id: "legacy-image",
      name: "Legacy Image",
      provider: "legacy",
      type: "imageGeneration",
      sortOrder: 10,
      enabled: true,
      defaultMode: "generate",
      modes: [
        {
          id: "generate",
          label: "图片生成",
          endpoint: { method: "POST", path: "/images", scope: "root" },
          inputConstraints: {},
          outputConstraints: {},
          requestTemplate: { size: "{{params.size}}", seed: "{{params.seed}}" },
          resultUrlPath: "data.url",
          params: [
            {
              key: "size",
              label: "比例",
              type: "string",
              options: ["1:1"],
              presentation: "aspectRatio",
            },
            { key: "seed", label: "种子", type: "number", numeric: true },
          ],
        },
      ],
    },
  ]);
  assert.equal(migrated.adapters.length, 1);
  assert.equal(migrated.bindings[0].adapterId, migrated.adapters[0].id);
  assert.equal(
    migrated.adapters[0].modes[0].params[0].presentation.control,
    "ratio",
  );
  assert.equal(
    migrated.adapters[0].modes[0].params[1].presentation.control,
    "number",
  );
  assert.doesNotThrow(() =>
    compileProviderModels("legacy", migrated.adapters, migrated.bindings),
  );
});

test("设置迁移把厂商内协议提升到全局且不覆盖已经存在的新 Binding", () => {
  const legacyModel = {
    id: "legacy-image",
    name: "Legacy Image",
    provider: "legacy",
    type: "imageGeneration",
    sortOrder: 10,
    enabled: true,
    defaultMode: "generate",
    modes: [
      {
        id: "generate",
        label: "图片生成",
        endpoint: { method: "POST", path: "/images", scope: "root" },
        inputConstraints: {},
        outputConstraints: {},
        params: [],
        requestTemplate: {},
        resultUrlPath: "data.url",
      },
    ],
  };
  const existingBinding = {
    kind: "model",
    id: "legacy-image",
    name: "Keep Me",
    type: "imageGeneration",
    adapterId: "existing-adapter",
  };
  const result = migrateProviderSettings({
    storageVersion: 7,
    providerConfigs: {
      legacy: {
        models: [legacyModel],
        protocolAdapters: [
          {
            kind: "adapter",
            id: "existing-adapter",
            name: "Existing",
            type: "imageGeneration",
            defaultMode: "generate",
            modes: legacyModel.modes,
          },
        ],
        modelBindings: [existingBinding],
      },
    },
  });
  assert.equal(result.changed, true);
  assert.equal(
    Object.hasOwn(result.settings.providerConfigs.legacy, "models"),
    false,
  );
  assert.equal(
    Object.hasOwn(result.settings.providerConfigs.legacy, "protocolAdapters"),
    false,
  );
  assert.equal(result.settings.protocolAdapters.length, 2);
  assert.equal(result.settings.providerConfigs.legacy.modelBindings.length, 1);
  assert.equal(
    result.settings.providerConfigs.legacy.modelBindings[0].name,
    "Keep Me",
  );
});

test("自定义协议拒绝界面无法消费的参数结构", () => {
  const base = {
    id: "custom-video",
    name: "Custom Video",
    provider: "custom",
    type: "videoGeneration",
    defaultMode: "generate",
    modes: [
      {
        id: "generate",
        label: "视频生成",
        endpoint: { method: "POST", path: "/v1/videos", scope: "root" },
        inputConstraints: {},
        outputConstraints: { durations: [5, 10] },
        params: [
          {
            key: "duration",
            label: "时长",
            type: "number",
            numeric: true,
            default: 5,
          },
        ],
        requestTemplate: {
          model: "{{model}}",
          prompt: "{{prompt}}",
          duration: "{{params.duration}}",
        },
        resultUrlPath: "data.url",
      },
    ],
  };

  assert.doesNotThrow(() => validateModelProtocol(base));
  const numericObject = structuredClone(base);
  numericObject.modes[0].params[0].numeric = { min: 1, max: 15 };
  assert.throws(
    () => validateModelProtocol(numericObject),
    /numeric 只能是布尔值/,
  );
  const durationObject = structuredClone(base);
  durationObject.modes[0].outputConstraints.durations = { min: 1, max: 15 };
  assert.throws(
    () => validateModelProtocol(durationObject),
    /durations 必须是正数数组/,
  );
  const jsonParam = structuredClone(base);
  jsonParam.modes[0].params[0].type = "json";
  assert.throws(
    () => validateModelProtocol(jsonParam),
    /type 只能是 string、number、boolean 或 select/,
  );
});

test("自定义协议拒绝用户无法选择的重复输入模式", () => {
  const mode = {
    id: "url",
    label: "生成 URL",
    endpoint: { method: "POST", path: "/v1/images", scope: "root" },
    inputConstraints: {},
    outputConstraints: {},
    params: [],
    requestTemplate: { prompt: "{{prompt}}" },
    resultUrlPath: "data.url",
  };
  assert.throws(
    () =>
      validateModelProtocol({
        id: "duplicate-image",
        name: "Duplicate Image",
        provider: "custom",
        type: "imageGeneration",
        defaultMode: "url",
        modes: [
          mode,
          {
            ...mode,
            id: "base64",
            label: "生成 Base64",
            resultUrlPath: undefined,
            resultBase64Path: "data.b64_json",
          },
        ],
      }),
    /重复声明输入模式/,
  );
});

test("Gemini 原生参考图必须使用可编译的 inlineData 结构", () => {
  const base = {
    id: "gemini-image",
    name: "Gemini Image",
    provider: "custom",
    type: "imageGeneration",
    defaultMode: "edit",
    modes: [
      {
        id: "edit",
        label: "图片编辑",
        inputMode: "reference",
        inputSlots: ["reference"],
        endpoint: {
          method: "POST",
          path: "/v1beta/models/gemini-image:generateContent",
          scope: "root",
        },
        inputConstraints: {
          images: { min: 1, max: 1, roles: ["referenceImage"] },
        },
        outputConstraints: {},
        params: [],
        requestFields: { imageContentFormat: "google-inline" },
        requestTemplate: {
          contents: [
            {
              role: "user",
              parts: [
                { text: "{{prompt}}" },
                {
                  inlineData: {
                    mimeType: "{{inlineImage.mimeType}}",
                    data: "{{inlineImage.bytesBase64Encoded}}",
                  },
                },
              ],
            },
          ],
        },
        resultBase64Path: "candidates.*.content.parts.*.inlineData.data",
      },
    ],
  };
  assert.doesNotThrow(() => validateModelProtocol(base));

  const malformed = structuredClone(base);
  malformed.modes[0].requestFields = { imageContentType: "inlineData" };
  malformed.modes[0].requestTemplate = { contents: "{{content}}" };
  assert.throws(
    () => validateModelProtocol(malformed),
    /不能用 imageContentType:inlineData 配合/,
  );
});
