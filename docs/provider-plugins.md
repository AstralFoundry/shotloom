# 厂商插件 / Vendor plugins

Shotloom 以厂商插件为安装、启停和更新单位。一个插件同时包含普通生成模型、画布工具和内部请求协议。用户安装插件后配置一次连接与 API Key，模型和工具共用该连接；无需安装或选择协议插件。

## 使用

在插件中心选择厂商，点击设置填写 API 地址和 Key。模型出现在相应生成节点的模型选择中；超分、去字幕等工具由插件的能力声明挂到画布工具条和右键菜单。厂商可以提供多个连接用于不同账号，但每个连接下的模型与工具共享凭据。

默认发行 17 个厂商插件、17 个连接和 67 个模型。StarRouter 不再默认发行，源码独立位于 `plugin-packages/vendor.starrouter/`，通过已发布的 npm 包 [`@shotloom/shotloom-plugin-starrouter@1.0.1`](https://www.npmjs.com/package/@shotloom/shotloom-plugin-starrouter) 按需安装，包含 19 个文本、图片、视频、音频模型及 `comfly/1849` 视频超分。普通生成采用声明式请求，超分采用包内 Node runtime，二者使用同一个 `starrouter` 连接。

面向插件作者的完整操作指南见 [插件开发指南](./plugin-development.md)，涵盖建包、模型、画布工具、图标、调试和发布。

## 包契约

- `manifest.json` 使用 `apiVersion: 2`、`kind: "vendor"`，提供稳定的 ID、名称、语义版本和 Shotloom 兼容范围。
- `protocols` 是包内的请求操作，不是独立插件。各操作定义 endpoint、请求模板、响应解析和查询/取消契约。同一个厂商包可包含多种请求格式。
- `defaultConnections` 提供厂商的连接和模型预设，`pluginId` 必须是本包，`presetId` 为 `vendor`。模型的 `protocolModes` 只能指向本包操作，不能引用其他插件；模型保留自己的输入限制、参数和上游 ID。
- `capabilities` 声明画布工具的输入、输出、参数和入口，每项的 `operation` 指向包内操作。不需要为工具制造虚假生成模型。
- `engine: "declarative"` 用于生成模型的声明式请求；`engine: "module"` 用于包内代码生成。画布工具由 `runtime.entry` 执行，即使同包的普通模型使用声明式请求也可以运行工具。
- `providers: []` 保留为兼容字段。`runtime/index.mjs` 可导出 `submit`、`poll`、`cancel`、`models`；包需自包含依赖。
- API Key 只保存到本机连接设置，不写入 manifest、任务契约或命令行。

应用提供包校验、声明式请求执行、凭据读取、独立 Node 宿主、任务持久化、画布入口、素材归档和 Agent 工具。上传、鉴权、提交、轮询和结果解析规则由插件内部声明或实现。包内使用公共请求格式时，仍需把该契约包含在本包中，不引入运行时协议插件依赖。

```sh
npm run plugin -- validate plugin-packages/vendor.starrouter
npm run plugin -- pack plugin-packages/vendor.starrouter /tmp/starrouter.shotloom-plugin
```

包名（去掉 npm scope 后）以 `shotloom-plugin-` 开头；npm `package.json` 的 `shotloomPlugin` 指向 `manifest.json`，版本与 manifest 一致。兼容范围示例为 `>=0.9.2, <1.0.0`。包路径不能越界；最多 256 个文件、压缩 20 MiB、展开 40 MiB。同一版本内容不可变，修改后须升版本。

## 从旧版迁移

默认发行包提供显式 `vendorMigration` 元数据，把旧协议操作映射为厂商包内部操作。仅发行来源的映射参与自动迁移；外部包不能借该字段接管用户连接。

迁移保留连接 ID、模型 ID、名称、地址、Key、自定义参数和禁用状态。旧版独立媒体连接在 Key 一致时并入主连接；不同 Key 保留为同厂商下的另一连接。旧 Key 及旧包文件不删除，旧连接快照存入 `legacyConnections`，仅供历史任务查询和取消。已卸载项、删除的默认连接不会因合并重新启用；部分禁用的旧协议对应模型保持禁用。已固定的画布工具入口随包身份更新。

旧 `kind: "protocol"` 和 v1 provider preset 格式只作为兼容路径保留，不再作为新插件的设计方式，也不再出现在默认市场目录中。升级不会改写历史任务冻结的操作契约。

## 代码接口 / Executable interface

```js
export async function submit(input, { config, signal }) {
  // input.submissionId remains stable for this Shotloom task.
  return { remoteTaskId: 'provider-task-id', status: 'running', progress: 0 };
}
export async function poll({ remoteTaskId }, context) {
  return { remoteTaskId, status: 'completed', progress: 100,
    result: { text: 'Result' } };
}
export async function cancel({ remoteTaskId }, context) {}
export async function models(input, context) { return []; } // optional SDK hook
```

`config` 来自当前连接的本机设置，包含 `apiKey` 和生效的 `baseUrl`。返回状态为 `queued`、`running`、`completed`、`failed`、`timeout`、`cancelled` 或 `error`；完成必须附带真实 `result`，异步状态必须返回 `remoteTaskId`。媒体结果沿用 `ProviderAdapter` 的结果结构。声明 `supportsCancel: true` 才在产品中提供取消能力。

`config` comes from the selected connection's local settings, including its key and effective base URL. Valid statuses are `queued`, `running`, `completed`, `failed`, `timeout`, `cancelled` and `error`. Completion requires a real `result`; asynchronous states require a `remoteTaskId`. Media results use the existing `ProviderAdapter` result shape. Declare `supportsCancel: true` to expose cancellation.

每次调用运行独立 Node 进程，不保留内存状态。必须使用服务端任务 ID 跨调用查询。宿主强制超时、取消和输出上限，并为提交持久化回执。若提交已发出但结果不明确，不会自动重发；可以在任务界面用厂商任务 ID 找回。建议上游也使用 `submissionId` 实现幂等。

Each call runs in a separate Node process with no persistent memory. Use the remote task ID between calls. The host enforces timeouts, cancellation and output limits and persists submission receipts. An uncertain submission is never automatically resent; recover it with the provider task ID in the task UI. Providers should also use `submissionId` for idempotency.

代码插件具有当前用户的本机权限，并非安全沙箱；只安装你信任的代码。宿主不把 Key 放到命令行参数和插件包内，但插件执行时能读取自身连接的凭据。浏览器预览仅支持声明式 JSON 安装；代码包需桌面版。`models` 是代码接口，当前连接编辑器使用显式模型目录，不自动把 `/models` 的裸 ID 推断成完整能力。

Code plugins run with the current user's local permissions, not in a security sandbox. Install only trusted code. Keys are not placed in command-line arguments or packages, but executing plugins can read their connection credentials. Browser preview supports declarative JSON installation only; executable packages require the desktop app. The `models` hook is available to code clients; the connection editor uses explicit catalogs and does not infer complete capabilities from bare `/models` IDs.

## 索引 / Index

```json
{
  "apiVersion": 1,
  "plugins": [{
    "id": "example.openai-compatible",
    "name": "Example",
    "version": "1.0.0",
    "url": "https://example.com/example-1.0.0.shotloom-plugin",
    "sha256": "<64 lowercase hexadecimal characters>"
  }]
}
```

索引可以放在 GitHub Releases、静态网站或自己的对象存储。HTTPS 分发与摘要核对能验证下载内容与索引一致；索引本身仍属于用户选择的信任来源，不代表官方审核或签名认证。

Host the index on GitHub Releases, a static website or object storage. HTTPS and digest matching verify consistency with the chosen index; they do not imply an official review or publisher signature.

媒体接入范围、官方依据与验证边界见 [媒体协议接入 / Media integrations](./media-protocols.md)。

2026-11-15 的模型目录更新与未完成核对项见 [模型目录核对 / Model catalog audit](./model-catalog-audit.md)。


## npm 分发与安装 / npm distribution and installation

包名必须以 `shotloom-plugin-` 开头；带作用域时校验 `/` 后的名称，例如 `@scope/shotloom-plugin-example`。显示名称不受此限制。

Package names must start with `shotloom-plugin-`, including the name after a scope. Display names are unrestricted.

桌面版「安装插件」默认进入 npm 安装。输入包名、固定版本或标签，例如 `@your-scope/shotloom-plugin-example@1.0.0` 或 `@your-scope/shotloom-plugin-example@latest`。这些是格式示例，不是已发布的包。

Desktop installation accepts package names, exact versions and dist-tags. The examples above describe syntax, not published packages.

应用从公共 npm registry 解析元数据，检查 tarball 的 SHA-512 integrity，再显示解析出的固定版本。安装使用该固定版本与检查时的 SHA-256，标签后续变动不会悄悄换包。它沿用现有代码信任、版本不可变、卸载保留历史与回滚流程；不会启动 `npm install` 或执行 `preinstall` / `postinstall` 等脚本。当前不支持私有 registry 登录和 semver 范围，浏览器预览会提示使用桌面版。

The public npm registry resolves package metadata. SHA-512 verifies its tarball; inspection pins an exact version and SHA-256 for installation. Existing trust, immutability, history and rollback rules apply. Installation never invokes npm lifecycle scripts. Private registry authentication and semver ranges are not supported. Browser preview directs users to the desktop app.

插件作者可以直接发布标准 npm tarball。包根目录需要 `manifest.json`，并在 `package.json` 声明：

Authors publish a standard npm package with `manifest.json` at its root and the following package metadata:

```json
{
  "name": "@your-scope/shotloom-plugin-example",
  "version": "1.0.0",
  "shotloomPlugin": "manifest.json",
  "files": ["manifest.json", "README.md", "docs", "runtime"],
  "license": "MIT"
}
```

npm 与 manifest 版本必须一致。`README.md` 和 `docs/*.md` 可随包发布；代码插件的依赖需预先打包到运行文件中，不携带 `node_modules`，安装后不自动解析依赖。原有 20 MiB 下载、40 MiB 展开、256 文件限制同样适用；链接与越界路径不会被解包。

Package and manifest versions must match. Bundle code dependencies ahead of publication; no `node_modules` or post-install dependency resolution is used. Existing archive limits apply: 20 MiB download, 40 MiB expanded, 256 files, with links and unsafe paths rejected.

### 发布到 npm / Publishing to npm

以下以 OpenAI Images 为例，从仓库根目录执行。当前包名为 `@shotloom/shotloom-plugin-openai`，需要拥有 npm 上 `@shotloom` 作用域的发布权限；如果使用自己的账号或组织，先修改插件 `package.json` 的 `name`，例如 `@your-scope/shotloom-plugin-openai-images`。包名必须遵守前述前缀规则，插件显示名称和 manifest 的稳定 ID 不需要跟着改。

The example below starts at the repository root. Publishing under `@shotloom` requires permission for that npm scope. Otherwise, change the package name to your own scope first. Keep the required name prefix; the display name and stable manifest ID do not need to change.

```sh
# 校验插件 / Validate the plugin
npm run plugin -- validate plugin-packages/defaults/vendor.openai

# 登录官方源，按提示完成认证 / Sign in and complete the requested authentication
npm login --registry=https://registry.npmjs.org/

cd plugin-packages/defaults/vendor.openai

# 预览文件清单，确认没有 Key、凭据或其他不应发布的文件
# Inspect the file list for credentials and unintended files
npm pack --dry-run

# 正式发布公开包 / Publish publicly
npm publish --access public --registry=https://registry.npmjs.org/
```

发布前建议补充 `description`、`keywords`、`repository`、`author` 和与实际授权一致的 `license`。不要直接套用示例中的 MIT；仓库中的默认插件没有因此自动获得 MIT 授权。关键词建议包含 `shotloom`、`shotloom-plugin` 和插件能力，例如 `image`。确认 `files` 包含 manifest、README、文档与运行文件；npm 安装消费标准 npm tarball，无需把生成的 `.shotloom-plugin` 文件再塞进 npm 包。

Add a description, keywords, repository, author and the actual license before publication. The illustrative MIT value above does not grant that license to repository code. Suggested keywords include `shotloom`, `shotloom-plugin` and the capability, such as `image`. Publish the manifest, documentation and bundled runtime directly; a nested `.shotloom-plugin` archive is unnecessary.

发布后可检查官方源中的版本：

After publication, verify the version on the official registry:

```sh
# 如果改过作用域，请替换包名 / Substitute your package name if changed
npm view @shotloom/shotloom-plugin-openai version --registry=https://registry.npmjs.org/
```

随后在 Shotloom「插件市场」切到 npm 官方源搜索包名，或在「安装插件 → npm 包」中输入 `@shotloom/shotloom-plugin-openai@1.0.1`，检查后安装。搜索索引与国内镜像可能尚未同步；此时先用官方源按完整包名和固定版本验证。更新时同时递增 `package.json` 与 `manifest.json` 的版本，再重新校验、预览并发布；同一 npm 名称与版本不能重复发布不同内容。17 个默认插件各自是独立包，发布一个不会自动发布其他插件，也不会自动更新应用的离线发行包。

Then search the marketplace using the official npm source, or install the exact package/version directly. Search indexing and mirrors may lag; verify against the official source with an exact version first. For updates, increment both package and manifest versions, validate, inspect and publish again. Published name/version pairs cannot be reused for different contents. Each default plugin is a separate package; publishing one does not publish the others or update the application's offline distribution.

## 画布处理能力 / Canvas processing capabilities

`apiVersion: 2` 的 `kind: "vendor"` 包通过 `runtime` 执行工具，可用 `capabilities` 声明多个画布处理能力。旧 `apiVersion: 1` 包继续运行，但不能声明这个字段。能力不要求添加虚假的生成模型；一个厂商插件可以用同一连接提供多个能力。

每个能力包含稳定 `id`、`name`、`description`、指向包内 protocol ID 的 `operation`，以及 `inputs`、`outputs`、`parameters`、`surfaces`。输入和输出槽都有 `id`、`label`、`type: image | video | audio`，可声明 `required`、`multiple`。参数支持 `string | number | boolean`、`default`、`enum`、数值 `minimum/maximum` 和 `visibleWhen: { parameter, equals }`；不执行表达式。入口支持 `toolbar`、`contextMenu`，工具条当前覆盖图片与视频，音频可通过右键和参数面板使用。远程取消由能力声明 `supportsCancel`，并由 runtime 实现 `cancel`。

宿主在视频/图片工具条的“更多”和节点右键菜单合并能力，用户可自行固定按钮。通用面板按命名槽选择画布素材，例如一个视频槽和一个音频槽；输入绑定选定的媒体版本。未配置连接仍可查看面板，执行需要保存的桌面工程及可用连接。包的 `defaultConnections` 仍按原有方式在首次安装时填充，Key 仅从用户连接设置读取。

执行模块接收 `submit({ submissionId, processingContract }, context)`；查询和取消接收 `{ remoteTaskId, processingContract }`。`processingContract` 保存能力、操作、插件版本/摘要、连接 ID、命名输入（节点/素材 ID、媒体类型、本地路径或 URL）和参数，不含凭据。模块负责按已验证服务契约上传本地媒体、转换参数及返回宿主任务状态。不要把本地路径当成服务可访问的 URL。

模块返回 `{ status, progress, remoteTaskId }`，完成时必须提供命名输出，例如：

```js
return {
  status: 'completed', progress: 100, remoteTaskId,
  result: { outputs: { result: [{ url: 'https://service.example/result.mp4' }] } },
};
```

输出名必须匹配能力的输出槽；宿主验证必需性和数量，再下载到项目、保存素材并创建关联媒体节点。画布不创建中间处理节点，原素材直接连接到新结果；任务的私有执行快照仍保存在后台。任务先持久化再远程提交；提交不明不会自动重提，归档失败可独立恢复。更新、禁用或卸载不会把已有任务改成新能力；已有任务固定原包与契约。删除源节点后仍保存任务与素材，不重新创建已删除节点。旧版本的处理卡片在任务恢复时折叠为直接连线，任务记录保留。代码信任被撤销后，需先恢复信任才能继续执行模块代码。

本地可运行样例：

```sh
node plugin-packages/examples/canvas-actions-service.mjs
npm run plugin -- validate plugin-packages/examples/canvas-actions
npm run plugin -- pack plugin-packages/examples/canvas-actions /tmp/canvas-actions.shotloom-plugin
```

在桌面安装生成的包并信任代码后，保存工程、导入视频或图片，从“更多”选择样例能力。该服务只复制输入，不执行 AI。完整行为验证为 `node --test tests/plugin-canvas-actions.test.mjs`，覆盖真实模块进程、本地 HTTP 服务、持久化与归档，以及多输入、条件参数、多个输出、重复提交、工程切换和历史版本。真实 AI 接入必须另有服务参数与真实任务结果证明。

画布 Agent 使用 `inspect_plugin_capabilities`、`prepare_plugin_action`、`run_plugin_action`；这些工具消费同一能力目录与执行链路，遵守工具白名单、会话工程绑定、节点执行开关及既有审批规则。其他 Agent 不自动获得运行能力。

## 插件详情 / Plugin details

双击插件卡片打开详情；点击卡片上的设置按钮打开独立设置，两者没有互相切换入口。详情展示 README、作者/版本/许可证/主页、插件 ID、兼容版本、安装来源、执行方式、连接配置，以及每个操作的真实鉴权、同步/异步状态、创建/Agent/查询/结果/取消接口、参数类型/必填/默认值与输入输出契约。

Double-click a plugin card to open Details. The Settings button opens settings separately; neither dialog includes a switch to the other. Details display packaged documentation, identity and provenance, connection fields and real operation contracts, including endpoints, authentication, lifecycle and parameter requirements/defaults.

README 的 HTML 不执行；Markdown 表格、代码块和链接按文本安全展示。包内 Markdown 链接读取已安装版本中的文档，外部 HTTP(S) 链接由用户点击打开。插件没有 README 时仍可查看自动生成的契约详情。详情页不读取或展示已保存的 API Key。

Raw HTML is inert. Markdown tables, code blocks and links are rendered safely. Relative Markdown links read installed package documentation; external HTTP(S) links require a user click. Plugins without a README still show generated contract details. Saved API keys are never read or displayed by Details.


## 发行时默认安装 / Default installation in releases

所有默认插件的源码位于 `plugin-packages/defaults/<plugin-id>/`，发行目录只由 `plugin-packages/defaults/index.json` 登记包名，不复制模型定义。例如 OpenAI 位于 `plugin-packages/defaults/vendor.openai/`。每个包可独立校验、打包，也可以按前文的 npm 方式分发；仓库里的 npm 包名不表示已经发布到 registry。

Default plugin sources live in independent directories under `plugin-packages/defaults/`. The index lists package directories without duplicating model definitions. Packages can be independently validated, packed and published; repository package names do not establish npm publication.

```sh
npm run prepare:plugins
npm run plugin -- validate plugin-packages/defaults/vendor.openai
npm run plugin -- pack plugin-packages/defaults/vendor.openai /tmp/openai-images.shotloom-plugin
```

开发和构建入口会运行 `prepare:plugins`。它校验全部操作和预设，生成固定时间戳的 ZIP 与 SHA-256 索引，分别写入 `electron/resources/provider-plugins/` 和 `renderer/public/provider-plugins/`。这些是生成产物，不提交。桌面打包包含前者；启动时离线安装到用户目录，运行目录不导入任何内置厂商 JSON。

Development/build hooks prepare deterministic archives and a SHA-256 index for desktop resources and browser static assets. Generated artifacts are ignored by Git. Desktop releases carry the archives and install them offline into user storage. The application catalog imports no built-in provider JSON.

默认安装的插件可以卸载、停用、手动更新和回滚。再次启动只安装从未登记过的新包，已卸载记录和用户安装的版本优先，不会自动恢复或覆盖。同一版本仍不得修改内容；发布变更请升版本。`defaultConnections` 只在首次安装该插件时填充，重新启动不改写模型能力；旧用户已有连接在首次迁移时完整保留。历史凭据和包文件继续保留，支持旧任务查询。

Preinstalled packages are removable, disableable and manually updateable/rollbackable. Startup installs only previously unregistered package IDs; removed records and user-installed versions win. Published versions remain immutable. `defaultConnections` seeds a new package once; restart never resets model edits. Migration preserves saved connections, credentials and historical artifacts for existing tasks.

RunningHub 的上传、工作流和轮询代码也在其插件的 `runtime/` 中，由通用模块宿主执行。发行资源中的代码随应用受信任；另外安装的代码仍需要用户明确确认信任。浏览器可以查看目录和文档，不能执行 Node 插件。

RunningHub's upload, workflow and polling code lives in its package runtime and uses the generic module host. Release-shipped code is trusted with the application; separately installed executable code still requires explicit trust. Browser preview can display packages and documentation but cannot execute Node plugins.

## 插件市场 / Plugin marketplace

Agent 文本请求的厂商缓存能力、设置、统计边界与验证方式见 [Agent 提示词缓存](./agent-prompt-cache.md)。

分类栏的「插件市场」默认进入 npm 社区搜索，仅展示包名符合 `shotloom-plugin-xxx` 或 `@scope/shotloom-plugin-xxx` 的结果。支持搜索、分页和安装前检查；搜索结果不代表已验证的兼容插件。下载源默认使用 npm 官方源，也可选择 npmmirror，搜索、版本解析和安装使用同一个选定源。市场不维护内置推荐清单，也不会自动安装搜索结果。

The marketplace opens npm community search by default and filters package names to the Shotloom plugin naming convention. It supports pagination and package inspection before installation. Choose the official npm registry (default) or npmmirror for search and installation. Search results are not compatibility endorsements.

### 插件自带图标

将 PNG/JPEG/WebP/GIF 图片随插件打包（最大 64 KiB），在 manifest 中声明相对路径，例如 `"icon": "icon.png"`。路径不能引用远程地址或包外文件。检查、安装和默认包加载时读取图片，应用直接展示包内内容；未声明时继续使用 `iconId` 或通用图标。

npm 包同时声明 `"shotloomIcon": "icon.png"`，并把图片加入 `files` 白名单。插件市场从 npm 最新版本元数据读取该路径，通过 jsDelivr 加载该确切版本的包内图片；加载失败回退通用图标。已安装插件使用本地包内图片，显示不依赖 CDN。修改图片或 manifest 时应增加版本号。

默认发行插件同样将 `icon.png` 放在各自包内，声明 `icon` 与 `shotloomIcon` 并加入 npm `files`。App 的品牌目录仅作为旧配置和缺失图标的兼容回退。现有安装不会因替换发行资源而自动升级；图标随手动更新到新插件版本生效。
