# 协议插件与厂商连接 / Protocol plugins and provider connections

Shotloom 将「协议插件」与「厂商连接」分开管理。协议插件定义怎样调用服务；连接保存服务地址、Key 和模型。一个协议可以供多个厂商共用，一个厂商的不同模型也可以选择不同协议。不需要 Shotloom 远程后端。

Shotloom separates protocol plugins from provider connections. Plugins define how to call a service; connections own endpoints, keys and models. Multiple providers can share a protocol, and models within one provider can use different protocols. No Shotloom server is required.

## 使用 / Usage

从左侧「插件中心」进入。「协议插件」按文本、图片、视频、音频分类，可以安装、启停、查看操作和回滚版本。「厂商连接」中填写名称、API 地址与 Key，再添加模型：填写显示名称、上游模型 ID，选择协议与支持的操作。模型参数和输入限制可在「模型能力（高级）」中调整，不能覆盖插件的请求协议。

Open Plugin center from the sidebar. Protocol plugins are grouped by text, image, video and audio, with install, enable, operation details and rollback controls. In Provider connections, enter a name, endpoint and key, then add models: set their display names, upstream IDs, protocol and supported operations. Model capabilities (advanced) edits parameters and input limits without replacing plugin transport contracts.

例如，两个不同 API 地址的服务可以共用 OpenAI Chat Completions；同一厂商的文本模型选 Chat 协议，图片模型选 Images 协议。发行包默认安装 32 个独立插件，提供 18 个默认连接和 86 个模型，原有 57 个模型 ID 和已保存 Key 保持兼容。停用协议会隐藏使用它的模型；停用连接只隐藏该连接的模型，凭据和历史任务继续保留。

For example, services at two endpoints can share OpenAI Chat Completions. A provider can bind its text model to Chat and its image model to Images. The release installs 32 independent default plugins providing 18 connections and 86 models, preserving the existing 57 model IDs and saved keys. Disabling a protocol hides its models; disabling a connection only hides that connection's models. Credentials and task history are retained.

安装时可选择 npm 包、本地 `.shotloom-plugin` / JSON 文件或 HTTPS URL，检查版本、操作和 SHA-256 后安装。代码插件需要显式信任；浏览器预览仅支持声明式 JSON。

Install from an npm package, local `.shotloom-plugin` / JSON file or HTTPS URL after inspecting its version, operations and SHA-256. Executable plugins require explicit trust; browser preview supports declarative JSON only.

可以填写自行托管的插件索引 URL 来检查版本。检查索引条目时会核对插件 ID、版本与 SHA-256。更新仍需用户确认；旧版本保留以供回滚和未完成任务使用。卸载会移出可选目录，但保留历史版本文件与凭据，避免破坏旧任务。

A self-hosted index URL can advertise updates. Inspection verifies package identity, version and SHA-256 against the index. Updates remain manual. Previous versions are retained for rollback and in-flight tasks. Uninstall removes discovery while retaining historical artifacts and credentials for saved tasks.

## 插件包 / Package format

- `manifest.json`: `apiVersion: 1`, `kind: "protocol"`, stable `id`, `name`, semantic `version`, compatible `shotloom` range, media `category`, `engine`, `protocols`, and `providers: []`.
- `category`: `textGeneration`, `imageGeneration`, `videoGeneration` or `audioGeneration`.
- `protocols`: reusable operations with stable IDs. Each `mode` defines endpoint, request template, response mappings and default model capabilities. Use `{{model}}` in templates and `{model}` in endpoint paths for the connection's upstream model ID.
- Connections are stored separately: `id`, `name`, `baseUrl`, `pluginId`, `presetId: "protocol"`, `models`. Each model binds `protocolPlugin` and a `protocolModes` map from mode ID to operation ID. Its `modes` store capability overrides only. Keys stay in local settings and never belong in packages.
- `engine: "module"` plus `runtime/index.mjs`: optional bundled ES module for nonstandard services. Dependencies must be bundled; `node_modules`, symlinks and hidden files are rejected.

旧版包含 `providers` 预设的包仍可读取，供旧连接和历史任务兼容。新插件使用协议格式，可通过 `defaultConnections` 携带连接与模型初始预设；运行时的连接和用户修改独立保存，密钥不进入插件包。

