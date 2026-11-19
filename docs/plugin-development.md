# 插件开发指南

本文面向 Shotloom 插件作者，描述当前 `apiVersion: 2` 的厂商插件。安装、迁移和运行机制见 [厂商插件参考](./provider-plugins.md)。

## 先确定插件边界

一个厂商只需一个插件。普通生成模型、视频超分、去字幕等画布工具可以放在同一个包中，共用连接地址和 API Key。接口协议由插件自身声明或实现，不需要让用户再安装一个“协议插件”。

| 需求 | 插件内实现 | App 负责 |
| --- | --- | --- |
| 文本、图片、视频、音频生成 | `protocols` 请求操作与 `defaultConnections[].models` 模型目录 | 模型选择、参数面板和生成任务 |
| 对已有素材处理 | `capabilities` 能力目录与 `runtime` | 工具条、右键菜单、输入参数和结果节点 |
| 特殊上传、签名或工作流 | 包内 Node 模块 | 凭据传递、执行宿主、任务恢复 |
| 插件图标 | 包内图片及 manifest 声明 | 检查、安装后显示图片 |

插件不能注入任意 React 页面或任意工具条代码。当前扩展方式是声明媒体槽、参数和入口，由 App 生成面板；复杂厂商流程在 runtime 内编排。

## 目录与身份

```text
vendor.example/
├── package.json
├── manifest.json
├── README.md
├── icon.png
├── docs/                 # 可选的 Markdown 说明
└── runtime/
    └── index.mjs         # 纯声明式生成插件可省略 runtime
```

- `manifest.id` 是稳定的插件身份，升级不改变。仓库的包读取辅助函数要求文件夹名与 ID 相同。
- `package.json.name` 是 npm 包名，去掉 scope 后必须以 `shotloom-plugin-` 开头；不决定界面显示名称。
- `manifest.name` 是用户看到的名称。
- `manifest.version` 与 npm 版本必须相同；已发布版本内容不可变。
- `shotloom` 是 App 兼容范围，例如 `>=0.9.2, <1.0.0`。

以下 npm 元数据用于自己的包；请替换 scope，并按实际授权填写作者和许可证。

```json
{
  "name": "@your-scope/shotloom-plugin-example",
  "version": "1.0.0",
  "description": "Example 厂商模型和画布工具",
  "keywords": ["shotloom", "shotloom-plugin"],
  "shotloomPlugin": "manifest.json",
  "shotloomIcon": "icon.png",
  "files": ["manifest.json", "README.md", "docs", "runtime", "icon.png"]
}
```

`shotloomPlugin` 必须声明为 `manifest.json`。安装不会执行 npm 生命周期脚本或自动安装依赖，runtime 的第三方依赖须事先打包；不要发布 `node_modules`。

## 从可运行样例开始

仓库提供 [画布工具样例](../plugin-packages/examples/canvas-actions/README.md)，含完整 manifest、runtime 和本地 HTTP 服务。它只复制图片或视频，用于验证插件链路，不具备 AI 超分能力。

从 Shotloom 仓库根目录执行：

```sh
# 终端一：启动样例服务，默认端口 19392
node plugin-packages/examples/canvas-actions-service.mjs
```

```sh
# 终端二：校验并打包
npm run plugin -- validate plugin-packages/examples/canvas-actions
npm run plugin -- pack plugin-packages/examples/canvas-actions /tmp/canvas-actions.shotloom-plugin
```

在桌面 App 中打开「插件 → 安装插件 → 文件 / URL」，检查并安装该文件，确认信任代码。打开插件设置，保存样例的本地连接；样例声明 `authRequired: false`，不需要 Key。保存项目并导入图片或视频，在节点工具条“更多”或右键菜单选择样例工具。完成后应出现新媒体节点，原素材直接连接结果，后台任务保留执行记录。

开发自己的包时，复制样例到新目录，修改稳定 ID、npm 名称、连接 ID、能力 ID、操作和 runtime。复制后先保留本地服务跑通，再替换成真实厂商接口。不要把样例的假响应用于真实服务的完成声明。

## Manifest 核心字段

以 [样例 manifest](../plugin-packages/examples/canvas-actions/manifest.json) 为可执行模板：

| 字段 | 用途 |
| --- | --- |
| `apiVersion: 2`、`kind: "vendor"` | 当前厂商插件契约 |
| `engine` | 普通模型用 `declarative` 声明式请求或 `module` 模块执行 |
| `providers: []` | 保留兼容字段，新厂商包使用 `defaultConnections` |
| `protocols` | 本包拥有的请求操作，每项有稳定 `id` 和 `mode` |
| `runtime.entry` | 例如 `runtime/index.mjs`；画布处理能力需要 runtime |
| `defaultConnections` | 首次安装时的连接与可用模型预设 |
| `capabilities` | 可选的画布处理能力；没有工具时省略此字段 |
| `icon` | 包内相对图片路径，例如 `icon.png` |

