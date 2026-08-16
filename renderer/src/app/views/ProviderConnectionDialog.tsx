import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  catalogModelValidationErrors,
  type CatalogModel,
  getBuiltInCatalogModels,
  normalizeCatalogModel,
} from "../../domain/catalog/ModelCatalog";
import {
  getProviderDefinitions,
  type ProviderConfig,
} from "../../domain/provider/ProviderRegistry";
import {
  getProtocolPreset,
  presetsForType,
  type ProtocolPreset,
} from "../../domain/provider/ProtocolPresets";
import {
  testProviderRequest,
  type ProviderTestResult,
} from "../../services/providerTestService";
import protocolAuthoringPrompt from "../../config/protocol-authoring-prompt.md?raw";
import { modelTypeLabel } from "../../utils/modelPresentation.js";
import {
  getProviderIcon,
  PROVIDER_ICON_OPTIONS,
} from "../../domain/provider/ProviderBrandIcons.js";
import { IconSymbol } from "../components/IconSymbol";
import { ProviderBrandIcon } from "../components/ProviderBrandIcon";

const CUSTOM_PROVIDER_ID = "__custom__";
// Provider configs may come from the reactive settings proxy. Catalog models
// are JSON data, so a JSON copy safely unwraps them before editing/saving.
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function ProviderIconSelect({
  value,
  disabled = false,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const fieldRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const selectedIcon = getProviderIcon(value);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!fieldRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="provider-icon-field" ref={fieldRef}>
      <button
        ref={triggerRef}
        className="provider-icon-trigger"
        type="button"
        role="combobox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <ProviderBrandIcon icon={selectedIcon?.id || "custom"} />
        <span>{selectedIcon?.label || "OpenAI"}</span>
        <IconSymbol name="chevron-down" />
      </button>
      {open && (
        <div
          className="provider-icon-picker"
          id={listboxId}
          role="listbox"
          aria-label="品牌图标"
        >
          {PROVIDER_ICON_OPTIONS.map((icon) => (
            <button
              key={icon.id}
              className={icon.id === value ? "active" : ""}
              type="button"
              role="option"
              aria-selected={icon.id === value}
              onClick={() => {
                onChange(icon.id);
                setOpen(false);
                requestAnimationFrame(() => triggerRef.current?.focus());
              }}
            >
              <ProviderBrandIcon icon={icon.id} />
              <span>{icon.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function builtInProviderModels(providerId: string): CatalogModel[] {
  return getBuiltInCatalogModels(providerId);
}

function effectiveProviderModels(
  providerId: string,
  storedModels: CatalogModel[] = [],
): CatalogModel[] {
  const builtIns = builtInProviderModels(providerId);
  const overrides = new Map(storedModels.map((model) => [model.id, model]));
  const builtInIds = new Set(builtIns.map((model) => model.id));
  return [
    ...builtIns.map((model) => clone(overrides.get(model.id) || model)),
    ...storedModels.filter((model) => !builtInIds.has(model.id)).map(clone),
  ];
}

function sameModelDefinition(left: CatalogModel, right: CatalogModel): boolean {
  const normalize = (model: CatalogModel) => {
    const value = clone(model) as CatalogModel & { overridesBuiltIn?: boolean };
    delete value.overridesBuiltIn;
    return value;
  };
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function starterProtocolModel(type: NewModelDraft["type"]): CatalogModel {
  const mode = type === "textGeneration"
    ? { id: "text-generation", label: "文本生成", resultKey: "resultTextPath" }
    : type === "imageGeneration"
    ? { id: "text-to-image", label: "文生图", resultKey: "resultUrlPath" }
    : type === "videoGeneration"
    ? { id: "video-generation", label: "视频生成", resultKey: "resultUrlPath" }
    : { id: "audio-generation", label: "音频生成", resultKey: "resultUrlPath" };
  const base = {
    id: "",
    name: "",
    provider: "",
    type,
    sortOrder: 900,
    enabled: true,
  };
  return {
    ...base,
    defaultMode: mode.id,
    modes: [{
      id: mode.id,
      label: mode.label,
      endpoint: { method: "POST", path: "", scope: "root" },
      inputConstraints: {},
      outputConstraints: {},
      params: [],
      requestTemplate: {},
      [mode.resultKey]: "",
    }],
  };
}

function presetProtocolModel(preset: ProtocolPreset): CatalogModel {
  const mode = preset.buildMode();
  return {
    id: "",
    name: "",
    provider: "",
    type: preset.type,
    sortOrder: 900,
    enabled: true,
    defaultMode: mode.id,
    modes: [mode],
  };
}

function testPromptForType(type: string): string {
  if (type === "imageGeneration") return "一只坐在窗边的猫，卡通风格";
  if (type === "videoGeneration") return "一只猫从窗边走过";
  if (type === "audioGeneration") return "轻快、温暖的纯音乐";
  return "你好，请回复「测试成功」。";
}

function testStatusLabel(status: string): string {
  return ({
    completed: "已完成",
    queued: "任务已提交",
    running: "运行中",
    failed: "失败",
    error: "错误",
    timeout: "超时",
    cancelled: "已取消",
  } as Record<string, string>)[status] || status;
}

export interface ProviderConnectionResult {
  providerId: string;
  config: ProviderConfig;
}

type NewModelDraft = {
  id: string;
  name: string;
  type: "textGeneration" | "imageGeneration" | "videoGeneration" | "audioGeneration";
  presetId: string;
};

export function ProviderConnectionDialog({
  editingId = "",
  initialConfig = null,
  connectedIds = [],
  submitting = false,
  submitError = "",
  onClose,
  onSave,
}: {
  editingId?: string;
  initialConfig?: ProviderConfig | null;
  connectedIds?: string[];
  submitting?: boolean;
  submitError?: string;
  onClose: () => void;
  onSave: (result: ProviderConnectionResult) => void | Promise<void>;
}) {
  const definitions = getProviderDefinitions();
  const editingDefinition = definitions.find((item) => item.id === editingId);
  const editingCustom = Boolean(
    editingId && (initialConfig?.custom === true || !editingDefinition),
  );
  const [selectedId, setSelectedId] = useState(
    editingCustom ? CUSTOM_PROVIDER_ID : editingId,
  );
  const [customId, setCustomId] = useState(editingCustom ? editingId : "");
  const selectedDefinition = definitions.find((item) => item.id === selectedId);
  const [displayName, setDisplayName] = useState(
    initialConfig?.displayName || editingDefinition?.name || "",
  );
  const [apiKey, setApiKey] = useState(initialConfig?.apiKey || "");
  const [baseUrl, setBaseUrl] = useState(
    initialConfig?.baseUrl || editingDefinition?.defaultBaseUrl || "",
  );
  const [iconId, setIconId] = useState(
    initialConfig?.iconId || editingDefinition?.iconId || "custom",
  );
  const [disabledIds, setDisabledIds] = useState<Set<string>>(() =>
    new Set(initialConfig?.disabledModelIds || [])
  );
  const initialModels = effectiveProviderModels(
    editingId,
    initialConfig?.models || [],
  );
  const [models, setModels] = useState<CatalogModel[]>(initialModels);
  const [selectedModelId, setSelectedModelId] = useState(
    initialModels[0]?.id || "",
  );
  const [modelJson, setModelJson] = useState(() =>
    initialModels[0] ? JSON.stringify(initialModels[0], null, 2) : ""
  );
  const [newModel, setNewModel] = useState<NewModelDraft | null>(null);
  const [error, setError] = useState("");
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
  const [testError, setTestError] = useState("");
  const [showProtocolHelp, setShowProtocolHelp] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const [aiPasteJson, setAiPasteJson] = useState("");
  const [aiPasteError, setAiPasteError] = useState("");
  const providerId = selectedId === CUSTOM_PROVIDER_ID
    ? customId.trim().toLowerCase()
    : selectedId;
  const builtInModelIds = useMemo(
    () => new Set(builtInProviderModels(providerId).map((model) => model.id)),
    [providerId],
  );
  const globalBuiltInModels = useMemo(
    () => new Map(getBuiltInCatalogModels().map((model) => [model.id, model])),
    [],
  );
  const availableDefinitions = definitions.filter((item) =>
    item.id === editingId || !connectedIds.includes(item.id)
  );

  function selectProvider(id: string) {
    setSelectedId(id);
    setError("");
    setNewModel(null);
    const definition = definitions.find((item) => item.id === id);
    if (definition && !editingId) {
      const nextModels = effectiveProviderModels(id);
      setDisplayName(definition.name);
      setBaseUrl(definition.defaultBaseUrl);
      setIconId(definition.iconId);
      setApiKey("");
      setDisabledIds(new Set());
      setModels(nextModels);
      setSelectedModelId(nextModels[0]?.id || "");
      setModelJson(nextModels[0] ? JSON.stringify(nextModels[0], null, 2) : "");
    }
    if (id === CUSTOM_PROVIDER_ID && !editingId) {
      setDisplayName("");
      setBaseUrl("");
      setIconId("custom");
      setApiKey("");
      setDisabledIds(new Set());
      setModels([]);
      setSelectedModelId("");
      setModelJson("");
    }
  }

  function commitModelDraft(): CatalogModel[] {
    if (!selectedModelId) return models;
    let parsed: CatalogModel;
    try {
      parsed = JSON.parse(modelJson || "{}") as CatalogModel;
    } catch {
      throw new Error("当前模型协议不是有效的 JSON");
    }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("单个模型协议必须是 JSON 对象，不能是数组");
    }
    const { model: committed } = normalizeCatalogModel({ ...parsed, provider: providerId });
    const validationErrors = catalogModelValidationErrors(committed, {
      requireProvider: Boolean(providerId),
    });
    if (validationErrors.length) throw new Error(validationErrors.join("；"));
    if (
      models.some((model) =>
        model.id === parsed.id && model.id !== selectedModelId
      )
    ) {
      throw new Error(`模型 ID “${parsed.id}” 已存在`);
    }
    const next = models.map((model) =>
      model.id === selectedModelId ? committed : model
    );
    setModels(next);
    setSelectedModelId(parsed.id);
    return next;
  }

  function selectModel(id: string) {
    try {
      const next = commitModelDraft();
      const selected = next.find((model) => model.id === id);
      if (!selected) return;
      setSelectedModelId(id);
      setModelJson(JSON.stringify(selected, null, 2));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "当前模型协议格式错误");
    }
  }

  function beginAddModel() {
    const baseId = `${providerId || "custom"}-model`;
    let currentModels = models;
    try {
      currentModels = commitModelDraft();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "当前模型协议格式错误");
      return;
    }
    const modelIds = new Set(currentModels.map((model) => model.id));
    let id = baseId;
    let suffix = 2;
    while (modelIds.has(id)) id = `${baseId}-${suffix++}`;
    setNewModel({ id, name: "", type: "textGeneration", presetId: "" });
    setError("");
  }

  function appendModel() {
    if (!newModel?.id.trim()) return setError("请填写模型 ID");
    if (!newModel.name.trim()) return setError("请填写模型名称");
    const id = newModel.id.trim();
    if (models.some((model) => model?.id === id)) {
      return setError(`模型 ID “${id}” 已存在`);
    }
    const preset = newModel.presetId ? getProtocolPreset(newModel.presetId) : undefined;
    const added = preset ? presetProtocolModel(preset) : starterProtocolModel(newModel.type);
    added.id = id;
    added.name = newModel.name.trim();
    added.provider = providerId;
    added.type = newModel.type;
    added.sortOrder = Math.max(
      900,
      ...models.map((model) => Number(model?.sortOrder) || 0),
    ) + 1;
    added.enabled = true;
    delete added.overridesBuiltIn;
    setModels((current) => [...current, added]);
    setSelectedModelId(added.id);
    setModelJson(JSON.stringify(added, null, 2));
    setNewModel(null);
    setError("");
  }

  function deleteModel(id: string) {
    if (builtInModelIds.has(id)) return;
    const next = models.filter((model) => model.id !== id);
    setModels(next);
    if (selectedModelId === id) {
      const selected = next[0];
      setSelectedModelId(selected?.id || "");
      setModelJson(selected ? JSON.stringify(selected, null, 2) : "");
    }
    setError("");
  }

  function toggleBuiltIn(id: string) {
    setDisabledIds((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function submit() {
    if (
      !providerId ||
      (selectedId === CUSTOM_PROVIDER_ID &&
        !/^[a-z0-9][a-z0-9:_-]{1,63}$/.test(providerId))
    ) {
      return setError(
        "厂商 ID 需为 2–64 位小写字母、数字、冒号、短横线或下划线",
      );
    }
    if (
      selectedId === CUSTOM_PROVIDER_ID &&
      definitions.some((definition) => definition.id === providerId)
    ) {
      return setError(`厂商 ID “${providerId}” 已被内置厂商保留`);
    }
    if (!editingId && connectedIds.includes(providerId)) {
      return setError(`厂商 ID “${providerId}” 已存在`);
    }
    if (!displayName.trim()) return setError("请填写厂商显示名称");
    if (!apiKey.trim()) return setError("请填写 API Key");
    const requiresBaseUrl = selectedId === CUSTOM_PROVIDER_ID ||
      selectedDefinition?.credentials.some((field) =>
        field.key === "baseUrl" && field.required
      );
    if (requiresBaseUrl && !baseUrl.trim()) {
      return setError("请填写 API Base URL");
    }
    if (baseUrl.trim()) {
      try {
        const parsed = new URL(baseUrl.trim());
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      } catch {
        return setError(
          "接口地址格式不正确，请填写完整的 http:// 或 https:// 地址",
        );
      }
    }
    let modelsToSave: CatalogModel[];
    try {
      const parsed = commitModelDraft();
      const providerBuiltIns = new Map(
        builtInProviderModels(providerId).map((model) => [model.id, model]),
      );
      modelsToSave = parsed.map((model) => (
        normalizeCatalogModel({ ...model, provider: providerId }).model
      ))
        .filter((model) => {
          const builtIn = providerBuiltIns.get(model.id);
          return !builtIn || !sameModelDefinition(model, builtIn);
        })
        .map((model) => globalBuiltInModels.has(model.id)
          ? { ...model, overridesBuiltIn: true }
          : model);
      for (const model of modelsToSave) {
        const validationErrors = catalogModelValidationErrors(model, { requireProvider: true });
        if (validationErrors.length) throw new Error(validationErrors.join("；"));
      }
    } catch (cause) {
      return setError(
        cause instanceof Error ? cause.message : "自定义模型 JSON 格式错误",
      );
    }
    setError("");
    await onSave({
      providerId,
      config: {
        displayName: displayName.trim(),
        custom: selectedId === CUSTOM_PROVIDER_ID,
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim() || selectedDefinition?.defaultBaseUrl || "",
        iconId,
        models: clone(modelsToSave),
        disabledModelIds: [...disabledIds],
      },
    });
  }

  async function runTest() {
    if (!selectedModelId) return setTestError("请先选择要试跑的模型");
    if (!baseUrl.trim()) return setTestError("请填写 API Base URL");
    let parsed: CatalogModel;
    try {
      parsed = JSON.parse(modelJson || "{}") as CatalogModel;
    } catch {
      return setTestError("当前模型协议不是有效的 JSON");
    }
    if (!parsed || !parsed.id || !Array.isArray(parsed.modes) || !parsed.modes.length) {
      return setTestError("当前模型缺少 id、type 或 modes");
    }
    const { model } = normalizeCatalogModel({ ...parsed, provider: providerId });
    const validationErrors = catalogModelValidationErrors(model, { requireProvider: true });
    if (validationErrors.length) return setTestError(validationErrors.join("；"));
    setTestRunning(true);
    setTestResult(null);
    setTestError("");
    try {
      const result = await testProviderRequest({
        model,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        prompt: testPromptForType(model.type),
      });
      setTestResult(result);
    } catch (cause) {
      setTestError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setTestRunning(false);
    }
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(protocolAuthoringPrompt);
      setPromptCopied(true);
      window.setTimeout(() => setPromptCopied(false), 2000);
    } catch {
      setError("复制失败，请手动选中文本复制");
    }
  }

  function importAiJson() {
    if (!aiPasteJson.trim()) return setAiPasteError("请先粘贴 AI 返回的 JSON");
    let parsed: CatalogModel;
    try {
      parsed = JSON.parse(aiPasteJson) as CatalogModel;
    } catch {
      return setAiPasteError("粘贴的内容不是有效的 JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return setAiPasteError("顶层必须是单个模型 JSON 对象");
    }
    const id = String(parsed.id || "").trim();
    if (models.some((model) => model?.id === id)) {
      return setAiPasteError(`模型 ID "${id}" 已存在`);
    }
    const imported: CatalogModel = {
      ...clone(parsed),
      id,
      name: String(parsed.name || "").trim() || id,
      provider: providerId,
      sortOrder: Math.max(900, ...models.map((model) => Number(model?.sortOrder) || 0)) + 1,
      enabled: true,
      defaultMode: Array.isArray(parsed.modes) && parsed.modes.some((mode) => mode.id === parsed.defaultMode)
        ? parsed.defaultMode
        : parsed.modes?.[0]?.id || "",
    };
    const { model: added } = normalizeCatalogModel(imported);
    const validationErrors = catalogModelValidationErrors(added, { requireProvider: true });
    if (validationErrors.length) return setAiPasteError(validationErrors.join("；"));
    delete added.overridesBuiltIn;
    setModels((current) => [...current, added]);
    setSelectedModelId(added.id);
    setModelJson(JSON.stringify(added, null, 2));
    setAiPasteJson("");
    setAiPasteError("");
    setError("");
  }

  return (
    <div
      className="recipe-dialog-backdrop"
      onMouseDown={(event) =>
        event.target === event.currentTarget && !submitting && onClose()}
    >
      <section
        className="recipe-dialog provider-connection-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={editingId ? "编辑 API 厂商" : "添加 API 厂商"}
      >
        <header>
          <div>
            <h3>{editingId ? "编辑 API 厂商" : "添加 API 厂商"}</h3>
            <p className="recipe-dialog-change-summary">
              凭据仅保存在本机；模型协议随项目运行时统一路由。
            </p>
          </div>
          <button
            className="icon-action"
            type="button"
            disabled={submitting}
            onClick={onClose}
          >
            <IconSymbol name="x" />
          </button>
        </header>
        <div className="recipe-dialog-body">
          <div className="recipe-form-grid provider-connection-form-grid">
            <label className="recipe-field">
              <span>厂商类型</span>
              <select
                value={selectedId}
                disabled={Boolean(editingId)}
                onChange={(event) => selectProvider(event.target.value)}
              >
                <option value="">选择厂商</option>
                {availableDefinitions.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
                <option value={CUSTOM_PROVIDER_ID}>自定义厂商</option>
              </select>
            </label>
            {selectedId === CUSTOM_PROVIDER_ID && (
              <label className="recipe-field">
                <span>厂商 ID</span>
                <input
                  value={customId}
                  disabled={Boolean(editingId)}
                  placeholder="my-provider"
                  onChange={(event) => setCustomId(event.target.value)}
                />
              </label>
            )}
            <label className="recipe-field">
              <span>显示名称</span>
              <input
                value={displayName}
                placeholder="厂商名称"
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <label className="recipe-field">
              <span>品牌图标</span>
              <ProviderIconSelect
                value={iconId}
                disabled={submitting}
                onChange={setIconId}
              />
            </label>
          </div>
          <label className="recipe-field">
            <span>API Key</span>
            <input
              value={apiKey}
              type="password"
              autoComplete="off"
              placeholder="仅保存在本机设置"
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
          <label className="recipe-field">
            <span>API Base URL</span>
            <input
              value={baseUrl}
              spellCheck={false}
              placeholder={selectedDefinition?.defaultBaseUrl ||
                "https://api.example.com/v1"}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </label>
          <section className="provider-model-section">
            <div className="provider-model-heading">
              <div>
                <strong>用 AI 生成协议</strong>
                <span className="provider-model-count">
                  不写 JSON：复制提示词 → 贴给任意 AI（附上你的 API 文档/样例）→ 粘回结果
                </span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="provider-inline-action"
                  type="button"
                  onClick={() => void copyPrompt()}
                >
                  {promptCopied ? "已复制 ✓" : "复制提示词"}
                </button>
                <button
                  className="provider-inline-action"
                  type="button"
                  onClick={() => setShowProtocolHelp((value) => !value)}
                >
                  {showProtocolHelp ? "收起字段说明" : "字段说明"}
                </button>
              </div>
            </div>
            {showProtocolHelp && (
              <pre
                style={{
                  whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 320,
                  overflow: "auto", padding: 12, borderRadius: 6, fontSize: 12,
                  lineHeight: 1.5, background: "rgba(0,0,0,0.04)",
                }}
              >
                {protocolAuthoringPrompt}
              </pre>
            )}
            <label className="recipe-field recipe-prompt-field">
              <span>粘贴 AI 返回的 JSON</span>
              <textarea
                value={aiPasteJson}
                rows={6}
                spellCheck={false}
                placeholder="把 AI 返回的模型 JSON 粘贴到这里…"
                onChange={(event) => {
                  setAiPasteJson(event.target.value);
                  setAiPasteError("");
                }}
              />
            </label>
            <div className="provider-model-create-actions">
              <span>AI 返回的是单个模型 JSON 对象，导入后成为当前厂商的一个模型。</span>
              <div>
                <button
                  className="button primary"
                  type="button"
                  disabled={submitting}
                  onClick={importAiJson}
                >
                  导入为模型
                </button>
              </div>
            </div>
            {aiPasteError && (
              <p className="recipe-dialog-error">{aiPasteError}</p>
            )}
          </section>
          <section className="provider-model-section">
            <div className="provider-model-heading">
              <div>
                <strong>模型</strong>
                <span className="provider-model-count">
                  {models.length} 个模型，选择后编辑单个协议
                </span>
              </div>
              <button
                className="provider-inline-action"
                type="button"
                disabled={!providerId || submitting || Boolean(newModel)}
                onClick={beginAddModel}
              >
                + 添加模型
              </button>
            </div>
            {models.length > 0 ? (
              <div className="provider-model-list">
                {models.map((model) => {
                  const builtIn = builtInModelIds.has(model.id);
                  const replacedBuiltIn = builtIn
                    ? null
                    : globalBuiltInModels.get(model.id);
                  const disabled = builtIn && disabledIds.has(model.id);
                  let originLabel = "自定义";
                  if (builtIn) originLabel = "内置";
                  else if (replacedBuiltIn) {
                    originLabel = `覆盖内置 ${replacedBuiltIn.provider}`;
                  }
                  return (
                    <div
                      key={model.id}
                      className={`provider-model-item${
                        disabled ? " disabled" : ""
                      }${selectedModelId === model.id ? " active" : ""}`}
                    >
                      <button
                        className="provider-model-select"
                        type="button"
                        onClick={() => selectModel(model.id)}
                      >
                        <strong>{model.name}</strong>
                        <code>{model.id}</code>
                        <span className="provider-model-meta">
                          <span>{modelTypeLabel(model.type)}</span>
                          <span aria-hidden="true">·</span>
                          <span className={`provider-model-origin${
                            replacedBuiltIn ? " override" : ""
                          }`}>
                            {originLabel}
                          </span>
                        </span>
                      </button>
                      <div className="provider-model-item-actions">
                        {builtIn ? (
                          <button
                            type="button"
                            onClick={() => toggleBuiltIn(model.id)}
                          >
                            {disabled ? "启用" : "停用"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => deleteModel(model.id)}
                          >
                            删除
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="provider-model-empty">
                还没有模型，点击“添加模型”创建第一个。
              </div>
            )}
          </section>
          {newModel && (
            <section className="provider-model-create" aria-label="添加模型">
              <div className="provider-model-create-grid">
                <label className="recipe-field">
                  <span>模型 ID</span>
                  <input
                    value={newModel.id}
                    autoFocus
                    placeholder="model-id"
                    onChange={(event) =>
                      setNewModel({ ...newModel, id: event.target.value })}
                  />
                </label>
                <label className="recipe-field">
                  <span>模型名称</span>
                  <input
                    value={newModel.name}
                    placeholder="模型显示名称"
                    onChange={(event) =>
                      setNewModel({ ...newModel, name: event.target.value })}
                  />
                </label>
                <label className="recipe-field">
                  <span>生成类型</span>
                  <select
                    value={newModel.type}
                    onChange={(event) =>
                      setNewModel({
                        ...newModel,
                        type: event.target.value as NewModelDraft["type"],
                        presetId: "",
                      })}
                  >
                    <option value="textGeneration">文本生成</option>
                    <option value="imageGeneration">图片生成</option>
                    <option value="videoGeneration">视频生成</option>
                    <option value="audioGeneration">音频生成</option>
                  </select>
                </label>
                <label className="recipe-field">
                  <span>协议预设</span>
                  <select
                    value={newModel.presetId}
                    onChange={(event) =>
                      setNewModel({ ...newModel, presetId: event.target.value })
                    }
                  >
                    <option value="">空白协议</option>
                    {presetsForType(newModel.type).map((preset) => (
                      <option key={preset.id} value={preset.id}>{preset.label}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="provider-model-create-actions">
                <span>选择预设可自动填好 endpoint、请求模板和结果路径，也可从空白协议开始。</span>
                <div>
                  <button
                    className="button ghost"
                    type="button"
                    onClick={() => setNewModel(null)}
                  >
                    取消
                  </button>
                  <button
                    className="button primary"
                    type="button"
                    onClick={appendModel}
                  >
                    创建并编辑协议
                  </button>
                </div>
              </div>
            </section>
          )}
          {selectedModelId && !newModel && (
            <div className="provider-model-protocol-heading">
              <div>
                <strong>单模型协议</strong>
                <span>
                  当前只编辑 {selectedModelId}，保存厂商时自动汇总模型目录。
                </span>
              </div>
            </div>
          )}
          {selectedModelId && !newModel && (
            <label className="recipe-field recipe-prompt-field">
              <span>模型 JSON</span>
              <textarea
                value={modelJson}
                rows={12}
                spellCheck={false}
                placeholder="{}"
                onChange={(event) => {
                  setModelJson(event.target.value);
                  setError("");
                }}
              />
              <small>
                每次仅编辑一个 CatalogModel 对象。可配置 endpoint、异步任务查询、参数、认证、请求模板和结果路径。
              </small>
            </label>
          )}
          {selectedModelId && !newModel && (
            <div className="provider-model-heading">
              <div>
                <strong>试跑</strong>
                <span className="provider-model-count">
                  用当前协议发送一次真实请求，验证地址、Key 和结果路径
                </span>
              </div>
              <button
                className="provider-inline-action"
                type="button"
                disabled={testRunning || submitting}
                onClick={() => void runTest()}
              >
                {testRunning ? "请求中…" : "发送测试请求"}
              </button>
            </div>
          )}
          {testError && (
            <p className="recipe-dialog-error">{testError}</p>
          )}
          {testResult && (
            <div className="provider-test-result">
              <p className="provider-test-status">
                状态：{testStatusLabel(testResult.status)}
                {testResult.remoteTaskId ? ` · 任务 ID：${testResult.remoteTaskId}` : ""}
              </p>
              <pre
                className="provider-test-raw"
                style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 240, overflow: "auto" }}
              >
                {JSON.stringify(testResult, null, 2)}
              </pre>
            </div>
          )}
          {(error || submitError) && (
            <p className="recipe-dialog-error">{error || submitError}</p>
          )}
        </div>
        <footer>
          <button
            className="button ghost"
            type="button"
            disabled={submitting}
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="button primary"
            type="button"
            disabled={submitting}
            onClick={() => void submit()}
          >
            {submitting ? "保存中…" : "保存"}
          </button>
        </footer>
      </section>
    </div>
  );
}
