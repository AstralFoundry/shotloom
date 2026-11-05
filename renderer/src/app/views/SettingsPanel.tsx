import { t } from '@/i18n';
import {
  useEffect,
  useRef,
  useState,
} from "react";
import { type IconName, IconSymbol } from "../components/IconSymbol";
import { ProviderBrandIcon } from "../components/ProviderBrandIcon";
import type { ProviderModelRow } from "../../domain/provider/ModelAvailability";

export interface SettingsModel {
  id: string;
  label: string;
  iconId: string;
}
export interface ProviderItem {
  id: string;
  name: string;
  description: string;
  iconId: string;
  apiKey: string;
  baseUrl: string;
  baseUrlRequired: boolean;
  configured: boolean;
  models: ProviderModelRow[];
}
export interface ProviderConfigPatch {
  apiKey?: string;
  baseUrl?: string;
}
export interface SettingsData {
  locale?: string;
  projectRootDir: string;
  downloadDir: string;
  pollInterval: number;
  projectModels: Record<string, string>;
  agentModels: Record<string, string>;
  availableModels: Record<string, SettingsModel[]>;
  agentToggles: Record<string, boolean | string>;
  providers: ProviderItem[];
  shortcutLabels: Record<string, string>;
}
export interface SettingsController {
  setLocale?: (locale: string) => void | Promise<void>;
  selectProjectRoot: () => void | Promise<void>;
  selectDownloadDir: () => void | Promise<void>;
  clearDownloadDir: () => void | Promise<void>;
  setPollInterval: (value: number) => void | Promise<void>;
  setProjectModel: (key: string, value: string) => void;
  setAgentModel: (key: string, value: string) => void | Promise<void>;
  setAgentToggle: (key: string, value: boolean | string) => void | Promise<void>;
  recordShortcut: (key: string) => void;
  resetShortcuts: () => void | Promise<void>;
  setProviderConfig: (
    id: string,
    patch: ProviderConfigPatch,
  ) => void | Promise<void>;
}

type Tab = "general" | "canvas" | "providers" | "agent";
const groups: Array<
  {
    label: string;
    items: Array<
      { id: Tab; label: string; icon: IconName; description: string }
    >;
  }
> = [
  {
    label: t("ui.SettingsPanel.label.a1ff8da4"),
    items: [{
      id: "general",
      label: t("settings.general"),
      icon: "sliders",
      description: t("ui.SettingsPanel.description.0d86daf6"),
    }, {
      id: "canvas",
      label: t("ui.ProjectSearch.kind.95b2102f"),
      icon: "grid",
      description: t("ui.SettingsPanel.description.aec5cf47"),
    }],
  },
  {
    label: t("ui.SettingsPanel.label.c0875dd1"),
    items: [{
      id: "providers",
      label: t("ui.SettingsPanel.label.795fa912"),
      icon: "link",
      description: t("ui.SettingsPanel.description.5f0c6b28"),
    }, {
      id: "agent",
      label: "Agent",
      icon: "spark",
      description: t("ui.SettingsPanel.description.9583bbd0"),
    }],
  },
];
const modelRows = [
  [
    "defaultImageModel",
    "imageGeneration",
    t("ui.SettingsPanel.text.39c26c8a"),
    t("ui.SettingsPanel.text.72cb0687"),
  ],
  [
    "defaultTextModel",
    "textGeneration",
    t("ui.SettingsPanel.text.640a8213"),
    t("ui.SettingsPanel.text.78f06cbe"),
  ],
  [
    "defaultVideoModel",
    "videoGeneration",
    t("ui.SettingsPanel.text.9210566c"),
    t("ui.SettingsPanel.text.72423381"),
  ],
] as const;
const agentRows = [
  [
    "agentPreferredTextModel",
    "textGeneration",
    t("ui.SettingsPanel.text.b2a9e487"),
    t("ui.SettingsPanel.text.c10e0cc3"),
  ],
  [
    "agentPreferredImageModel",
    "imageGeneration",
    t("ui.SettingsPanel.text.f581bd77"),
    t("ui.SettingsPanel.text.5fdb427d"),
  ],
  ["agentPreferredVideoModel", "videoGeneration", t("ui.SettingsPanel.text.5c293e15"), t("ui.SettingsPanel.text.8a06d5c3")],
] as const;
const toggleRows = [
  [
    "agentCanRunNodes",
    t("ui.SettingsPanel.text.0050c8d7"),
    t("ui.SettingsPanel.text.a1c80c44"),
  ],
  [
    "agentAutoEval",
    t("ui.SettingsPanel.text.0d1c91aa"),
    t("ui.SettingsPanel.text.1f7ccf1e"),
  ],
  [
    "agentAutoLayout",
    t("ui.SettingsPanel.text.c88a2b42"),
    t("ui.SettingsPanel.text.0f0a2f0c"),
  ],
] as const;