Legacy packages containing provider presets remain readable for saved connections and tasks. New packages use the protocol format and may include initial connection/model presets in `defaultConnections`. Runtime connections and user edits are stored separately; packages never contain credentials.

兼容范围使用 Rust semver 形式，例如 `>=0.9.1, <1.0.0`。包内路径不能越界；压缩包最多 256 个文件、20 MiB，展开最多 40 MiB。同一插件版本内容不可变，修改内容必须升版本。

Use Rust-style semver ranges such as `>=0.9.1, <1.0.0`. Archive paths cannot escape the package. Packages allow up to 256 files, 20 MiB compressed and 40 MiB expanded. A published version is immutable; change its version when changing contents.

```sh
npm run plugin -- validate plugin-packages/examples/openai-compatible
npm run plugin -- pack plugin-packages/examples/openai-compatible /tmp/example.shotloom-plugin
npm run plugin -- pack plugin-packages/examples/async-module /tmp/async-example.shotloom-plugin
node plugin-packages/examples/mock-service.mjs
```

示例只访问 `127.0.0.1:19391` 的本地模拟服务，不产生付费调用。声明式示例展示可共用的文本协议；代码示例展示异步提交、查询和取消。`examples/*-connections.json` 展示独立连接数据，不打进插件包。

Examples only call the local mock service at `127.0.0.1:19391`, with no paid requests. The declarative example defines a reusable text protocol; the executable example demonstrates asynchronous submit, poll and cancel. `examples/*-connections.json` illustrates separate connection records and is not included in the package.

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

以下以 OpenAI Images 为例，从仓库根目录执行。当前包名为 `@shotloom/shotloom-plugin-openai-images`，需要拥有 npm 上 `@shotloom` 作用域的发布权限；如果使用自己的账号或组织，先修改插件 `package.json` 的 `name`，例如 `@your-scope/shotloom-plugin-openai-images`。包名必须遵守前述前缀规则，插件显示名称和 manifest 的稳定 ID 不需要跟着改。

The example below starts at the repository root. Publishing under `@shotloom` requires permission for that npm scope. Otherwise, change the package name to your own scope first. Keep the required name prefix; the display name and stable manifest ID do not need to change.

```sh
# 校验插件 / Validate the plugin
npm run plugin -- validate plugin-packages/defaults/protocol.openai.images

# 登录官方源，按提示完成认证 / Sign in and complete the requested authentication
npm login --registry=https://registry.npmjs.org/

cd plugin-packages/defaults/protocol.openai.images

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
npm view @shotloom/shotloom-plugin-openai-images version --registry=https://registry.npmjs.org/
```

随后在 Shotloom「插件市场」切到 npm 官方源搜索包名，或在「安装插件 → npm 包」中输入 `@shotloom/shotloom-plugin-openai-images@1.0.0`，检查后安装。搜索索引与国内镜像可能尚未同步；此时先用官方源按完整包名和固定版本验证。更新时同时递增 `package.json` 与 `manifest.json` 的版本，再重新校验、预览并发布；同一 npm 名称与版本不能重复发布不同内容。32 个默认插件各自是独立包，发布一个不会自动发布其他插件，也不会自动更新应用的离线发行包。

Then search the marketplace using the official npm source, or install the exact package/version directly. Search indexing and mirrors may lag; verify against the official source with an exact version first. For updates, increment both package and manifest versions, validate, inspect and publish again. Published name/version pairs cannot be reused for different contents. Each default plugin is a separate package; publishing one does not publish the others or update the application's offline distribution.

## 插件详情 / Plugin details

双击插件卡片打开详情；点击卡片上的设置按钮打开独立设置，两者没有互相切换入口。详情展示 README、作者/版本/许可证/主页、插件 ID、兼容版本、安装来源、执行方式、连接配置，以及每个操作的真实鉴权、同步/异步状态、创建/Agent/查询/结果/取消接口、参数类型/必填/默认值与输入输出契约。

