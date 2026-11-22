import type { ThemePreference, ThemeOrigin } from '../../utils/appTheme';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { t } from '@/i18n';
import { InputNumber, Select, Switch } from "antd";
import {
  useState,
} from "react";
import { type IconName, IconSymbol } from "../components/IconSymbol";
import { AgentPetSettings } from '../agent-chat/AgentPetSettings';
import { ProviderBrandIcon } from "../components/ProviderBrandIcon";

export interface SettingsModel {
  id: string;
  label: string;
  iconId: string;
}
export interface SettingsData {
  locale?: string;
  themePreference?: string;
  projectRootDir: string;
  downloadDir: string;
  pollInterval: number;
  projectModels: Record<string, string>;
  agentModels: Record<string, string>;
  availableModels: Record<string, SettingsModel[]>;
  agentToggles: Record<string, boolean | string>;
  shortcutLabels: Record<string, string>;
}
export interface SettingsController {
  setThemePreference?: (value: ThemePreference, origin?: ThemeOrigin) => void | Promise<void>;
  setLocale?: (locale: string) => void | Promise<void>;
  selectProjectRoot: () => void | Promise<void>;
  selectDownloadDir: () => void | Promise<void>;
  clearDownloadDir: () => void | Promise<void>;
  setPollInterval: (value: number) => void | Promise<void>;
  setProjectModel: (key: string, value: string) => void;
  repairNodeModels: () => void | Promise<void>;
  exportDiagnostics: () => void | Promise<void>;
  setAgentModel: (key: string, value: string) => void | Promise<void>;
  setAgentToggle: (key: string, value: boolean | string) => void | Promise<void>;
  recordShortcut: (key: string) => void;
  resetShortcuts: () => void | Promise<void>;
}

type Tab = "general" | "canvas" | "agent";
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
  const selected = models.find((model) => model.id === value);
  return (
    <Select
      className="settings-model-select"
      aria-label={t("ui.SettingsPanel.text.5fd36376")}
      value={value || null}
      disabled={!models.length}
      placeholder={t("ui.SettingsPanel.text.5fd36376")}
      onChange={onChange}
      popupMatchSelectWidth
      options={models.map((model) => ({
        value: model.id,
        label: model.label,
        iconId: model.iconId,
      }))}
      labelRender={() =>
        selected ? (
          <span className="settings-model-value">
            <ProviderBrandIcon className="settings-model-icon" icon={selected.iconId} />
            <span>{selected.label}</span>
          </span>
        ) : null}
      optionRender={(option) => (
        <span className="settings-model-option">
          <ProviderBrandIcon className="settings-model-icon" icon={option.data.iconId as string} />
          <strong>{option.data.label}</strong>
          {option.value === value && <IconSymbol name="check" />}
        </span>
      )}
    />
  );
}

export function SettingsPanel(
  { data, controller }: {
    data: SettingsData;
    controller: SettingsController;
  },
) {
  const [tab, setTab] = useState<Tab>("general");
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
                }}
              >
                <IconSymbol name={item.icon} />
                <span>{item.label}</span>
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
            <h3>{meta.label}</h3>
            <p>{meta.description}</p>
          </div>
          {tab === "canvas" && (
            <button
              className="button ghost compact"
              onClick={() => void controller.resetShortcuts()}
            >
              {t("ui.CameraControlPanel.text.a191935b")}</button>
          )}
        </header>
        <div className="settings-content-scroll">
          {tab === "general" && (
            <>
              <section className="settings-section">
                <div className="settings-row">
                  <div><strong>{t('settings.language')}</strong><span>{t('settings.languageReload')}</span></div>
                  <Select
                    aria-label={t('settings.language')}
                    value={data.locale || 'zh-CN'}
                    onChange={event => void controller.setLocale?.(event)}
                    options={[
                      { value: "zh-CN", label: "简体中文" },
                      { value: "en-US", label: "English" },
                    ]}
                  />
                </div>
                <div className="settings-row">
                  <div><strong>{t('settings.theme')}</strong><span>{t('settings.themeHint')}</span></div>
                  <ThemeSwitch value={data.themePreference || 'light'} onChange={(value, origin) => void controller.setThemePreference?.(value, origin)} />
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
                <div className="settings-row">
                  <div>
                    <strong>{t('settings.repairNodeModels.action')}</strong>
                    <span>{t('settings.repairNodeModels.hint')}</span>
                  </div>
                  <button
                    className="button ghost compact"
                    onClick={() => void controller.repairNodeModels()}
                  >
                    {t('settings.repairNodeModels.action')}
                  </button>
                </div>
              </section>
              <section className="settings-section">
                <h4>{t('settings.diagnostics.title')}</h4>
                <div className="settings-row">
                  <div>
                    <strong>{t('settings.diagnostics.action')}</strong>
                    <span>{t('settings.diagnostics.hint')}</span>
                  </div>
                  <button
                    className="button ghost compact"
                    onClick={() => void controller.exportDiagnostics()}
                  >
                    {t('settings.diagnostics.action')}
                  </button>
                </div>
              </section>
              <section className="settings-section">
                <h4>{t("ui.SettingsPanel.text.060c628f")}</h4>
                <div className="settings-row">
                  <div>
                    <strong>{t("ui.SettingsPanel.text.641398cc")}</strong>
                    <span>{t("ui.SettingsPanel.text.b3b0f1f2")}</span>
                  </div>
                  <div className="settings-number-control">
                    <InputNumber
                      value={data.pollInterval}
                      min={500}
                      step={100}
                      suffix={t("ui.SettingsPanel.text.f3c3d569")}
                      onChange={(next) =>
                        void controller.setPollInterval(
                          Math.max(500, Number(next) || 1500),
                        )}
                    />
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
          {tab === "agent" && (
            <>
              <AgentPetSettings />
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
                  <div key={key} className="settings-row settings-toggle-row">
                    <div>
                      <strong>{label}</strong>
                      <span>{description}</span>
                    </div>
                    <Switch
                      aria-label={label}
                      checked={Boolean(data.agentToggles[key])}
                      onChange={(checked) =>
                        void controller.setAgentToggle(key, checked)}
                    />
                  </div>
                ))}
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
