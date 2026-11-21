# Shotloom 工程约定

本文收录只对开发者有意义的实现约定。`AGENTS.md` 只保留 Agent 行为规则，因为它会被拼进每个模型的系统提示词；这里的内容不会注入模型，改动前请先读本文。

## 状态引擎

`renderer/src/store/domainReactivity.ts` 与 zustand 各自只服务一类状态，新增第三种引擎必须先改这份契约：

- 领域与持久状态（工程、节点、任务、设置、Skill、模板、素材库）只用 domainReactivity：状态对象就地可变，改动合并成一次 revision 通知，界面用 `useSyncExternalStore(subscribeDomain, getDomainRevision)` 订阅。画布写入量密集，改成不可变快照会付出无收益的复制成本。
- 界面状态（窗口、浮层、会话运行态）只用 zustand，并且只允许出现在 `app/` 与 `vendor/`。`store/`、`services/`、`agent/`、`domain/` 里出现 zustand 依赖即视为把领域状态搬进界面引擎。
- 唯一登记例外：`store/notificationStore.ts`。提示条必须能被数据层触发，所以它住在 store 层，但仍然是界面状态。
- `app/store/` 不得引入 domainReactivity；`store/` 下的纯函数模块（节点、边、步骤等图数据访问器）不携带引擎，只读写 projectStore 的同一份可变对象。
- 以上边界由 `scripts/verify-module-discipline.mjs` 检查（`npm run check:layers`）。新增例外必须在该脚本的集合里显式登记并说明理由。

## 第三方源码目录

第三方源码统一放在项目根目录 `vendor/`：OpenReel 位于 `vendor/openreel/`，世界引擎（open-ai-canvas 性能预演工作台）位于 `vendor/canvas-previs/`，固定在 open-ai-canvas `0dcf3f6` 快照并记录于该目录 README。不要在 `renderer/src` 下再建 vendor。世界引擎单独编译到 `renderer/public/previs-world-app/`，只通过 iframe 运行；产品通过 `app/adapters/previsBridge.ts` 的 postMessage 协议交互，不直接导入其运行时状态。根 `npm run typecheck` 同时检查产品与世界引擎，模块分层检查也覆盖这份 vendored 源码。

世界引擎的文档是一份纯 JSON 场景（`PrevisScene`）：镜头、机位、灯光、天空/天气/地面和关键帧都在其中，产品只保存与转交，不解释渲染。画布节点、整页工作区与后台恢复共用同一份协议；节点数据存在 `directorData.scene`（沿用历史字段名以兼容既有工程），节点类型标识仍为 `threeDDirector`。

引擎通过 `ready` 握手、`scene-changed` 同步每次提交后的完整场景，节点据此保存并驱动卡片；`captures` 回写构图/深度/法线/骨骼截图与白膜/深度视频，宿主用 `nodeActions.exportDirectorAsset` 落成节点；`add-canvas` 添加单张截图，`add-prompt` 添加上游编译的镜头提示词，`flush` 请求实际保存。操作携带 requestId，宿主完成后用 `result` 确认成功或报告错误，工作台不能在文件或节点创建前宣称交付成功。构图/白膜截图同时建立带截图输入和上游镜头提示词的视频生成节点。宿主通过 `init`、`scene`、`images` 下发数据，同 ID 的外部修订会更新打开的工作台，图片更新不重新采用旧场景。导出媒体不携带应用猜测的景别或剧情，模型需要据此编写下游提示词时必须自己读取真实画面。

画布节点卡片用上游的 PREVIS 布局：场景有对象时，嵌入 `card.html` 的迷你俯视视口（场景通过 `shotloom:previs-card` 下发，iframe 只渲染缩略图并禁用指针事件，点击仍由卡片打开工作台）；没有对象时显示「尚未生成预览」。这样卡片外观与参考项目一致，也不需要把 vendored 渲染器导入产品模块。

世界引擎的 3D 素材库属于引擎自身：导入的 glb/gltf 与截图产物写进 iframe 内的 IndexedDB（`host/files.ts`），场景文档只存 storageKey，因此仍是可移植的 JSON。引擎自带的程序化布景、天气与天空不依赖联网，也不需要 Polyfork 或云端登录；历史导演台的 Polyfork 在线模型服务随旧引擎一并移除。

