import { useState } from "react";
import { IconSymbol } from "../components/IconSymbol";

const MODEL_SKELETON = `{
  "id": "官方模型 ID",
  "name": "界面显示名称",
  "provider": "厂商 ID",
  "type": "textGeneration | imageGeneration | videoGeneration",
  "sortOrder": 900,
  "enabled": true,
  "defaultMode": "text-generation",
  "modes": [
    {
      "id": "text-generation",
      "label": "文本生成",
      "endpoint": { "method": "POST", "path": "/接口路径", "scope": "root" },
      "inputConstraints": {},
      "outputConstraints": {},
      "params": [],
      "auth": { "type": "bearer" },
      "requestTemplate": {
        "model": "{{model}}",
        "messages": "{{messages}}"
      },
      "resultTextPath": "choices.0.message.content"
    }
  ]
}`;

const ASYNC_SKELETON = `{
  "endpoint": { "method": "POST", "path": "/tasks", "scope": "root" },
  "taskEndpoint": { "method": "GET", "path": "/tasks/{taskId}", "scope": "root" },
  "isAsync": true,
  "taskIdPath": "id",
  "statusPath": "status",
  "errorPath": "error.message",
  "pollStatusMap": {
    "queued": "running",
    "processing": "running",
    "succeeded": "completed",
    "failed": "failed"
  },
  "resultUrlPath": "output.url"
}`;

export const AI_MODEL_PROTOCOL_PROMPT = `你正在为 Shotloom 编写一个 CatalogModel 模型协议。请阅读我随后提供的厂商官方 API 文档，并返回一个可直接保存的单个 JSON 对象。

严格要求：
1. 只输出 JSON 对象，不要 Markdown、注释或解释，不要输出数组。
2. 顶层必须包含 id、name、provider、type、sortOrder、enabled、defaultMode、modes。
3. type 只能是 textGeneration、imageGeneration 或 videoGeneration。
4. modes 至少一个；defaultMode 必须等于其中一个 mode.id。不同调用方式必须拆成不同 mode，例如文生图与图生图。
5. 每个 mode 必须包含 id、label、endpoint、inputConstraints、outputConstraints、params。
6. endpoint 包含 method、path、scope。path 只写 Base URL 后面的路径；scope 通常用 root，只有 Base URL 未包含且接口明确位于 /v1 下时才用 v1。
7. auth 按官方文档填写：Bearer 用 {"type":"bearer"}；自定义请求头用 {"type":"header","name":"请求头名","prefix":"前缀"}；无需鉴权用 {"type":"none"}。
8. requestTemplate 必须严格对应官方请求体。可使用 {{model}}、{{prompt}}、{{messages}}、{{tools}}、{{toolChoice}}、{{imageUrl}}、{{imageUrls}}、{{imageObject}}、{{content}}、{{params.参数key}} 等运行时变量。不要创造应用不认识的变量。
9. params 描述界面允许用户调整的参数。每项写 key、label、type；需要时写 required、default、numeric、options。requestTemplate 中通过 {{params.key}} 使用。
10. 根据输入要求填写 inputConstraints。图片输入需写 images.min、images.max，必要时写 roles；没有图片输入时写 min:0,max:0 或省略 images。
11. 根据输出能力填写 outputConstraints，例如 maxCount、durations、defaultDuration、formats、supportsStreaming、supportsToolCalls、maxTokens。
12. 同步接口填写正确的 resultTextPath、resultUrlPath 或 resultBase64Path。路径用点号访问嵌套字段，数组多结果可用 *。
13. 异步接口必须填写 taskEndpoint、isAsync:true、taskIdPath、statusPath、pollStatusMap、errorPath 和最终结果路径。taskEndpoint.path 使用 {taskId} 占位。
14. pollStatusMap 的值只能是 running、completed 或 failed，必须覆盖官方可能返回的状态。
15. 不要根据经验猜测接口、字段、枚举或结果路径；官方文档没有说明的内容不要虚构。

我要接入的信息：
- 厂商 ID：<填写>
- 模型官方 ID：<填写>
- 模型名称：<填写>
- 生成类型：<填写>
- API Base URL：<填写>

厂商官方 API 文档：
<把创建请求、查询任务、请求示例和响应示例粘贴在这里>`;

type GuideTab = "start" | "fields" | "async" | "ai";

