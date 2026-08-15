import {
  type ChangeEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type IconName, IconSymbol } from "../components/IconSymbol";
import { ProviderBrandIcon } from "../components/ProviderBrandIcon";

export interface SettingsModel {
  id: string;
  label: string;
  iconId: string;
}
export interface ProviderItem {
  id: string;
  iconId: string;
  displayName: string;
  summaryUrl: string;
  modelCount: number;
}
export interface CatalogItem {
  id: string;
  name: string;
  description?: string;
  enabled?: boolean;
  builtIn?: boolean;
  version?: number;
  category?: string;
  tags?: string[];
  type?: string;
}
export interface SettingsData {
  projectRootDir: string;
  downloadDir: string;
  pollInterval: number;
  projectModels: Record<string, string>;
  agentModels: Record<string, string>;
  availableModels: Record<string, SettingsModel[]>;
  agentToggles: Record<string, boolean>;
  providers: ProviderItem[];
  skills: CatalogItem[];
  recipes: CatalogItem[];
  shortcutLabels: Record<string, string>;
}
export interface SettingsController {
  selectProjectRoot: () => void | Promise<void>;
  selectDownloadDir: () => void | Promise<void>;
  clearDownloadDir: () => void | Promise<void>;
  setPollInterval: (value: number) => void | Promise<void>;
  setProjectModel: (key: string, value: string) => void;
  setAgentModel: (key: string, value: string) => void | Promise<void>;
  setAgentToggle: (key: string, value: boolean) => void | Promise<void>;
  recordShortcut: (key: string) => void;
  resetShortcuts: () => void | Promise<void>;
  addProvider: () => void;
  editProvider: (id: string) => void;
  deleteProvider: (id: string) => void | Promise<void>;
  createSkill: () => void;
  editSkill: (id: string) => void;
  deleteSkill: (id: string) => void | Promise<void>;
  toggleSkill: (id: string) => void | Promise<void>;
  createRecipe: () => void;
  editRecipe: (id: string) => void;
  deleteRecipe: (id: string) => void | Promise<void>;
  toggleRecipe: (id: string) => void | Promise<void>;
  importCatalog: (
    kind: "skills" | "recipes",
    files: File[],
  ) => void | Promise<void>;
  exportCatalog: (
    kind: "skills" | "recipes",
    ids: string[],
  ) => void | Promise<void>;
}

type Tab = "general" | "canvas" | "providers" | "agent" | "skills" | "recipes";
const groups: Array<
  {
    label: string;
    items: Array<
      { id: Tab; label: string; icon: IconName; description: string }
    >;
  }