上游人偶模型与 CC0 许可证随独立引擎发行，资源路径相对于 iframe。视频使用上游 FFmpeg.wasm 转码逻辑，worker、JS 和 WASM 均打入产物，按需加载，不依赖 CDN；白膜/深度视频输出真实 MP4，按镜头帧率和时长处理。底层存储写入失败必须报错，不能用仅当次会话有效的 blob URL 冒充持久素材。

## 官方 Harness 客户端隔离

Agent Host 发行资源由 `scripts/prepare-harness.mjs` 在临时目录准备后原子替换。依赖按锁文件中的 `dev` 标记排除纯开发包及其命令入口，保留生产依赖和许可证；不复制依赖的 JS 源码映射、类型声明及其他平台的 node-pty 预编译文件。只精简发行副本，不修改开发依赖目录；变更后运行资源装配测试和 `npm run harness:verify-package`。

`harness/host/client/` 直接复用官方 Harness 的 UI、状态、投影与 React 依赖，以 App 级单例运行时在 Shotloom 页面内挂载，使用 ShadowRoot 隔离样式，不使用 iframe。它不接管 Shotloom 领域状态，不导入 renderer/store，不将官方状态引擎扩散到产品模块。桌面客户端通过原生 IPC 与父进程私有管道连接 Host，不使用 Cookie 登录或浏览器认证跳转；原生调用边界、项目绑定、Tool Bridge 和工具权限校验继续生效。切换项目只切换会话，工具、Skill、模型配置内容未变时不得重复复制或挂载。产品导航和画布引用通过显式适配接口协作；renderer 内仍严格遵守以上两类状态引擎约定。

## Agent 工具的暴露与可见性

Agent 模型请求由官方 `dsh-llm-pi-ai` 适配器序列化。连接级 `providerConfigs.cacheRetention` 只保存 `short` / `long`；省略表示适配器默认值，不能把省略或 `none` 宣称为关闭服务端自动缓存。长期保留需要渠道和模型支持；OpenAI Responses 由适配器映射为 `prompt_cache_retention: "24h"`。会话 ID、缓存键及缓存 token 回执继续交给官方插件处理。聊天顶部的用量明细开关复用官方 `performance-usage` 设置，展示官方每轮及会话用量，不另建统计状态或推测命中。

工具可见性有四层判定，全部在 `renderer/src/agent/core/visibility.ts` 与 `renderer/src/services/harnessProductTools.ts` 里实现：

1. `agent/agents/definitions.ts` 的 tools 白名单（fail-closed，新工具默认对所有 Agent 不可见）。
2. 同一份定义的 effects 上限。
3. 工具自身的 `isAvailable`（用户设置、工作区状态）。
4. Skill 命名空间工具需对应 SKILL.md 已加载。

剪辑 Agent 的原生工具共 309 个，全量 schema 约 4.8 万 token。因此 `core/openReelTools.ts` 维护一个核心集常驻上下文，其余由 `editor_find_tools` 按关键词在会话内解锁。新增原生工具时默认不进入核心集；只有基础剪辑轮次真正需要的能力才加进 `EDITOR_CORE_TOOL_NAMES`。

`tests/agent-prompt-tool-references.test.mjs` 会校验提示词、契约与 Skill 里引用的工具名是否真实存在。改动提示词时先跑它。

## 厂商插件与内部协议

厂商模型、工具能力、内部请求协议和默认连接只存在于 `plugin-packages/` 下的独立包中。默认发行包位于 `plugin-packages/defaults/<plugin-id>/`；StarRouter 位于 `plugin-packages/vendor.starrouter/`，通过 npm 按需安装，不登记进默认发行索引。每个目录提供 `manifest.json`、npm `package.json`、README，以及可选的 `runtime/`。`scripts/prepare-provider-plugins.mjs` 校验并生成可重复构建的 `.shotloom-plugin` 包与 SHA-256 索引，输出到桌面资源和浏览器静态资源；不要再向 renderer 配置目录增加厂商清单。`shotloom.yml` 的默认模型在构建时对照这些包校验。

应用的运行目录只读取已安装插件和用户连接，初始为空。桌面版在首次读取目录时把发行资源中的缺失包安装到用户插件存储；浏览器预览安装同源静态包，代码插件执行仍需桌面宿主。默认包遵守同一份身份、版本不可变、文件检查、历史版本和回滚规则；发行包中的代码随应用发行受信任，用户另外安装的代码仍需显式信任。记录已卸载的包，重启或再次分发相同 ID 时不得自动恢复或覆盖用户安装版本。

