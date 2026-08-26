import { useMemo, useState } from "react";
import {
  compatibleModelsForRecipe,
  testRecipe,
} from "../../services/recipeTestService";
import { IconSymbol } from "../components/IconSymbol";

type CatalogRecord = Record<string, unknown>;
export interface RecipeDraft extends CatalogRecord {
  id: string;
  name: string;
  generationType: string;
  version: number;
  description: string;
  operationTypes: string[];
  systemPrompt: string;
  requiredElements: string[];
  builtIn?: boolean;
}
export interface SkillDraft extends CatalogRecord {
  id: string;
  name: string;
  category: string;
  version: number;
  description: string;
  enabled: boolean;
  builtIn?: boolean;
  triggers: { keywords: string[] };
  recipeIds: string[];
  instructions: string;
}
export interface RecipeChoice {
  id: string;
  name: string;
  generationType: string;
  enabled?: boolean;
}
type TestResult = {
  prompt: string;
  model: string;
  coveredElements: string[];
  missingElements: string[];
};

const clone = <T,>(value: T): T => structuredClone(value);
const splitList = (
  value: string,
) => [
  ...new Set(value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean)),
];
const typeLabel = (
  type: string,
) => ({ image: "图片", video: "视频", audio: "音频", text: "文本" }[type] ||
  type);