同一个 `engine: "declarative"` 的包也能声明 runtime 来执行画布工具，普通模型仍走声明式请求。[StarRouter 独立包](../plugin-packages/vendor.starrouter/manifest.json) 就包含普通模型和 `comfly/1849` 视频超分，未加入默认发行索引。

连接的 `pluginId` 指向本插件，`presetId` 为 `vendor`，地址填写厂商真实地址。连接不携带出厂 API Key；用户在插件设置内填写，模型与工具复用该连接。`defaultConnections` 是首次安装预设，更新和重启不会强制覆盖用户已保存的配置。

## 添加普通生成模型

可参考 [OpenAI 厂商包](../plugin-packages/defaults/vendor.openai/manifest.json) 的声明式生成，以及 [RunningHub 厂商包](../plugin-packages/defaults/vendor.runninghub/manifest.json) 的模块执行。

1. 在 `protocols` 中定义操作：端点方法、路径与作用域、鉴权、请求模板、结果字段，以及异步任务查询和取消接口。
2. 在连接的 `models` 中定义模型稳定 `id`、显示名称、`type`、`defaultMode` 与 `modes`。上游请求 ID 不同于目录 ID 时，填写 `upstreamModel`。
3. 用模型的 `protocolModes` 将每个模式映射到本包操作 ID。不能引用另一个插件的协议。
4. 按真实服务契约声明输入约束、参数、默认值和输出能力；模型参数使用 `key`，画布能力参数使用 `id`，两者结构不同。

模型类型为 `textGeneration`、`imageGeneration`、`videoGeneration` 或 `audioGeneration`。模型模式的数据结构见 [ModelCatalog](../renderer/src/domain/catalog/ModelCatalog.ts)，包校验规则见 [ProviderPlugins](../renderer/src/domain/provider/plugins/ProviderPlugins.ts)。不要只导入 `/models` 返回的裸 ID 就宣称支持所有输入方式；当前设置界面使用显式模型目录。

## 添加画布工具

以下是 `capabilities` 中一项的结构示例。它需要本包同时提供 `process-video` 操作与 runtime，本段不能单独作为完整插件安装。

```json
{
  "id": "video-upscale",
  "name": "视频超分",
  "description": "对所选视频提高分辨率，生成新的关联视频。",
  "operation": "process-video",
  "inputs": [{ "id": "source", "label": "原视频", "type": "video", "required": true }],
  "outputs": [{ "id": "result", "label": "超分结果", "type": "video", "required": true }],
  "parameters": [{ "id": "scale", "label": "倍率", "type": "number", "default": 2, "enum": [2, 4], "required": true }],
  "surfaces": ["toolbar", "contextMenu"],
  "supportsCancel": false
}
```

输入、输出槽支持 `image`、`video`、`audio`，`multiple: true` 表示同一槽可以有多个媒体。增加一个音频输入槽即可表达“视频 + 配音”等多输入工具，无需创建多个插件。

参数支持 `string`、`number`、`boolean`，可声明 `default`、`enum`、`minimum`、`maximum`、`required` 和 `visibleWhen: { "parameter": "另一个参数ID", "equals": true }`。参数条件不执行 JavaScript。准确字段与验证规则见 [共享能力契约](../shared/pluginCapabilities.ts)。

App 将能力合并到节点工具条“更多”和右键菜单，用户可固定到工具条。工具条目前覆盖图片与视频，音频可通过右键与参数面板使用。一个插件可声明多个能力，装一次即可使用；缺少 Key 时在插件设置配置连接即可。

### Runtime 输入与输出

runtime 导出异步 `submit(input, context)`、`poll(input, context)`，支持取消时另导出 `cancel`。

- 提交收到 `input.submissionId` 和 `input.processingContract`。
- 契约包含能力、操作、命名输入、参数、连接 ID、插件版本与摘要，不包含 API Key。
- 命名输入为数组，例如 `contract.inputs.source[0]`，包含媒体类型、节点/素材引用和 `filePath` 或 `url`。本地路径须由 runtime 上传，不能直接当成公网 URL 发送给厂商。
- 鉴权读取 `context.config.apiKey`，地址读取 `context.config.baseUrl`；`context.signal` 可传给 fetch。
- 查询和取消收到 `remoteTaskId` 以及原始 `processingContract`。

以下只是返回格式，任务 ID 和结果地址必须来自真实厂商响应：

```js
// submit：任务已被上游接受
return { remoteTaskId: data.id, status: 'running', progress: 0 };

// poll：将上游完成结果映射为命名输出
return {
  remoteTaskId: input.remoteTaskId,
  status: 'completed',
  progress: 100,
  result: { outputs: { result: [{ url: data.outputUrl }] } },
};
```

输出名必须与输出槽 ID 一致。返回的媒体由 App 下载归档到项目素材并创建结果节点。状态支持 `queued`、`running`、`completed`、`failed`、`timeout`、`cancelled`、`error`；进度为 0–100。异步任务必须提供 `remoteTaskId`，完成必须附带真实 `result`。普通生成模型的结果格式见 [ProviderAdapter](../renderer/src/domain/provider/ProviderAdapter.ts)，不要与画布工具的命名输出混用。