`vendorMigration` 仅对发行来源生效，合并旧连接与工具条入口；旧包和 `legacyConnections` 保留给已冻结任务，凭据与目录迁移在同一 SQLite 事务内保存。`defaultConnections` 只在新插件安装时填充模型与连接预设，用户的地址、Key、参数覆盖和显式删除不会在每次启动时被重置。首次从旧内置目录迁移时，已保存的连接完整优先；旧禁用标记只迁移一次。历史任务通过冻结的操作契约和插件历史版本恢复；旧适配器身份通过包内 `legacyProviders` 的显式元数据兼容，不再加载旧厂商模型目录。历史目录只作为 `tests/fixtures/legacy-model-catalog/` 中的迁移证据，不进入发行包。

`domain/provider/plugins/ProviderPlugins.ts` 统一装配目录；任务保存实际插件 ID、版本和操作契约。每个厂商包使用 `kind: vendor`，普通模型和画布工具共用连接；模型只引用本包内部操作。连接只能覆盖模型能力参数，不能覆盖传输字段。旧协议包仅供迁移和历史任务恢复，不进入默认界面目录。插件多语言词条由包内 `manifest.i18n.messages` 提供，按插件作用域解析展示字段，不能依赖应用语言表新增厂商词条。Key 只存用户设置。包经 `electron/core/plugins.ts` 检查、解包和持久化，代码由独立 Node 进程执行。代码插件不是权限沙箱，不得宣称隔离了文件或网络权限。

插件开发、打包与索引格式见 [provider-plugins.md](./provider-plugins.md)。

媒体协议的路径占位符、独立结果查询、远程取消和缺省状态约束见 [媒体协议接入](./media-protocols.md)。这些是厂商传输契约，不用于推断 Agent 的制作意图或工作流。

## 桌面签名与测试版本

macOS 试包也必须有完整签名：`electron-package.mjs` 使用 `CSC_NAME` 指定的证书，未配置时显式使用 `-` 做临时签名；关闭证书自动发现不能代替签名。发行流程对所有 Mac 包执行深度严格签名验证。临时签名不等于 Developer ID 签名或 Apple 公证，不能宣称已通过 Gatekeeper 的分发信任检查。

插件兼容范围在 renderer 与 Electron 中均使用 semver 的 `includePrerelease` 选项，使兼容范围内的 `0.9.2-testxxxx` 等测试版本可加载插件；仍须保留范围上下界校验。

## 项目资产的所有权与自动清理

新媒体写入当前项目的 `assets/`，不再优先写入旧的 library/series 共享目录。通用资产库保留全局原件，加入项目或拖入画布时复制一份；同项目重复使用复用项目副本。新文件记录的 `projectAssetOwnerId` 标识所有者，项目副本不再发布到旧的跨画布共享清单。

删除节点后，把关联的项目文件登记到持久化的 `pendingAssetCleanup`。最后一个当前引用消失时移除素材与项目资产条目；撤销恢复节点时自动恢复条目。项目保存成功后才检查清理队列：其他节点、任务、剪辑、世界引擎场景文档、画布撤销/重做、历史版本、剪辑器独立数据库记录与未保存草稿均保护文件。确认无引用才移入系统回收站；读取失败、项目切换或回收失败均保留文件，后续保存自动重查。清理队列不进入历史版本，避免恢复旧版本时重新执行旧清理任务。

旧的共享引用和外部文件缺少项目独占所有权，不自动删除。原生清理还校验真实文件路径在当前项目 `assets/` 内，拒绝越界路径及通过符号链接指向外部的文件。

## Electron 数据存储

Electron 使用 Drizzle 表模型和领域 CRUD（`core/schema.ts`、`core/storage.ts`、`core/projectStorage.ts`），与 Harness 保持同一 ORM。业务读写不得拼接 SQL、表名或列名，也不得直接调用原生 prepare/exec。`core/sqliteOrm.ts` 适配 Electron 内置 node:sqlite，负责执行 ORM 生成的参数化查询；`core/db.ts` 管理连接和在线备份；固定的 DDL 与旧版本升级集中在 `core/migrations.ts`。保留既有表名、列名、JSON 编码与数据库版本，兼容 Tauri 数据文件。迁移和项目多表写入必须在同一事务中完成。