export function ModelProtocolGuideDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<GuideTab>("start");
  const [copied, setCopied] = useState(false);
  const tabs: Array<{ id: GuideTab; label: string }> = [
    { id: "start", label: "接入步骤" },
    { id: "fields", label: "字段与变量" },
    { id: "async", label: "异步任务" },
    { id: "ai", label: "交给 AI" },
  ];

  async function copyAIPrompt() {
    await navigator.clipboard?.writeText(AI_MODEL_PROTOCOL_PROMPT);
    setCopied(true);
  }

  return (
    <div
      className="model-guide-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="model-guide-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="模型接入指南"
      >
        <header>
          <div>
            <h3>模型接入指南</h3>
            <p>把厂商 API 文档转换为 Shotloom 可以执行的单模型协议。</p>
          </div>
          <button className="icon-action" type="button" onClick={onClose}>
            <IconSymbol name="x" />
          </button>
        </header>
        <div className="model-guide-layout">
          <nav aria-label="指南章节">
            {tabs.map((item, index) => (
              <button
                key={item.id}
                className={tab === item.id ? "active" : ""}
                type="button"
                onClick={() => setTab(item.id)}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                {item.label}
              </button>
            ))}
          </nav>
          <main>
            {tab === "start" && (
              <article>
                <div className="model-guide-kicker">从官方文档开始</div>
                <h4>一个模型可以有多个调用模式</h4>
                <p>
                  先确认模型官方 ID、Base URL、鉴权方式，再分别找到创建请求和响应示例。文生图、图生图等请求结构不同时，应分别建立 mode，不要塞进同一个模板。
                </p>
                <ol className="model-guide-steps">
                  <li><strong>创建模型</strong><span>填写官方模型 ID、显示名称和生成类型。</span></li>
                  <li><strong>定义请求</strong><span>把官方 method、接口路径、鉴权和请求体写入 endpoint、auth、requestTemplate。</span></li>
                  <li><strong>定义输入与参数</strong><span>用 inputConstraints 描述素材数量，用 params 暴露用户可调参数。</span></li>
                  <li><strong>定义结果</strong><span>根据真实响应示例填写 resultTextPath、resultUrlPath 或 resultBase64Path。</span></li>
                  <li><strong>核对运行方式</strong><span>如果创建接口只返回任务 ID，继续完成异步轮询配置。</span></li>
                </ol>
                <h5>最小完整结构</h5>
                <pre><code>{MODEL_SKELETON}</code></pre>
              </article>
            )}
            {tab === "fields" && (
              <article>
                <div className="model-guide-kicker">协议字典</div>
                <h4>字段必须对应真实 API 行为</h4>
                <div className="model-guide-field-table">
                  <div><code>defaultMode / modes</code><span>默认调用模式与全部调用方式。defaultMode 必须引用真实的 mode.id。</span></div>
                  <div><code>endpoint</code><span>创建请求的 method、相对 path 和 scope。path 不重复填写 Base URL。</span></div>
                  <div><code>auth</code><span>bearer、header 或 none。自定义 Header 还要提供 name，必要时提供 prefix。</span></div>
                  <div><code>inputConstraints</code><span>允许的文本、图片、视频、音频输入数量及角色，必须符合厂商限制。</span></div>
                  <div><code>outputConstraints</code><span>输出数量、时长、格式、最大 Token 及流式/工具能力。</span></div>
                  <div><code>params</code><span>节点界面展示的参数。key 必须和 requestTemplate 使用的 params.key 一致。</span></div>
                  <div><code>requestTemplate</code><span>最终发送给厂商的请求体；静态值原样发送，双大括号值由运行时替换。</span></div>
                  <div><code>result…Path</code><span>从真实响应读取结果的点路径；多结果数组使用 *，例如 data.*.url。</span></div>
                </div>
                <h5>常用运行时变量</h5>
                <div className="model-guide-token-grid">
                  <code>{"{{model}}"}<small>当前模型 ID</small></code>
                  <code>{"{{prompt}}"}<small>用户提示词</small></code>
                  <code>{"{{messages}}"}<small>文本对话消息</small></code>
                  <code>{"{{tools}}"}<small>工具定义</small></code>
                  <code>{"{{imageUrl}}"}<small>单张输入图片</small></code>
                  <code>{"{{imageUrls}}"}<small>输入图片数组</small></code>
                  <code>{"{{content}}"}<small>结构化多模态内容</small></code>
                  <code>{"{{params.key}}"}<small>节点参数值</small></code>
                </div>
                <p className="model-guide-note">变量必须来自 Shotloom 运行时；不要把厂商文档里的示例占位符直接当成运行时变量。</p>
              </article>
            )}
            {tab === "async" && (
              <article>
                <div className="model-guide-kicker">视频和部分图片接口</div>
                <h4>创建任务与查询结果是两次请求</h4>
                <p>
                  如果创建响应只返回任务 ID，不能把创建响应里的字段当成最终媒体地址。先用 taskIdPath 取出 ID，再按 taskEndpoint 查询，直到 pollStatusMap 映射为 completed。
                </p>
                <pre><code>{ASYNC_SKELETON}</code></pre>
                <div className="model-guide-checklist">
                  <strong>保存前检查</strong>
                  <label><span>01</span>taskIdPath 能从创建响应取到真实任务 ID</label>
                  <label><span>02</span>taskEndpoint.path 包含 {"{taskId}"}</label>
                  <label><span>03</span>statusPath 指向官方状态字段</label>
                  <label><span>04</span>所有官方状态都映射为 running、completed 或 failed</label>
                  <label><span>05</span>resultUrlPath 来自任务完成后的查询响应</label>
                </div>
              </article>
            )}
            {tab === "ai" && (
              <article>
                <div className="model-guide-ai-head">
                  <div>
                    <div className="model-guide-kicker">可直接复制</div>
                    <h4>让 AI 根据官方文档生成协议</h4>
                  </div>
                  <button className="button ghost" type="button" onClick={() => void copyAIPrompt()}>
                    <IconSymbol name={copied ? "check" : "copy"} />
                    {copied ? "已复制" : "复制任务说明"}
                  </button>
                </div>
                <p>
                  复制下面的任务说明，并把厂商的创建请求、查询任务、请求示例和响应示例一起交给 AI。不要只给模型名称或营销页面。
                </p>
                <pre className="model-guide-ai-prompt"><code>{AI_MODEL_PROTOCOL_PROMPT}</code></pre>
              </article>
            )}
          </main>
        </div>
        <footer>
          <span>指南与当前 CatalogModel 协议版本保持一致。</span>
          <button className="button primary" type="button" onClick={onClose}>返回模型配置</button>
        </footer>
      </section>
    </div>
  );
}
