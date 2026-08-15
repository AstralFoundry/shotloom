import { useState } from "react";
import { IconSymbol } from "../components/IconSymbol";

const MODEL_SKELETON = `[
  {
    "kind": "adapter",
    "id": "共享协议 ID",
    "name": "共享协议名称",
    "type": "textGeneration",
    "defaultMode": "chat",
    "modes": [
      {
        "id": "chat",
        "label": "文本对话",
        "endpoint": { "method": "POST", "path": "/接口路径", "scope": "root" },
        "inputConstraints": {},
        "outputConstraints": {},
        "params": [],
        "auth": { "type": "bearer" },
        "requestTemplate": { "model": "{{model}}", "messages": "{{messages}}" },
        "resultTextPath": "choices.*.message.content"
      }
    ]
  }
]`;

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

const BINARY_RESULT_SKELETON = `{
  "taskEndpoint": { "method": "GET", "path": "/v1/videos/{taskId}", "scope": "root" },
  "statusPath": "status",
  "resultEndpoint": {
    "method": "GET",
    "path": "/v1/videos/{taskId}/content",
    "scope": "root",
    "mimeType": "video/mp4",
    "fileExtension": "mp4"
  }
}`;

const DIRECT_BINARY_RESULT_SKELETON = `{
  "endpoint": { "method": "POST", "path": "/v1/audio/speech", "scope": "root" },
  "resultBody": {
    "encoding": "binary",
    "mimeType": "audio/mpeg",
    "fileExtension": "mp3"
  }
}`;

const HEX_RESULT_SKELETON = `{
  "resultHexPath": "data.audio",
  "resultMimeType": "audio/mpeg",
  "resultFileExtension": "mp3"
}`;

const MULTIPART_SKELETON = `{
  "inputFormat": "multipart",
  "requestFields": {
    "multipartImage": "image[]",
    "mask": "mask"
  },
  "requestTemplate": {
    "model": "{{model}}",
    "prompt": "{{prompt}}",
    "size": "{{params.size}}"
  }
}`;

const GEMINI_INLINE_SKELETON = `{
  "inputFormat": "json",
  "inputMode": "reference",
  "inputSlots": ["reference"],
  "inputConstraints": {
    "images": { "min": 1, "max": 1, "roles": ["referenceImage"] }
  },
  "requestFields": { "imageContentFormat": "google-inline" },
  "requestTemplate": {
    "contents": [
      {
        "role": "user",
        "parts": [
          { "text": "{{prompt}}" },
          {
            "inlineData": {
              "mimeType": "{{inlineImage.mimeType}}",
              "data": "{{inlineImage.bytesBase64Encoded}}"
            }
          }
        ]
      }
    ]
  }
}`;

const AI_PROTOCOL_STRUCTURE = `[
  {
    "kind": "adapter",
    "id": "shared-image-api",
    "name": "共享图片协议",
    "type": "imageGeneration",
    "defaultMode": "generate",
    "modes": [
      {
        "id": "generate",
        "label": "图片生成",
        "endpoint": { "method": "POST", "path": "/真实路径", "scope": "root" },
        "inputFormat": "json",
        "inputConstraints": {},
        "outputConstraints": { "maxCount": 1, "formats": ["png"] },
        "params": [
          {
            "key": "size",
            "label": "尺寸",
            "type": "select",
            "default": "1024x1024",
            "options": ["1024x1024"],
            "presentation": { "control": "resolution", "group": "画面", "summary": true }
          }
        ],
        "auth": { "type": "bearer" },
        "requestTemplate": {
          "model": "{{model}}",
          "prompt": "{{prompt}}",
          "size": "{{params.size}}"
        },
        "resultUrlPath": "data.*.url"
      },
      {
        "id": "edit",
        "label": "图片编辑",
        "endpoint": { "method": "POST", "path": "/真实编辑路径", "scope": "root" },
        "inputFormat": "multipart",
        "inputMode": "reference",
        "inputSlots": ["reference"],
        "inputConstraints": {
          "images": { "min": 1, "max": 1, "roles": ["referenceImage"], "formats": ["png", "jpeg"] }
        },
        "outputConstraints": { "maxCount": 1, "formats": ["png"] },
        "params": [],
        "auth": { "type": "bearer" },
        "requestFields": { "multipartImage": "image" },
        "requestTemplate": {
          "model": "{{model}}",
          "prompt": "{{prompt}}"
        },
        "resultUrlPath": "data.*.url"
      }
    ]
  }
]`;