Double-click a plugin card to open Details. The Settings button opens settings separately; neither dialog includes a switch to the other. Details display packaged documentation, identity and provenance, connection fields and real operation contracts, including endpoints, authentication, lifecycle and parameter requirements/defaults.

README 的 HTML 不执行；Markdown 表格、代码块和链接按文本安全展示。包内 Markdown 链接读取已安装版本中的文档，外部 HTTP(S) 链接由用户点击打开。插件没有 README 时仍可查看自动生成的契约详情。详情页不读取或展示已保存的 API Key。

Raw HTML is inert. Markdown tables, code blocks and links are rendered safely. Relative Markdown links read installed package documentation; external HTTP(S) links require a user click. Plugins without a README still show generated contract details. Saved API keys are never read or displayed by Details.


## 发行时默认安装 / Default installation in releases

所有默认插件的源码位于 `plugin-packages/defaults/<plugin-id>/`，发行目录只由 `plugin-packages/defaults/index.json` 登记包名，不复制模型定义。例如 OpenAI Images 位于 `plugin-packages/defaults/protocol.openai.images/`。每个包可独立校验、打包，也可以按前文的 npm 方式分发；仓库里的 npm 包名不表示已经发布到 registry。

Default plugin sources live in independent directories under `plugin-packages/defaults/`. The index lists package directories without duplicating model definitions. Packages can be independently validated, packed and published; repository package names do not establish npm publication.

```sh
npm run prepare:plugins
npm run plugin -- validate plugin-packages/defaults/protocol.openai.images
npm run plugin -- pack plugin-packages/defaults/protocol.openai.images /tmp/openai-images.shotloom-plugin
```

开发和构建入口会运行 `prepare:plugins`。它校验全部操作和预设，生成固定时间戳的 ZIP 与 SHA-256 索引，分别写入 `electron/resources/provider-plugins/` 和 `renderer/public/provider-plugins/`。这些是生成产物，不提交。桌面打包包含前者；启动时离线安装到用户目录，运行目录不导入任何内置厂商 JSON。

Development/build hooks prepare deterministic archives and a SHA-256 index for desktop resources and browser static assets. Generated artifacts are ignored by Git. Desktop releases carry the archives and install them offline into user storage. The application catalog imports no built-in provider JSON.

默认安装的插件可以卸载、停用、手动更新和回滚。再次启动只安装从未登记过的新包，已卸载记录和用户安装的版本优先，不会自动恢复或覆盖。同一版本仍不得修改内容；发布变更请升版本。`defaultConnections` 只在首次安装该插件时填充，重新启动不改写模型能力；旧用户已有连接在首次迁移时完整保留。历史凭据和包文件继续保留，支持旧任务查询。

Preinstalled packages are removable, disableable and manually updateable/rollbackable. Startup installs only previously unregistered package IDs; removed records and user-installed versions win. Published versions remain immutable. `defaultConnections` seeds a new package once; restart never resets model edits. Migration preserves saved connections, credentials and historical artifacts for existing tasks.

RunningHub 的上传、工作流和轮询代码也在其插件的 `runtime/` 中，由通用模块宿主执行。发行资源中的代码随应用受信任；另外安装的代码仍需要用户明确确认信任。浏览器可以查看目录和文档，不能执行 Node 插件。

RunningHub's upload, workflow and polling code lives in its package runtime and uses the generic module host. Release-shipped code is trusted with the application; separately installed executable code still requires explicit trust. Browser preview can display packages and documentation but cannot execute Node plugins.

## 插件市场 / Plugin marketplace

分类栏的「插件市场」默认进入 npm 社区搜索，仅展示包名符合 `shotloom-plugin-xxx` 或 `@scope/shotloom-plugin-xxx` 的结果。支持搜索、分页和安装前检查；搜索结果不代表已验证的兼容插件。下载源可选择默认的 npmmirror 或 npm 官方源，搜索、版本解析和安装使用同一个选定源。市场不维护内置推荐清单，也不会自动安装搜索结果。

The marketplace opens npm community search by default and filters package names to the Shotloom plugin naming convention. It supports pagination and package inspection before installation. Choose npmmirror (default) or the official npm registry for search and installation. Search results are not compatibility endorsements.