const canvasShortcutRows = [
  ["fitView", t("ui.BottomModeBar.label.a187522f"), t("ui.SettingsPanel.text.13fa291b")],
  ["autoLayout", t("ui.canvasAdapter.text.7ea05931"), t("ui.SettingsPanel.text.245ea5e1")],
] as const;

function ModelSelect(
  { value, models, onChange }: {
    value: string;
    models: SettingsModel[];
    onChange: (value: string) => void;
  },
) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const selected = models.find((model) => model.id === value);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return (
    <div ref={root} className="settings-model-select">
      <button
        type="button"
        className="settings-model-trigger"
        disabled={!models.length}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {selected && <ProviderBrandIcon className="settings-model-icon" icon={selected.iconId} />}
        <span>{selected?.label || t("ui.SettingsPanel.text.5fd36376")}</span>
        <IconSymbol name="chevron-down" />
      </button>
      {open && (
        <div className="settings-model-menu">
          {models.map((model) => (
            <button
              key={model.id}
              type="button"
              className={model.id === value ? "active" : ""}
              onClick={() => { onChange(model.id); setOpen(false); }}
            >
              <ProviderBrandIcon className="settings-model-icon" icon={model.iconId} />
              <span><strong>{model.label}</strong></span>
              {model.id === value && <IconSymbol name="check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const MODEL_INPUT_LABELS: Record<ProviderModelRow["inputs"][number], string> = {
  image: t("ui.canvasMediaActions.text.be8da62e"),
  video: t("ui.canvasMediaActions.text.fa4e33b6"),
  audio: t("ui.canvasAdapter.label.461189f1"),
};

function groupProviderModels(models: ProviderModelRow[]) {
  const groups = new Map<string, ProviderModelRow[]>();
  for (const model of models) {
    const group = groups.get(model.typeLabel);
    if (group) group.push(model);
    else groups.set(model.typeLabel, [model]);
  }
  return [...groups];
}

function ProviderCard(
  { item, onChange }: {
    item: ProviderItem;
    onChange: (id: string, patch: ProviderConfigPatch) => void | Promise<void>;
  },
) {
  const [draft, setDraft] = useState({
    apiKey: item.apiKey,
    baseUrl: item.baseUrl,
  });
  useEffect(
    () => setDraft({ apiKey: item.apiKey, baseUrl: item.baseUrl }),
    [item.apiKey, item.baseUrl],
  );
  // 只有实际改动才落盘，避免失焦就写一次设置。
  function commit(field: "apiKey" | "baseUrl") {
    const next = draft[field].trim();
    if (next === item[field]) return;
    void onChange(item.id, { [field]: next });
  }
  const urlMissing = item.baseUrlRequired && !item.baseUrl.trim();
  return (
    <section className="provider-detail">
      <div className="provider-card-head">
        <span className="provider-badge">
          <ProviderBrandIcon icon={item.iconId} />
        </span>
        <div className="provider-card-title">
          <strong>{item.name}</strong>
          <small>{item.description} · {item.models.length} {t("ui.SettingsPanel.text.dd861cb3")}</small>
        </div>
        <span
          className={item.configured ? "provider-configured" : "provider-incomplete"}
          title={item.configured
            ? t("ui.SettingsPanel.text.89e6c087")
            : t("ui.SettingsPanel.text.09dded24")}
        >
          <i />{item.configured ? t("ui.SettingsPanel.text.dc7cd22f") : t("ui.CanvasNodes.text.63595e95")}
        </span>
      </div>
      <div className="provider-card-fields">
        <label className="provider-field">
          <span>API Key</span>
          <input
            type="password"
            value={draft.apiKey}
            placeholder={item.configured ? t("ui.SettingsPanel.text.16813761") : t("ui.SettingsPanel.text.a37e9033")}
            onChange={(e) => setDraft((d) => ({ ...d, apiKey: e.target.value }))}
            onBlur={() => commit("apiKey")}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        </label>
        <label className="provider-field">
          <span>{t("ui.SettingsPanel.text.29f5babe")}</span>
          <input
            value={draft.baseUrl}
            placeholder={urlMissing ? t("ui.SettingsPanel.text.8d0f2606") : t("ui.SettingsPanel.text.b6047c89")}
            onChange={(e) => setDraft((d) => ({ ...d, baseUrl: e.target.value }))}
            onBlur={() => commit("baseUrl")}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        </label>
      </div>
      <div className="provider-models">
        {groupProviderModels(item.models).map(([label, models]) => (
          <div className="provider-model-group" key={label}>
            <div className="provider-model-group-label">
              <strong>{label}</strong>
              <span>{models.length} {t("ui.SettingsPanel.text.674373ae")}</span>
            </div>
            <div className="provider-model-list">
              {models.map((model) => (
                <div
                  className="provider-model-card"
                  key={model.id}
                >
                  <div className="provider-model-card-main">
                    <strong>{model.name}</strong>
                    <small title={model.id}>{model.id}</small>
                  </div>
                  <div className="provider-model-card-meta">
                    {model.inputs.map((kind) => (
                      <span className="provider-model-input" key={kind}>{MODEL_INPUT_LABELS[kind]}{t("ui.SettingsPanel.text.e8850440")}</span>
                    ))}
                    <span className={model.agentReady ? "provider-model-agent" : "provider-model-canvas-only"}>
                      {model.agentReady ? t("ui.SettingsPanel.text.b79aff63") : t("ui.SettingsPanel.text.fcf0100d")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function SettingsPanel(
  { data, controller }: {
    data: SettingsData;
    controller: SettingsController;
  },
) {
  const [tab, setTab] = useState<Tab>("general");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const selectedProvider = data.providers.find((item) => item.id === selectedProviderId);
  const contentScroll = useRef<HTMLDivElement>(null);
  const meta = groups.flatMap((group) => group.items).find((item) =>
    item.id === tab
  )!;

  return (
    <div className="settings-panel">
      <nav className="settings-nav" aria-label={t("ui.SettingsPanel.arialabel.f7bbde69")}>
        <p className="settings-nav-label">{t("ui.SettingsPanel.text.de493971")}</p>
        {groups.map((group) => (
          <div key={group.label} className="settings-nav-group">
            <p>{group.label}</p>
            {group.items.map((item) => (
              <button
                key={item.id}
                className={tab === item.id ? "active" : ""}
                onClick={() => {
                  setTab(item.id);
                  setSelectedProviderId(null);
                }}
              >
                <IconSymbol name={item.icon} />
                <span>{item.label}</span>
                {item.id === "providers" && <em>{data.providers.length}</em>}
              </button>
            ))}
          </div>
        ))}
        <div className="settings-nav-note">
          <IconSymbol name="help" />
          <span>{t("ui.SettingsPanel.text.fdfa533d")}</span>
        </div>
      </nav>
      <main className="settings-content">
        <header className="settings-content-head">
          <div>
            <h3>{selectedProvider && tab === "providers" ? selectedProvider.name : meta.label}</h3>
            <p>{selectedProvider && tab === "providers" ? selectedProvider.description : meta.description}</p>
          </div>
          {tab === "canvas" && (
            <button
              className="button ghost compact"
              onClick={() => void controller.resetShortcuts()}
            >
              {t("ui.CameraControlPanel.text.a191935b")}</button>
          )}
        </header>
        <div className="settings-content-scroll" ref={contentScroll}>
          {tab === "general" && (
            <>
              <section className="settings-section">
                <div className="settings-row">
                  <div><strong>{t('settings.language')}</strong><span>{t('settings.languageReload')}</span></div>
                  <select aria-label={t('settings.language')} value={data.locale || 'zh-CN'}
                    onChange={event => void controller.setLocale?.(event.target.value)}>
                    <option value="zh-CN">简体中文</option><option value="en-US">English</option>
                  </select>
                </div>
                <h4>{t("ui.SettingsPanel.text.93ded934")}</h4>
                <div className="settings-row">
                  <div>
                    <strong>{t("ui.SettingsPanel.text.4646bc3c")}</strong>
                    <span>{t("ui.SettingsPanel.text.2f3d4c66")}</span>
                  </div>
                  <div className="input-with-action settings-control-wide">
                    <input
                      value={data.projectRootDir}
                      readOnly
                      placeholder={t("ui.SettingsPanel.placeholder.42cf800f")}
                    />
                    <button
                      className="button ghost"
                      onClick={() => void controller.selectProjectRoot()}
                    >
                      {t("ui.SettingsPanel.text.70b20820")}</button>
                  </div>
                </div>
                <div className="settings-row">
                  <div>
                    <strong>{t("ui.SettingsPanel.text.9d007062")}</strong>
                    <span>{t("ui.SettingsPanel.text.def47c08")}</span>
                  </div>
                  <div className="input-with-action settings-control-wide">
                    <input
                      value={data.downloadDir}
                      readOnly
                      placeholder={t("ui.SettingsPanel.placeholder.278d215e")}
                    />
                    <button
                      className="button ghost"
                      onClick={() => void controller.selectDownloadDir()}
                    >
                      {t("ui.SettingsPanel.text.70b20820")}</button>
                    {data.downloadDir && (
                      <button
                        className="button ghost"
                        onClick={() => void controller.clearDownloadDir()}
                      >
                        {t("ui.SettingsPanel.text.7b15e5e8")}</button>
                    )}
                  </div>
                </div>
              </section>
              <section className="settings-section">
                <h4>{t("ui.SettingsPanel.text.b5bff31c")}</h4>
                {modelRows.map(([key, type, label, description]) => (
                  <div key={key} className="settings-row">
                    <div>
                      <strong>{label}</strong>
                      <span>{description}</span>
                    </div>
                    <ModelSelect
                      value={data.projectModels[key] || ""}
                      models={data.availableModels[type] || []}
                      onChange={(value) =>
                        controller.setProjectModel(key, value)}
                    />
                  </div>
                ))}
              </section>
              <section className="settings-section">
                <h4>{t("ui.SettingsPanel.text.060c628f")}</h4>
                <div className="settings-row">
                  <div>
                    <strong>{t("ui.SettingsPanel.text.641398cc")}</strong>
                    <span>{t("ui.SettingsPanel.text.b3b0f1f2")}</span>
                  </div>
                  <div className="settings-number-control">
                    <input
                      value={data.pollInterval}
                      type="number"
                      min="500"
                      step="100"
                      onChange={(e) =>
                        void controller.setPollInterval(
                          Math.max(500, Number(e.target.value) || 1500),
                        )}
                    />
                    <span>{t("ui.SettingsPanel.text.f3c3d569")}</span>
                  </div>
                </div>
              </section>
            </>
          )}
          {tab === "canvas" && (
            <section className="settings-section">
              <div className="settings-row">
                <div>
                  <strong>{t("ui.SettingsPanel.text.ca16ad18")}</strong>
                  <span>{t("ui.SettingsPanel.text.97a35b62")}</span>
                </div>
                <span className="settings-status-pill">{t("ui.SettingsPanel.text.7861cdc3")}</span>
              </div>
              <div className="canvas-shortcut-settings">
                {canvasShortcutRows.map(([key, label, description]) => (
                  <div key={key} className="canvas-shortcut-setting">
                    <div>
                      <strong>{label}</strong>
                      <span>{description}</span>
                    </div>
                    <button
                      className="shortcut-recorder"
                      onClick={() =>
                        controller.recordShortcut(key)}
                    >
                      {data.shortcutLabels[key] || t("ui.SettingsPanel.text.8c6677b3")}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
          {tab === "providers" && (
            <section className="settings-section settings-list-section">
              {selectedProvider ? (
                <>
                  <button className="provider-back" type="button" onClick={() => {
                    setSelectedProviderId(null);
                    if (contentScroll.current) contentScroll.current.scrollTop = 0;
                  }}>
                    <IconSymbol name="chevron-left" />{t("ui.SettingsPanel.text.d713d971")}</button>
                  <ProviderCard item={selectedProvider} onChange={controller.setProviderConfig} />
                </>
              ) : (
                <>
                  <div className="provider-list-intro">
                    <span>{t("ui.SettingsPanel.text.190d85a5")}</span>
                    <span>{data.providers.filter((item) => item.configured).length} / {data.providers.length} {t("ui.SettingsPanel.text.dc7cd22f")}</span>
                  </div>
                  <div className="provider-list">
                    {data.providers.map((item) => (
                      <button className="provider-list-row" type="button" key={item.id} onClick={() => {
                        setSelectedProviderId(item.id);
                        if (contentScroll.current) contentScroll.current.scrollTop = 0;
                      }}>
                        <span className="provider-badge"><ProviderBrandIcon icon={item.iconId} /></span>
                        <span className="provider-list-copy">
                          <strong>{item.name}</strong>
                          <small>{item.description}</small>
                        </span>
                        <span className="provider-list-count">{item.models.length} {t("ui.SettingsPanel.text.674373ae")}</span>
                        <span className={item.configured ? "provider-configured" : "provider-incomplete"}>
                          <i />{item.configured ? t("ui.SettingsPanel.text.dc7cd22f") : t("ui.CanvasNodes.text.63595e95")}
                        </span>
                        <IconSymbol name="chevron-right" />
                      </button>
                    ))}
                  </div>
                </>
              )}
            </section>
          )}
          {tab === "agent" && (
            <>
              <section className="settings-section">
                <h4>{t("ui.SettingsPanel.text.b5bff31c")}</h4>
                {agentRows.map(([key, type, label, description]) => (
                  <div key={key} className="settings-row">
                    <div>
                      <strong>{label}</strong>
                      <span>{description}</span>
                    </div>
                    <ModelSelect
                      value={data.agentModels[key] || ""}
                      models={data.availableModels[type] || []}
                      onChange={(value) =>
                        void controller.setAgentModel(key, value)}
                    />
                  </div>
                ))}
              </section>
              <section className="settings-section">
                <h4>{t("ui.SettingsPanel.text.6408e9f9")}</h4>
                {toggleRows.map(([key, label, description]) => (
                  <label key={key} className="settings-row settings-toggle-row">
                    <div>
                      <strong>{label}</strong>
                      <span>{description}</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={Boolean(data.agentToggles[key])}
                      onChange={(e) =>
                        void controller.setAgentToggle(key, e.target.checked)}
                    />
                  </label>
                ))}
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
