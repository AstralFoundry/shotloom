import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { createServer } from "vite";

let server;
let clearAgentToolsForTests;
let listAgentTools;
let registerProviderSetupTools;
let settingsStore;

before(async () => {
  server = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  ({ clearAgentToolsForTests, listAgentTools } = await server.ssrLoadModule(
    "/src/agent/core/toolRegistry.ts",
  ));
  ({ registerProviderSetupTools } = await server.ssrLoadModule(
    "/src/agent/tools/providerSetupTools.ts",
  ));
  ({ settingsStore } = await server.ssrLoadModule(
    "/src/store/settingsStore.js",
  ));
});

after(async () => {
  clearAgentToolsForTests?.();
  await server?.close();
});

function context() {
  return {
    requestId: "provider-setup-test",
    turnId: "turn",
    projectKey: "project",
    projectInstanceId: "instance",
    projectGeneration: 1,
    conversationId: "conversation",
    signal: new AbortController().signal,
    loadedSkillIds: new Set(),
    attachments: [],
    capabilities: { nodeExecution: false },
    state: new Map(),
    emit: () => {},
  };
}

test("厂商接入工具只向 Shotloom Agent 返回脱敏设置", async () => {
  clearAgentToolsForTests();
  registerProviderSetupTools();
  settingsStore.updatedAt = "revision-1";
  settingsStore.protocolAdapters = [];
  settingsStore.providerConfigs = {
    starrouter: {
      displayName: "StarRouter",
      apiKey: "secret-key-must-not-leak",
      baseUrl: "https://starrouter.io/v1?token=also-secret",
      modelBindings: [],
    },
  };
  const tools = listAgentTools(context());
  assert.deepEqual(
    tools.map((tool) => tool.id),
    [
      "inspect_provider_setup",
      "validate_provider_setup",
      "apply_provider_setup",
    ],
  );
  assert.equal(
    tools.find((tool) => tool.id === "apply_provider_setup").effect,
    "settings_write",
  );

  const result = await tools
    .find((tool) => tool.id === "inspect_provider_setup")
    .execute({ providerId: "starrouter" }, context());
  assert.equal(result.settingsRevision, "revision-1");
  assert.equal(result.providers[0].baseUrl, "https://starrouter.io/v1");
  assert.doesNotMatch(
    JSON.stringify(result),
    /secret-key-must-not-leak|also-secret/,
  );
});

test("Agent 提交的新协议和批量模型会在写入前完成整套编译", async () => {
  clearAgentToolsForTests();
  registerProviderSetupTools();
  settingsStore.updatedAt = "revision-2";
  settingsStore.protocolAdapters = [];
  settingsStore.providerConfigs = {
    starrouter: {
      displayName: "StarRouter",
      apiKey: "local-only-key",
      baseUrl: "https://starrouter.io/v1",
      modelBindings: [],
    },
  };
  const validate = listAgentTools(context()).find(
    (tool) => tool.id === "validate_provider_setup",
  );
  const adapter = {
    kind: "adapter",
    id: "starrouter-openai-chat",
    name: "StarRouter OpenAI Chat",
    type: "textGeneration",
    defaultMode: "chat",
    modes: [
      {
        id: "chat",
        label: "文本对话",
        endpoint: {
          method: "POST",
          path: "/chat/completions",
          scope: "root",
        },
        inputConstraints: {},
        outputConstraints: {},
        params: [],
        requestTemplate: {
          model: "{{model}}",
          messages: "{{messages}}",
        },
        resultTextPath: "choices.*.message.content",
      },
    ],
  };
  const result = await validate.execute(
    {
      providerId: "starrouter",
      settingsRevision: "revision-2",
      providerConfig: {
        displayName: "StarRouter",
        baseUrl: "https://starrouter.io/v1",
      },
      protocolAdapters: [adapter],
      modelBindings: [
        {
          kind: "model",
          id: "model-a",
          name: "Model A",
          type: "textGeneration",
          adapterId: adapter.id,
        },
        {
          kind: "model",
          id: "model-b",
          name: "Model B",
          type: "textGeneration",
          adapterId: adapter.id,
        },
      ],
    },
    context(),
  );
  assert.equal(result.success, true);
  assert.deepEqual(result.changedProtocolIds, [adapter.id]);
  assert.deepEqual(result.changedBindingIds, ["model-a", "model-b"]);
  assert.match(result.validationToken, /^provider-setup-/);
  assert.deepEqual(
    result.compiledModels.map((model) => model.catalogId),
    ["starrouter:model-a", "starrouter:model-b"],
  );
});

test("Agent 可以先创建不含密钥的厂商草稿并保存模型协议", async () => {
  clearAgentToolsForTests();
  registerProviderSetupTools();
  settingsStore.updatedAt = "revision-3";
  settingsStore.protocolAdapters = [];
  settingsStore.providerConfigs = {};
  const tools = listAgentTools(context());
  const inspect = tools.find((tool) => tool.id === "inspect_provider_setup");
  const validate = tools.find((tool) => tool.id === "validate_provider_setup");
  const inspected = await inspect.execute(
    { providerId: "starrouter", modelTypes: ["textGeneration"] },
    context(),
  );

  assert.deepEqual(inspected.providers, []);
  assert.ok(inspected.protocols.length > 0);
  assert.match(inspected.workflow, /不含密钥的厂商草稿/);

  const adapterId = inspected.protocols[0].id;
  const result = await validate.execute(
    {
      providerId: "starrouter",
      settingsRevision: "revision-3",
      providerConfig: {
        displayName: "StarRouter",
        baseUrl: "https://starrouter.io",
      },
      modelBindings: [
        {
          kind: "model",
          id: "text-model",
          name: "Text Model",
          type: "textGeneration",
          adapterId,
        },
      ],
    },
    context(),
  );

  assert.equal(result.success, true);
  assert.equal(result.credentialRequired, true);
  assert.equal(result.compiledModels[0].catalogId, "starrouter:text-model");
});

test("协议校验工具向模型公开完整 Adapter 结构，保存只接受校验 token", () => {
  clearAgentToolsForTests();
  registerProviderSetupTools();
  const tools = listAgentTools(context());
  const validate = tools.find((tool) => tool.id === "validate_provider_setup");
  const apply = tools.find((tool) => tool.id === "apply_provider_setup");
  const adapter = validate.inputSchema.properties.protocolAdapters.items;
  const mode = adapter.properties.modes.items;

  assert.deepEqual(adapter.required, [
    "kind",
    "id",
    "name",
    "type",
    "defaultMode",
    "modes",
  ]);
  assert.ok(mode.required.includes("endpoint"));
  assert.ok(mode.required.includes("requestTemplate"));
  assert.ok(mode.properties.params.items.required.includes("presentation"));
  assert.deepEqual(apply.inputSchema.required, ["validationToken"]);
  assert.deepEqual(Object.keys(apply.inputSchema.properties), [
    "validationToken",
  ]);
});