每次调用都运行独立 Node 进程，不能依赖内存变量跨提交、查询和重启保存状态。使用远程任务 ID；上游支持幂等时传递稳定的 `submissionId`。不要向 stdout 写调试内容，宿主用它传递 JSON 回执。代码运行拥有当前用户的本地权限，不是沙箱。

App 先保存任务再提交；提交结果不明确时不会自动重发收费请求。任务固定原插件版本和输入契约，更新、禁用或卸载插件不会切到新版本。删除原素材节点后，任务仍可归档素材，但不会重建已删除节点。归档失败和远程生成失败是不同问题，应分别恢复。

## 插件自带图标

把 PNG、JPEG、WebP 或 GIF 放进包内（每张不超过 64 KiB），建议透明 PNG。在 manifest 写 `"icon": "icon.png"`，npm 元数据写 `"shotloomIcon": "icon.png"`，并加入 `files` 白名单。

已安装插件读取本地包内图片。npm 市场通过最新版本元数据获取图片路径，再由宿主读取对应版本的 jsDelivr 资源并转换为内联图片；加载失败回退通用图标。已安装图标不依赖 CDN。当前不接受 SVG、远程 URL 或越出包目录的路径，`iconData` 是宿主解析产生的字段，作者不需要手写。

默认发行插件遵守相同规则，图片位于各自 `plugin-packages/defaults/vendor.*/icon.png` 中。`iconId` 只用于旧配置和缺少图片时的回退，不要求为新插件修改 App 品牌目录。

## 校验、打包与发布

```sh
# 从 Shotloom 仓库根目录执行，替换为自己的目录
npm run plugin -- validate /absolute/path/vendor.example
npm run plugin -- pack /absolute/path/vendor.example /tmp/example.shotloom-plugin
```

检查器验证 manifest、入口和图标文件。安装时还有完整的包检查：最多 256 个文件、压缩 20 MiB、展开 40 MiB，拒绝符号链接和越界路径。结构校验通过不等于真实厂商调用成功，发布前应在桌面测试提交、查询、取消、失败与恢复。

发布 npm 时，在插件目录先运行 `npm pack --dry-run`，确认 manifest、runtime、README 和图片都在 tarball 中。再按 [npm 发布流程](./provider-plugins.md#发布到-npm--publishing-to-npm) 登录、预览并发布。安装消费标准 npm tarball，无需把 `.shotloom-plugin` 再嵌入 npm 包。

用户在「安装插件 → npm 包」输入自己的完整包名和固定版本或 `latest`，先检查再安装。检查会固定实际版本并验证完整性。市场搜索索引可能晚于发布；可直接使用完整包名检查，不能把搜索不到当成未发布。

修改内容时同时递增两个版本号，再校验、打包、测试和发布。现有安装不会自动被发行资源覆盖；新图标和新能力需更新到新版本。若维护默认发行包，在独立包目录完成修改后运行 `npm run prepare:plugins`，不要手改生成的发行 ZIP 或把第三方插件加入默认索引来代替发布。

## 调试与验收

```sh
node --test tests/plugin-icons.test.mjs tests/provider-plugins.test.mjs tests/plugin-canvas-actions.test.mjs
```

上述测试用于 Shotloom 宿主回归；新插件还应针对自己的服务添加契约测试。至少验证：缺少 Key 的提示、输入上传与参数映射、真实完成结果、远程失败、取消支持声明、重复提交、重启后查询，以及升级后旧任务仍使用原版本。不要通过自动测试默认发起收费生成。

| 现象 | 排查位置 |
| --- | --- |
| 提示必须声明 `shotloomPlugin` | 发布 tarball 根目录的 package.json，不能只看本地工作区 |
| 检查后没有安装按钮 | 先处理检查区的错误：兼容范围、包结构、摘要或运行入口 |
| 图标仍为通用图案 | manifest 的 `icon`、npm 的 `shotloomIcon`、files 白名单和已安装版本 |
| 工具没有出现在菜单 | 插件/连接启用状态、媒体类型、`surfaces`、capability operation 引用 |
| 代码不能执行 | 是否桌面 App，是否确认信任代码，项目是否已保存 |
| 模型不见了或请求格式错误 | `protocolModes` 是否引用本包操作，模型模式与输入约束是否完整 |
| 生成成功但没有结果节点 | 命名输出、结果 URL 是否可下载、项目归档是否成功、源节点是否仍存在 |

查看真实样例：[本地多输出工具](../plugin-packages/examples/canvas-actions/)、[StarRouter 模型与超分](../plugin-packages/vendor.starrouter/)、[默认插件目录](../plugin-packages/defaults/index.json)。`examples/async-module` 等旧 `kind: "protocol"` 样例仅用于兼容测试，新插件从本文的厂商包结构开始。
