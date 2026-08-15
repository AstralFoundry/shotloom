import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  getBuiltInAdapterTemplates,
  getBuiltInCatalogModels,
  getBuiltInProviderPackage,
} from "../../domain/catalog/ModelCatalog";
import {
  compileProviderModels,
  type ProviderModelBinding,
  type ProviderProtocolAdapter,
} from "../../domain/provider/ProviderAdapterContract";
import {
  getProviderDefinitions,
  type ProviderConfig,
} from "../../domain/provider/ProviderRegistry";
import {
  getProviderIcon,
  PROVIDER_ICON_OPTIONS,
} from "../../domain/provider/ProviderBrandIcons.js";
import { modelTypeLabel } from "../../utils/modelPresentation.js";
import { IconSymbol } from "../components/IconSymbol";
import { ProviderBrandIcon } from "../components/ProviderBrandIcon";

const CUSTOM_PROVIDER_ID = "__custom__";
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
      >
        <ProviderBrandIcon icon={selectedIcon?.id || "openai"} />
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

export interface ProviderConnectionResult {
  providerId: string;
  config: ProviderConfig;
}

export function ProviderConnectionDialog({
  editingId = "",
  initialConfig = null,
  connectedIds = [],
  protocolAdapters = [],
  submitting = false,
  submitError = "",
  onClose,
  onSave,
}: {
  editingId?: string;
  initialConfig?: ProviderConfig | null;
  connectedIds?: string[];
  protocolAdapters?: ProviderProtocolAdapter[];
  submitting?: boolean;
  submitError?: string;
  onClose: () => void;
  onSave: (result: ProviderConnectionResult) => void | Promise<void>;
}) {
  const definitions = getProviderDefinitions();
  const editingDefinition = definitions.find((item) => item.id === editingId);
  const editingCustom = Boolean(editingId && !editingDefinition);
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
    initialConfig?.iconId || editingDefinition?.iconId || "openai",
  );
  const [disabledIds, setDisabledIds] = useState<Set<string>>(
    () => new Set(initialConfig?.disabledModelIds || []),
  );
  const [bindings, setBindings] = useState<ProviderModelBinding[]>(() =>
    clone(initialConfig?.modelBindings || []),
  );
  const [quickAdapterId, setQuickAdapterId] = useState(
    initialConfig?.modelBindings?.[0]?.adapterId || "",
  );
  const [batchModels, setBatchModels] = useState("");
  const [error, setError] = useState("");

  const providerId =
    selectedId === CUSTOM_PROVIDER_ID
      ? customId.trim().toLowerCase()
      : selectedId;
  const builtInModels = useMemo(
    () => getBuiltInCatalogModels(providerId),
    [providerId],
  );
  const builtInPackage = useMemo(
    () => getBuiltInProviderPackage(providerId),
    [providerId],
  );
  const adapterOptions = useMemo(() => {
    const byId = new Map<
      string,
      { adapter: ProviderProtocolAdapter; providerId: string; custom: boolean }
    >();
    getBuiltInAdapterTemplates().forEach((item) => {
      byId.set(item.adapter.id, {
        adapter: item.adapter,
        providerId: item.providerId,
        custom: false,
      });
    });
    protocolAdapters.forEach((adapter) => {
      byId.set(adapter.id, { adapter, providerId: "custom", custom: true });
    });
    return [...byId.values()].sort((left, right) => {
      const providerDifference =
        Number(right.providerId === providerId) -
        Number(left.providerId === providerId);
      if (providerDifference) return providerDifference;
      return left.adapter.name.localeCompare(right.adapter.name, "zh-CN");
    });
  }, [protocolAdapters, providerId]);
  const allAdapters = useMemo(
    () => adapterOptions.map((item) => item.adapter),
    [adapterOptions],
  );
  const availableDefinitions = definitions.filter(
    (item) => item.id === editingId || !connectedIds.includes(item.id),
  );

  useEffect(() => {
    if (adapterOptions.some((item) => item.adapter.id === quickAdapterId)) {
      return;
    }
    const preferred = adapterOptions.find(
      (item) => item.providerId === providerId,
    );
    setQuickAdapterId(preferred?.adapter.id || "");
  }, [adapterOptions, providerId, quickAdapterId]);

  function selectProvider(id: string) {
    setSelectedId(id);
    setBindings([]);
    setBatchModels("");
    setQuickAdapterId("");
    setError("");
    if (editingId) return;
    const definition = definitions.find((item) => item.id === id);
    if (definition) {
      setDisplayName(definition.name);
      setBaseUrl(definition.defaultBaseUrl);
      setIconId(definition.iconId);
      setApiKey("");
      setDisabledIds(new Set());
    } else if (id === CUSTOM_PROVIDER_ID) {
      setDisplayName("");
      setBaseUrl("");
      setIconId("openai");
    }
  }

  function addBatchBindings() {
    const adapter = allAdapters.find((item) => item.id === quickAdapterId);
    if (!adapter) return setError("请先选择一个协议模板");
    const rows = batchModels
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf("|");
        const id = (separator >= 0 ? line.slice(0, separator) : line).trim();
        const name =
          (separator >= 0 ? line.slice(separator + 1) : line).trim() || id;
        return { id, name };
      });
    if (!rows.length) return setError("请至少填写一个模型 ID");
    const ids = new Set<string>();
    for (const row of rows) {
      if (!row.id) return setError("模型 ID 不能为空");
      if (ids.has(row.id)) {
        return setError(`批量清单中的模型 ID “${row.id}” 重复`);
      }
      if (bindings.some((binding) => binding.id === row.id)) {
        return setError(`模型 ${row.id} 已经存在`);
      }
      if (builtInPackage.bindings.some((binding) => binding.id === row.id)) {
        return setError(`模型 ${row.id} 已是当前厂商的内置模型，无需重复添加`);
      }
      ids.add(row.id);
    }
    const added = rows.map<ProviderModelBinding>((row, index) => ({
      kind: "model",
      id: row.id,
      name: row.name,
      type: adapter.type,
      adapterId: adapter.id,
      sortOrder: 900 + bindings.length + index,
      enabled: true,
    }));
    const next = [...bindings, ...added];
    compileProviderModels(providerId || "__draft__", allAdapters, next);
    setBindings(next);
    setBatchModels("");
    setError("");
  }

  function deleteBinding(id: string) {
    setBindings((current) => current.filter((binding) => binding.id !== id));
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
    if (!editingId && connectedIds.includes(providerId)) {
      return setError(`厂商 ID “${providerId}” 已存在`);
    }
    if (!displayName.trim()) return setError("请填写厂商显示名称");
    if (!apiKey.trim()) return setError("请填写 API Key");
    if (
      (selectedId === CUSTOM_PROVIDER_ID ||
        selectedDefinition?.credentials.some(
          (field) => field.key === "baseUrl" && field.required,
        )) &&
      !baseUrl.trim()
    ) {
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
    try {
      compileProviderModels(providerId, allAdapters, bindings);
    } catch (cause) {
      return setError(
        cause instanceof Error ? cause.message : "模型 Binding 配置错误",
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
        modelBindings: clone(bindings),
        disabledModelIds: [...disabledIds],
      },
    });
  }

  return (
    <div
      className="recipe-dialog-backdrop"
      onMouseDown={(event) =>
        event.target === event.currentTarget && !submitting && onClose()
      }
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
              这里只管理凭据和模型路由；请求协议在“协议设置”中统一维护。
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
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
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
              placeholder={
                selectedDefinition?.defaultBaseUrl ||
                "https://api.example.com/v1"
              }
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </label>

          {builtInModels.length > 0 && (
            <section className="provider-model-section">
              <div className="provider-model-heading">
                <div>
                  <strong>内置模型</strong>
                  <span className="provider-model-count">
                    选择当前厂商在画布中可用的模型。
                  </span>
                </div>
              </div>
              <div className="provider-model-list">
                {builtInModels.map((model) => {
                  const disabled = disabledIds.has(model.id);
                  return (
                    <div
                      key={model.id}
                      className={`provider-model-item${
                        disabled ? " disabled" : ""
                      }`}
                    >
                      <div className="provider-model-select">
                        <strong>{model.name}</strong>
                        <code>{model.id}</code>
                        <span className="provider-model-meta">
                          {modelTypeLabel(model.type)}
                        </span>
                      </div>
                      <div className="provider-model-item-actions">
                        <button
                          type="button"
                          onClick={() =>
                            setDisabledIds((current) => {
                              const next = new Set(current);
                              next.has(model.id)
                                ? next.delete(model.id)
                                : next.add(model.id);
                              return next;
                            })
                          }
                        >
                          {disabled ? "启用" : "停用"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="provider-quick-connect">
            <div className="provider-model-heading">
              <div>
                <strong>添加模型</strong>
                <span className="provider-model-count">
                  从全局协议库选择协议，一次添加全部模型。
                </span>
              </div>
            </div>
            <div className="provider-quick-connect-grid">
              <label className="recipe-field">
                <span>使用协议</span>
                <select
                  value={quickAdapterId}
                  onChange={(event) => {
                    setQuickAdapterId(event.target.value);
                    setError("");
                  }}
                >
                  <option value="">选择厂商兼容的 API 协议</option>
                  {adapterOptions.map((item) => (
                    <option key={item.adapter.id} value={item.adapter.id}>
                      {item.adapter.name} · {modelTypeLabel(item.adapter.type)}{" "}
                      ·{item.custom ? "自定义" : item.providerId}
                    </option>
                  ))}
                </select>
                <small>没有合适协议时，请先前往“协议设置”创建。</small>
              </label>
              <label className="recipe-field recipe-prompt-field">
                <span>模型清单</span>
                <textarea
                  value={batchModels}
                  rows={6}
                  spellCheck={false}
                  placeholder={
                    "每行一个模型：\nmodel-id | 显示名称\nmodel-id-2 | 显示名称 2"
                  }
                  onChange={(event) => {
                    setBatchModels(event.target.value);
                    setError("");
                  }}
                />
                <small>只写模型 ID 也可以，显示名称会默认使用 ID。</small>
              </label>
            </div>
            <div className="provider-quick-connect-actions">
              <span>无需为每个模型重复编写协议 JSON</span>
              <button
                className="button primary"
                type="button"
                disabled={!providerId || !quickAdapterId || !batchModels.trim()}
                onClick={addBatchBindings}
              >
                批量添加模型
              </button>
            </div>
          </section>

          {bindings.length > 0 && (
            <section className="provider-model-section">
              <div className="provider-model-heading">
                <div>
                  <strong>自定义模型</strong>
                  <span className="provider-model-count">
                    {bindings.length} 个模型已绑定到全局协议。
                  </span>
                </div>
              </div>
              <div className="provider-model-list">
                {bindings.map((binding) => (
                  <div key={binding.id} className="provider-model-item">
                    <div className="provider-model-select">
                      <strong>{binding.name}</strong>
                      <code>{binding.id}</code>
                      <span className="provider-model-meta">
                        {modelTypeLabel(binding.type)} · {binding.adapterId}
                      </span>
                    </div>
                    <div className="provider-model-item-actions">
                      <button
                        type="button"
                        onClick={() => deleteBinding(binding.id)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
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