> = [
  {
    label: "工作区",
    items: [{
      id: "general",
      label: "通用",
      icon: "sliders",
      description: "项目目录、默认模型与文件行为",
    }, {
      id: "canvas",
      label: "画布",
      icon: "grid",
      description: "画布布局方式与操作快捷键",
    }],
  },
  {
    label: "智能服务",
    items: [{
      id: "providers",
      label: "API 厂商",
      icon: "link",
      description: "模型服务配置、凭据和模型目录",
    }, {
      id: "agent",
      label: "Copilot",
      icon: "spark",
      description: "Copilot 默认模型与执行策略",
    }],
  },
  {
    label: "内容编排",
    items: [{
      id: "skills",
      label: "技能",
      icon: "box",
      description: "定义 Agent 在创作任务中的规划与执行方式",
    }, {
      id: "recipes",
      label: "策略",
      icon: "file",
      description: "定义生成节点如何组织提示词",
    }],
  },
];
const modelRows = [
  [
    "defaultImageModel",
    "imageGeneration",
    "默认图片模型",
    "新建图片生成节点使用的模型",
  ],
  [
    "defaultTextModel",
    "textGeneration",
    "默认文本模型",
    "新建文本生成节点使用的模型",
  ],
  [
    "defaultVideoModel",
    "videoGeneration",
    "默认视频模型",
    "新建视频生成节点使用的模型",
  ],
] as const;
const agentRows = [
  [
    "agentPreferredTextModel",
    "textGeneration",
    "文本模型",
    "规划、推理和提示词生成",
  ],
  [
    "agentPreferredImageModel",
    "imageGeneration",
    "图片模型",
    "关键帧与视觉设定生成",
  ],
  ["agentPreferredVideoModel", "videoGeneration", "视频模型", "镜头与成片生成"],
] as const;
const toggleRows = [
  [
    "agentCanRunNodes",
    "允许 Agent 运行节点",
    "开启后 Agent 可以启动文本、图片、视频和音频节点；关闭后该执行能力不会提供给 Agent",
  ],
  [
    "agentAutoEval",
    "结果自动评估",
    "生成完成后检查任务终态、有效输出和归档结果",
  ],
  [
    "agentAutoLayout",
    "创建后自动整理",
    "Copilot 创建节点后立即应用全局分层布局",
  ],
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
        <span>{selected?.label || "请先配置对应的 API 厂商"}</span>
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

export function SettingsPanel(
  { data, controller, overlays }: {
    data: SettingsData;
    controller: SettingsController;
    overlays?: ReactNode;
  },
) {
  const [tab, setTab] = useState<Tab>("general");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const importInput = useRef<HTMLInputElement>(null);
  const meta = groups.flatMap((group) => group.items).find((item) =>
    item.id === tab
  )!;
  const catalog = tab === "skills" ? data.skills : data.recipes;
  const filtered = useMemo(
    () =>
      catalog.filter((item) =>
        !query.trim() ||
        [
          item.id,
          item.name,
          item.description,
          item.category,
          ...(item.tags || []),
        ].join(" ").toLowerCase().includes(query.trim().toLowerCase())
      ),
    [catalog, query],
  );
  function toggleSelection(id: string) {
    setSelected((items) => {
      const next = new Set(items);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function importFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (files.length && (tab === "skills" || tab === "recipes")) {
      void controller.importCatalog(tab, files);
    }
  }
  const catalogView = (kind: "skills" | "recipes") => (
    <section className="settings-section settings-list-section">
      <label className="settings-search">
        <IconSymbol name="search" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          type="search"
          placeholder={`搜索${kind === "skills" ? "技能" : "策略"}`}
        />
      </label>
      <div className="settings-list-summary">
        <label className="settings-select-all">
          <input
            type="checkbox"
            checked={filtered.length > 0 &&
              filtered.every((item) => selected.has(item.id))}
            onChange={() =>
              setSelected(
                filtered.every((item) => selected.has(item.id))
                  ? new Set()
                  : new Set(filtered.map((item) => item.id)),
              )}
          />
          <span>全选</span>
        </label>
        <span>
          {filtered.length} 个{kind === "skills" ? "技能" : "策略"} ·{" "}
          {filtered.filter((item) => item.enabled !== false).length} 个已启用
        </span>
      </div>
      {filtered.map((item) => (
        <div
          key={item.id}
          className={`settings-skill-row${
            item.enabled === false ? " disabled" : ""
          }`}
        >
          <input
            className="settings-list-select"
            type="checkbox"
            checked={selected.has(item.id)}
            onChange={() => toggleSelection(item.id)}
          />
          <div>
            <div className="settings-skill-name">
              <strong>{item.name}</strong>
              {item.builtIn && <span>内置</span>}
              <span>v{item.version || 1}</span>
              {item.category && <span>{item.category}</span>}
            </div>
            <p>{item.description || "暂无说明"}</p>
            <small>{item.id}</small>
          </div>
          <input
            className="settings-enable-toggle"
            type="checkbox"
            checked={item.enabled !== false}
            onChange={() =>
              void (kind === "skills"
                ? controller.toggleSkill(item.id)
                : controller.toggleRecipe(item.id))}
          />
          <button
            className="icon-action"
            title="编辑"
            onClick={() =>
              kind === "skills"
                ? controller.editSkill(item.id)
                : controller.editRecipe(item.id)}
          >
            <IconSymbol name="pencil" />
          </button>
          {!item.builtIn && (
            <button
              className="icon-action danger"
              title="删除"
              onClick={() =>
                void (kind === "skills"
                  ? controller.deleteSkill(item.id)
                  : controller.deleteRecipe(item.id))}
            >
              <IconSymbol name="trash" />
            </button>
          )}
        </div>
      ))}
      {!filtered.length && <div className="settings-empty">没有匹配的内容</div>}
    </section>
  );

  return (
    <div className="settings-panel">
      <nav className="settings-nav" aria-label="设置分类">
        <p className="settings-nav-label">偏好设置</p>
        {groups.map((group) => (
          <div key={group.label} className="settings-nav-group">
            <p>{group.label}</p>
            {group.items.map((item) => (
              <button
                key={item.id}
                className={tab === item.id ? "active" : ""}
                onClick={() => {
                  setTab(item.id);
                  setQuery("");
                  setSelected(new Set());
                }}
              >
                <IconSymbol name={item.icon} />
                <span>{item.label}</span>
                {item.id === "providers" && <em>{data.providers.length}</em>}
                {item.id === "skills" && <em>{data.skills.length}</em>}
                {item.id === "recipes" && <em>{data.recipes.length}</em>}
              </button>
            ))}
          </div>
        ))}
        <div className="settings-nav-note">
          <IconSymbol name="help" />
          <span>所有偏好自动保存在本机</span>
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
              恢复默认
            </button>
          )}
          {tab === "providers" && (
            <button
              className="button primary compact"
              onClick={controller.addProvider}
            >
              + 添加厂商
            </button>
          )}
          {(tab === "skills" || tab === "recipes") && (
            <div className="settings-head-actions">
              <button
                className="button ghost compact"
                onClick={() => importInput.current?.click()}
              >
                <IconSymbol name="upload" />导入
              </button>
              <button
                className="button ghost compact"
                disabled={!selected.size}
                onClick={() =>
                  void controller.exportCatalog(tab, [...selected])}
              >
                <IconSymbol name="download" />导出 ({selected.size})
              </button>
              <button
                className="button primary compact"
                onClick={tab === "skills"
                  ? controller.createSkill
                  : controller.createRecipe}
              >
                + 新建{tab === "skills" ? "技能" : "策略"}
              </button>
              <input
                ref={importInput}
                className="settings-hidden-input"
                type="file"
                accept=".json,application/json"
                multiple
                onChange={importFiles}
              />
            </div>
          )}
        </header>
        <div className="settings-content-scroll">
          {tab === "general" && (
            <>
              <section className="settings-section">
                <h4>项目与文件</h4>
                <div className="settings-row">
                  <div>
                    <strong>项目默认目录</strong>
                    <span>新项目和现有项目迁移使用的根目录</span>
                  </div>
                  <div className="input-with-action settings-control-wide">
                    <input
                      value={data.projectRootDir}
                      readOnly
                      placeholder="项目默认保存位置"
                    />
                    <button
                      className="button ghost"
                      onClick={() => void controller.selectProjectRoot()}
                    >
                      选择
                    </button>
                  </div>
                </div>
                <div className="settings-row">
                  <div>
                    <strong>资产下载路径</strong>
                    <span>留空时每次导出都会询问保存位置</span>
                  </div>
                  <div className="input-with-action settings-control-wide">
                    <input
                      value={data.downloadDir}
                      readOnly
                      placeholder="每次弹出另存为"
                    />
                    <button
                      className="button ghost"
                      onClick={() => void controller.selectDownloadDir()}
                    >
                      选择
                    </button>
                    {data.downloadDir && (
                      <button
                        className="button ghost"
                        onClick={() => void controller.clearDownloadDir()}
                      >
                        清除
                      </button>
                    )}
                  </div>
                </div>
              </section>
              <section className="settings-section">
                <h4>默认模型</h4>
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
                <h4>任务行为</h4>
                <div className="settings-row">
                  <div>
                    <strong>状态轮询间隔</strong>
                    <span>异步生成任务查询服务端状态的频率</span>
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
                    <span>毫秒</span>
                  </div>
                </div>
              </section>
            </>
          )}
          {tab === "canvas" && (
            <section className="settings-section">
              <div className="settings-row">
                <div>
                  <strong>自动布局方式</strong>
                  <span>按全局依赖层级从左到右整理工作流</span>
                </div>
                <span className="settings-status-pill">全局分层</span>
              </div>
              <div className="canvas-shortcut-settings">
                {[["fitView", "适应视窗", "让全部节点回到可见区域"], [
                  "autoLayout",
                  "自动整理",
                  "优先整理当前选区，否则整理全部节点",
                ]].map(([key, label, description]) => (
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
                      {data.shortcutLabels[key] || "录制快捷键"}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
          {tab === "providers" && (
            <section className="settings-section settings-list-section">
              {!data.providers.length && (
                <div className="settings-empty">
                  尚未配置 API 厂商，添加后模型会自动按厂商路由。
                </div>
              )}
              {data.providers.map((item) => (
                <div key={item.id} className="provider-card">
                  <span className="provider-badge">
                    <ProviderBrandIcon icon={item.iconId} />
                  </span>
                  <div>
                    <strong>{item.displayName}</strong>
                    <small>
                      {item.summaryUrl} · {item.modelCount} 个模型
                    </small>
                  </div>
                  <span className="provider-configured" title="配置已保存在本机，实际连通性会在调用模型时验证">
                    <i />已配置
                  </span>
                  <button
                    className="icon-action"
                    onClick={() =>
                      controller.editProvider(item.id)}
                  >
                    <IconSymbol name="pencil" />
                  </button>
                  <button
                    className="icon-action danger"
                    onClick={() =>
                      void controller.deleteProvider(item.id)}
                  >
                    <IconSymbol name="trash" />
                  </button>
                </div>
              ))}
            </section>
          )}
          {tab === "agent" && (
            <>
              <section className="settings-section">
                <h4>默认模型</h4>
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
                <h4>执行策略</h4>
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
          {tab === "skills" && catalogView("skills")}
          {tab === "recipes" && catalogView("recipes")}
        </div>
      </main>
      {overlays}
    </div>
  );
}