export function RecipeEditorDialog({
  recipe,
  isNew = false,
  modifiedFields = [],
  onClose,
  onSave,
  onReset,
}: {
  recipe: RecipeDraft;
  isNew?: boolean;
  modifiedFields?: string[];
  onClose: () => void;
  onSave: (recipe: RecipeDraft) => void;
  onReset?: () => void;
}) {
  const [draft, setDraft] = useState(() => clone(recipe));
  const [error, setError] = useState("");
  const [testIntent, setTestIntent] = useState("");
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const compatibleModels = useMemo(() => compatibleModelsForRecipe(draft), [
    draft,
  ]);
  const patch = (value: Partial<RecipeDraft>) => {
    setDraft((current) => ({ ...current, ...value }));
    setError("");
  };
  function submit() {
    if (!/^[a-z0-9_-]{1,64}$/.test(draft.id)) {
      return setError("ID 仅允许小写字母、数字、-、_，长度 1–64");
    }
    if (!draft.name.trim()) return setError("名称不能为空");
    if (!draft.operationTypes.length) {
      return setError("Operation Types 至少需要一项");
    }
    if (!draft.systemPrompt.trim()) return setError("System Prompt 不能为空");
    onSave(clone(draft));
  }
  async function runTest() {
    setTesting(true);
    setTestError("");
    setTestResult(null);
    try {
      setTestResult(await testRecipe(clone(draft), testIntent) as TestResult);
    } catch (cause) {
      setTestError(cause instanceof Error ? cause.message : "策略测试失败");
    } finally {
      setTesting(false);
    }
  }
  return (
    <div
      className="recipe-dialog-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="recipe-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? "新增策略" : "编辑策略"}
      >
        <header>
          <div>
            <h3>{isNew ? "新增策略" : `编辑 ${draft.name}`}</h3>
            {modifiedFields.length > 0 && (
              <p className="recipe-dialog-change-summary">
                已修改 {modifiedFields.length} 个字段
              </p>
            )}
          </div>
          <button
            className="icon-action"
            type="button"
            title="关闭"
            onClick={onClose}
          >
            <IconSymbol name="x" />
          </button>
        </header>
        <div className="recipe-dialog-body">
          {draft.builtIn && (
            <div className="recipe-readonly-note">
              <IconSymbol name="spark" />
              <span>
                {modifiedFields.length
                  ? `本机已覆盖：${modifiedFields.join("、")}`
                  : "当前使用 Shotloom 默认内容；ID 作为关联主键不可修改。"}
              </span>
              {modifiedFields.length > 0 && onReset && (
                <button type="button" onClick={onReset}>恢复默认</button>
              )}
            </div>
          )}
          <div className="recipe-form-grid">
            <label className="recipe-field">
              <span>ID</span>
              <input
                value={draft.id}
                disabled={!isNew}
                placeholder="video-custom-shot"
                onChange={(event) => patch({ id: event.target.value.trim() })}
              />
            </label>
            <label className="recipe-field">
              <span>名称</span>
              <input
                value={draft.name}
                placeholder="连续视频镜头"
                onChange={(event) => patch({ name: event.target.value })}
              />
            </label>
            <label className="recipe-field">
              <span>生成类型</span>
              <select
                value={draft.generationType}
                onChange={(event) =>
                  patch({ generationType: event.target.value })}
              >
                <option value="image">图片</option>
                <option value="video">视频</option>
                <option value="audio">音频</option>
                <option value="text">文本</option>
              </select>
            </label>
            <label className="recipe-field">
              <span>版本</span>
              <input
                value={draft.version}
                type="number"
                min="1"
                onChange={(event) =>
                  patch({
                    version: Math.max(1, Number(event.target.value) || 1),
                  })}
              />
            </label>
          </div>
          <label className="recipe-field">
            <span>用途说明</span>
            <input
              value={draft.description}
              placeholder="Agent 何时应选择这个策略"
              onChange={(event) => patch({ description: event.target.value })}
            />
          </label>
          <label className="recipe-field">
            <span>Operation Types</span>
            <input
              value={draft.operationTypes.join(", ")}
              placeholder="video, shot, motion"
              onChange={(event) =>
                patch({ operationTypes: splitList(event.target.value) })}
            />
            <small>Agent 规划单个生成节点时用于匹配，不参与技能选择。</small>
          </label>
          <label className="recipe-field recipe-prompt-field">
            <span>System Prompt</span>
            <textarea
              value={draft.systemPrompt}
              rows={8}
              spellCheck={false}
              placeholder="定义如何把节点意图整理成可直接运行的生成提示词…"
              onChange={(event) => patch({ systemPrompt: event.target.value })}
            />
          </label>
          <label className="recipe-field">
            <span>必需元素</span>
            <input
              value={draft.requiredElements.join(", ")}
              placeholder="主体, 动作, 场景, 运镜"
              onChange={(event) =>
                patch({ requiredElements: splitList(event.target.value) })}
            />
            <small>
              用于提醒 Agent 检查提示词完整性，不在保存节点时做阻断校验。
            </small>
          </label>
          <section className="recipe-test-lab">
            <header>
              <div>
                <strong>策略测试台</strong>
                <span>预览提示词整理结果，不会启动媒体生成。</span>
              </div>
              <span className="recipe-test-model-count">
                {compatibleModels.length} 个生成模型可用
              </span>
            </header>
            <div className="recipe-test-input-row">
              <label className="recipe-field recipe-test-intent">
                <span>节点意图</span>
                <textarea
                  value={testIntent}
                  rows={3}
                  placeholder="例如：雨夜街头，一名女孩回头看向镜头，摄影机缓慢推进。"
                  onChange={(event) => setTestIntent(event.target.value)}
                />
              </label>
              <button
                className="button primary"
                type="button"
                disabled={testing || !testIntent.trim()}
                onClick={() => void runTest()}
              >
                <IconSymbol
                  name={testing ? "refresh" : "play"}
                  className={testing ? "spinning" : ""}
                />
                {testing ? "测试中" : "测试策略"}
              </button>
            </div>
            {testError && <div className="recipe-test-error">{testError}</div>}
            {testResult && (
              <div className="recipe-test-result">
                <div className="recipe-test-result-head">
                  <strong>最终提示词</strong>
                  <span>{testResult.model}</span>
                </div>
                <pre>{testResult.prompt}</pre>
                <div className="recipe-test-coverage">
                  {testResult.coveredElements.map((item) => (
                    <span key={`ok:${item}`} className="covered">
                      <IconSymbol name="check" />
                      {item}
                    </span>
                  ))}
                  {testResult.missingElements.map((item) => (
                    <span key={`missing:${item}`} className="missing">
                      <IconSymbol name="warning" />
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>
          {error && <p className="recipe-dialog-error">{error}</p>}
        </div>
        <footer>
          <button className="button ghost" type="button" onClick={onClose}>
            取消
          </button>
          <button className="button primary" type="button" onClick={submit}>
            保存策略
          </button>
        </footer>
      </section>
    </div>
  );
}

export function SkillEditorDialog({
  skill,
  recipes,
  isNew = false,
  modifiedFields = [],
  onClose,
  onSave,
  onReset,
}: {
  skill: SkillDraft;
  recipes: RecipeChoice[];
  isNew?: boolean;
  modifiedFields?: string[];
  onClose: () => void;
  onSave: (skill: SkillDraft) => void;
  onReset?: () => void;
}) {
  const [draft, setDraft] = useState(() => clone(skill));
  const [error, setError] = useState("");
  const patch = (value: Partial<SkillDraft>) => {
    setDraft((current) => ({ ...current, ...value }));
    setError("");
  };
  function submit() {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(draft.id)) {
      return setError("ID 仅允许小写字母、数字和连字符，且首尾不能是连字符");
    }
    if (!draft.name.trim()) return setError("名称不能为空");
    if (!draft.description.trim()) return setError("用途说明不能为空");
    if (!draft.instructions.trim()) return setError("技能指令不能为空");
    onSave(clone(draft));
  }
  function toggleRecipe(id: string) {
    patch({
      recipeIds: draft.recipeIds.includes(id)
        ? draft.recipeIds.filter((item) => item !== id)
        : [...draft.recipeIds, id],
    });
  }
  return (
    <div
      className="recipe-dialog-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="recipe-dialog skill-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? "新增技能" : "编辑技能"}
      >
        <header>
          <div>
            <h3>{isNew ? "新增技能" : `编辑 ${draft.name}`}</h3>
            {modifiedFields.length > 0 && (
              <p className="recipe-dialog-change-summary">
                已修改 {modifiedFields.length} 个字段
              </p>
            )}
          </div>
          <label className="skill-dialog-enabled">
            <input
              checked={draft.enabled}
              type="checkbox"
              onChange={(event) => patch({ enabled: event.target.checked })}
            />
            {draft.enabled ? "已启用" : "已禁用"}
          </label>
          <button
            className="icon-action"
            type="button"
            title="关闭"
            onClick={onClose}
          >
            <IconSymbol name="x" />
          </button>
        </header>
        <div className="recipe-dialog-body">
          {draft.builtIn && (
            <div className="recipe-readonly-note">
              <IconSymbol name="spark" />
              <span>
                {modifiedFields.length
                  ? `本机已覆盖：${modifiedFields.join("、")}`
                  : "当前使用 Shotloom 默认内容；ID 作为关联主键不可修改。"}
              </span>
              {modifiedFields.length > 0 && onReset && (
                <button type="button" onClick={onReset}>恢复默认</button>
              )}
            </div>
          )}
          <div className="skill-dialog-grid">
            <label className="recipe-field">
              <span>ID</span>
              <input
                value={draft.id}
                disabled={!isNew}
                placeholder="short-drama"
                onChange={(event) => patch({ id: event.target.value.trim() })}
              />
            </label>
            <label className="recipe-field">
              <span>名称</span>
              <input
                value={draft.name}
                placeholder="短剧创作"
                onChange={(event) => patch({ name: event.target.value })}
              />
            </label>
            <label className="recipe-field">
              <span>分类</span>
              <input
                value={draft.category}
                placeholder="general / video / image"
                onChange={(event) => patch({ category: event.target.value })}
              />
            </label>
            <label className="recipe-field">
              <span>版本</span>
              <input
                value={draft.version}
                type="number"
                min="1"
                onChange={(event) =>
                  patch({
                    version: Math.max(1, Number(event.target.value) || 1),
                  })}
              />
            </label>
          </div>
          <label className="recipe-field">
            <span>何时使用</span>
            <input
              value={draft.description}
              placeholder="说明 Agent 应在什么任务中选择这个技能"
              onChange={(event) => patch({ description: event.target.value })}
            />
            <small>Agent 根据完整请求、用途说明和适用线索选择合适的技能。</small>
          </label>
          <label className="recipe-field">
            <span>适用线索</span>
            <input
              value={draft.triggers.keywords.join(", ")}
              placeholder="分镜, 短片, 视频工作流"
              onChange={(event) =>
                patch({
                  triggers: { keywords: splitList(event.target.value) },
                })}
            />
            <small>这些词只作为 Router 理解用途的目录元数据，不触发代码路由。</small>
          </label>
          <section className="skill-recipe-picker">
            <header>
              <div>
                <strong>关联策略</strong>
                <span>技能负责整体编排，策略负责单个节点的提示词。</span>
              </div>
              <em>{draft.recipeIds.length} 个已关联</em>
            </header>
            <div className="skill-recipe-options">
              {recipes.map((recipe) => {
                const disabled = recipe.enabled === false &&
                  !draft.recipeIds.includes(recipe.id);
                return (
                  <label key={recipe.id} className={disabled ? "disabled" : ""}>
                    <input
                      type="checkbox"
                      checked={draft.recipeIds.includes(recipe.id)}
                      disabled={disabled}
                      onChange={() =>
                        toggleRecipe(recipe.id)}
                    />
                    <span>
                      <strong>{recipe.name}</strong>
                      <small>{recipe.id}</small>
                    </span>
                    <em>{typeLabel(recipe.generationType)}</em>
                  </label>
                );
              })}
              {!recipes.length && <p>暂无可关联的策略</p>}
            </div>
          </section>
          <label className="recipe-field skill-instruction-field">
            <span>
              技能指令 <em>{draft.instructions.length} 字</em>
            </span>
            <textarea
              value={draft.instructions}
              rows={12}
              spellCheck={false}
              placeholder="定义这个技能的领域行为、边界和执行说明…"
              onChange={(event) => patch({ instructions: event.target.value })}
            />
          </label>
          {error && <p className="recipe-dialog-error">{error}</p>}
        </div>
        <footer>
          <button className="button ghost" type="button" onClick={onClose}>
            取消
          </button>
          <button className="button primary" type="button" onClick={submit}>
            保存技能
          </button>
        </footer>
      </section>
    </div>
  );
}