export const AI_MODEL_PROTOCOL_PROMPT = `请把随后提供的官方 API 文档转换成 Shotloom 全局协议 Adapter。

只输出可被 JSON.parse 解析的数组，不要 Markdown、注释或解释。数组中只能包含 kind:"adapter" 对象；不要生成模型 Binding，不要包裹 adapters 或 models 字段。具体模型 ID 会在 API 厂商设置中批量绑定。

结构示例只表示字段层级，不代表厂商能力：
${AI_PROTOCOL_STRUCTURE}

要求：
1. 先通读接口表、参数表、字段转换、请求和响应示例；只描述用户调用当前网站时真实发送和收到的协议。
2. endpoint、传输格式、请求模板、结果解析完全相同的能力必须共用一个 Adapter。只有协议真实不同才新增 Adapter。
3. Adapter 包含 id、name、type、defaultMode、modes；每个 mode 包含 id、label、endpoint、inputConstraints、outputConstraints、params、requestTemplate 和真实结果来源。
4. type 只能是 textGeneration、imageGeneration、videoGeneration、audioGeneration。
5. params 只放用户反复调整的核心创作参数。每项必须声明 presentation.control：segmented、select、ratio、resolution、slider、number、toggle、text、hidden 之一；可写 group、summary、unit、min、max、step。枚举控件必须有完整 options；slider 必须有 min/max。未知分类参数应省略，不得降级为空文本框。
6. model、prompt、messages、stream、tools、metadata、user、审核、结果编码/格式/压缩、兼容别名不得作为界面参数。每个 param 必须被 requestTemplate 的 {{params.key}} 使用。
7. 媒体 mode 必须显式声明 inputMode 与 inputSlots；首帧/尾帧是 slot，媒体 roles 只用 referenceImage、inputVideo、referenceAudio。数量和格式只能来自当前模型证据。
8. requestTemplate 占位符必须作为 JSON 字符串。{{model}} 会在厂商绑定后得到官方模型 ID；还可用 prompt、messages、imageUrl(s)、referenceImageUrls、firstFrameImageUrl、lastFrameImageUrl、videoUrl(s)、audioUrl(s)、content、params.key；不要创造运行时变量。如果模型 ID 位于 URL 路径中，可在 endpoint、taskEndpoint 或 resultEndpoint 的 path 中写 {{model}}。
9. multipart 文件通过 requestFields.multipartImage/multipartVideo/multipartAudio/mask 声明，不放进 requestTemplate。
10. Gemini 原生 inlineData 使用 requestFields.imageContentFormat:"google-inline"，模板引用 inlineImage.mimeType 与 inlineImage.bytesBase64Encoded；禁止 imageContentType:"inlineData" + content。
11. 异步接口必须配置 taskEndpoint、taskIdPath、statusPath、pollStatusMap、errorPath 和真实结果来源。异步完成后下载文件使用 resultEndpoint；同步文件流使用 resultBody；Hex 使用 resultHexPath + MIME + 扩展名。
12. 渠道总表只证明可路由，不证明某模型支持整个 API 家族的可选参数或编辑能力。没有模型级证据时只使用最小公共协议。
13. 相同 inputMode 只能出现一次；不能仅按 URL/Base64、兼容别名或 API 家族拆分不可选择的 mode。
14. 输出前检查所有 Adapter ID、defaultMode、参数引用、结果路径及 JSON 语法。

我要接入的信息：
- 协议名称：<例如 OpenAI Images 兼容协议>
- 生成类型：<文本、图片、视频或音频>
- API Base URL 结构：<仅用于判断 path 与 scope，不写入 Adapter>

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
            <p>把厂商 API 文档转换为可供所有 API 厂商复用的全局 Adapter。</p>
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
                  先确认模型官方 ID、Base
                  URL、鉴权方式，再分别找到创建请求和响应示例。文生图、图生图等请求结构不同时，应分别建立
                  mode，不要塞进同一个模板。
                </p>
                <ol className="model-guide-steps">
                  <li>
                    <strong>归并协议</strong>
                    <span>
                      先按真实请求和响应协议分组，相同协议只创建一个 Adapter。
                    </span>
                  </li>
                  <li>
                    <strong>定义请求</strong>
                    <span>
                      把官方 method、接口路径、鉴权和请求体写入
                      endpoint、auth、requestTemplate。
                    </span>
                  </li>
                  <li>
                    <strong>定义输入与控件</strong>
                    <span>
                      用 inputConstraints 描述素材，用 params.presentation
                      显式声明控件。
                    </span>
                  </li>
                  <li>
                    <strong>定义结果</strong>
                    <span>
                      区分 JSON 路径、Hex、同步二进制响应体与异步下载端点。
                    </span>
                  </li>
                  <li>
                    <strong>保存协议</strong>
                    <span>
                      导入协议设置后，再到 API 厂商中批量绑定模型 ID。
                    </span>
                  </li>
                </ol>
                <h5>最小完整结构</h5>
                <pre>
                  <code>{MODEL_SKELETON}</code>
                </pre>
              </article>
            )}
            {tab === "fields" && (
              <article>
                <div className="model-guide-kicker">协议字典</div>
                <h4>字段必须对应真实 API 行为</h4>
                <div className="model-guide-field-table">
                  <div>
                    <code>defaultMode / modes</code>
                    <span>
                      默认调用模式与全部调用方式。defaultMode 必须引用真实的
                      mode.id。
                    </span>
                  </div>
                  <div>
                    <code>endpoint</code>
                    <span>
                      创建请求的 method、相对 path 和 scope。path 不重复填写
                      Base URL；模型 ID 位于路径中时可使用 {"{{model}}"}。
                    </span>
                  </div>
                  <div>
                    <code>auth</code>
                    <span>
                      bearer、header 或 none。自定义 Header 还要提供
                      name，必要时提供 prefix。
                    </span>
                  </div>
                  <div>
                    <code>inputConstraints</code>
                    <span>
                      允许的文本、图片、视频、音频输入数量及角色，必须符合厂商限制。
                    </span>
                  </div>
                  <div>
                    <code>inputMode / inputSlots / inputVariants</code>
                    <span>
                      显式区分普通参考、首帧、首尾帧和视频续写；同一协议支持多种语义时逐项声明变体，不能依靠素材顺序猜测。
                    </span>
                  </div>
                  <div>
                    <code>inputFormat / requestFields</code>
                    <span>
                      明确选择 json 或 multipart；multipart
                      的图片、视频、音频及蒙版文件字段完全按当前网站文档填写。
                    </span>
                  </div>
                  <div>
                    <code>outputConstraints</code>
                    <span>
                      输出数量、时长、格式、最大 Token 及流式/工具能力。
                    </span>
                  </div>
                  <div>
                    <code>params</code>
                    <span>
                      节点界面参数。必须声明 presentation.control，key 与
                      requestTemplate 的 params.key 一致。
                    </span>
                  </div>
                  <div>
                    <code>requestTemplate</code>
                    <span>
                      最终发送给厂商的请求体；静态值原样发送，双大括号值由运行时替换。
                    </span>
                  </div>
                  <div>
                    <code>result…Path</code>
                    <span>
                      从真实响应读取结果的点路径；多结果数组使用 *，例如
                      data.*.url。
                    </span>
                  </div>
                  <div>
                    <code>resultBody</code>
                    <span>
                      提交接口成功后直接返回 MP3、WAV 等文件流时使用，并明确
                      MIME 和扩展名。
                    </span>
                  </div>
                </div>
                <h5>multipart 文件字段</h5>
                <pre>
                  <code>{MULTIPART_SKELETON}</code>
                </pre>
                <p className="model-guide-note">
                  multipart 文件不要再放进
                  requestTemplate。字段名不会被运行时改写；第三方网站要求
                  image、image[] 或编号字段时分别照原文配置。
                </p>
                <h5>常用运行时变量</h5>
                <div className="model-guide-token-grid">
                  <code>
                    {"{{model}}"}
                    <small>API 厂商绑定的官方模型 ID</small>
                  </code>
                  <code>
                    {"{{prompt}}"}
                    <small>用户提示词</small>
                  </code>
                  <code>
                    {"{{messages}}"}
                    <small>文本对话消息</small>
                  </code>
                  <code>
                    {"{{imageUrl}}"}
                    <small>单张输入图片</small>
                  </code>
                  <code>
                    {"{{imageUrls}}"}
                    <small>输入图片数组</small>
                  </code>
                  <code>
                    {"{{referenceImageUrls}}"}
                    <small>普通参考图数组</small>
                  </code>
                  <code>
                    {"{{firstFrameImageUrl}}"}
                    <small>首帧图片</small>
                  </code>
                  <code>
                    {"{{lastFrameImageUrl}}"}
                    <small>尾帧图片</small>
                  </code>
                  <code>
                    {"{{inlineImage.mimeType}}"}
                    <small>Google 内联图片 MIME</small>
                  </code>
                  <code>
                    {"{{inlineImage.bytesBase64Encoded}}"}
                    <small>Google 内联图片 Base64</small>
                  </code>
                  <code>
                    {"{{content}}"}
                    <small>结构化多模态内容</small>
                  </code>
                  <code>
                    {"{{params.key}}"}
                    <small>节点参数值</small>
                  </code>
                </div>
                <p className="model-guide-note">
                  变量必须来自 Shotloom
                  运行时；不要把厂商文档里的示例占位符直接当成运行时变量。
                </p>
                <h5>Gemini 原生内联图片</h5>
                <pre>
                  <code>{GEMINI_INLINE_SKELETON}</code>
                </pre>
                <h5>同步文件流与 JSON Hex 音频</h5>
                <pre>
                  <code>{DIRECT_BINARY_RESULT_SKELETON}</code>
                </pre>
                <pre>
                  <code>{HEX_RESULT_SKELETON}</code>
                </pre>
              </article>
            )}
            {tab === "async" && (
              <article>
                <div className="model-guide-kicker">视频和部分图片接口</div>
                <h4>创建任务与查询结果是两次请求</h4>
                <p>
                  如果创建响应只返回任务
                  ID，不能把创建响应里的字段当成最终媒体地址。先用 taskIdPath
                  取出 ID，再按 taskEndpoint 查询，直到 pollStatusMap 映射为
                  completed。
                </p>
                <pre>
                  <code>{ASYNC_SKELETON}</code>
                </pre>
                <h5>任务完成后下载二进制结果</h5>
                <p>
                  如果状态接口只有 status 和 task
                  ID，而媒体需要从另一个鉴权地址下载，使用
                  resultEndpoint，不要虚构结果 URL 字段。
                </p>
                <pre>
                  <code>{BINARY_RESULT_SKELETON}</code>
                </pre>
                <div className="model-guide-checklist">
                  <strong>保存前检查</strong>
                  <label>
                    <span>01</span>taskIdPath 能从创建响应取到真实任务 ID
                  </label>
                  <label>
                    <span>02</span>taskEndpoint.path 包含 {"{taskId}"}
                  </label>
                  <label>
                    <span>03</span>statusPath 指向官方状态字段
                  </label>
                  <label>
                    <span>04</span>所有官方状态都映射为 running、completed 或
                    failed
                  </label>
                  <label>
                    <span>05</span>resultUrlPath 来自任务完成后的查询响应
                  </label>
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
                  <button
                    className="button ghost"
                    type="button"
                    onClick={() => void copyAIPrompt()}
                  >
                    <IconSymbol name={copied ? "check" : "copy"} />
                    {copied ? "已复制" : "复制任务说明"}
                  </button>
                </div>
                <p>
                  复制下面的任务说明，并附上完整接口说明、参数表、创建请求、查询任务和响应示例。AI
                  只返回 Adapter 数组，可直接导入协议设置；模型 ID 在 API
                  厂商中另行批量添加。
                </p>
                <pre className="model-guide-ai-prompt">
                  <code>{AI_MODEL_PROTOCOL_PROMPT}</code>
                </pre>
              </article>
            )}
          </main>
        </div>
        <footer>
          <span>指南与当前 Provider Adapter 协议版本保持一致。</span>
          <button className="button primary" type="button" onClick={onClose}>
            返回模型配置
          </button>
        </footer>
      </section>
    </div>
  );
}
