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

第三方源码统一放在项目根目录 `vendor/`：OpenReel 位于 `vendor/openreel/`，三维导演台位于 `vendor/shotloom-director-desk/`（从 AstralFoundry/shotloom-director-desk 引入）。旧版导演台源码可从 Git 历史回溯，不作为运行入口。不要在 `renderer/src` 下再建 vendor。新导演台单独编译到 `renderer/public/director-desk-app/`，只通过 iframe 运行；产品通过 `app/adapters/directorDeskBridge.ts` 的 postMessage 协议交互，不直接导入其运行时状态。根 `npm run typecheck` 同时检查产品与导演台，模块分层检查也覆盖导演台源码。

导演台 `revision` 是 iframe 会话内计数；批量写入必须同时携带快照的 `sessionId`（`expectedSessionId`）和 `revision`（`expectedRevision`）。重复 ready/load 初始化必须幂等，不能重新载入旧文档。冲突回执附带最近 32 个版本范围内的 `revisionDiff`；缓存缺失时明确标记不完整。`autoPreview` 在写入成功后取帧，预览失败保留 `applied: true`，避免调用方重复应用批次。导出媒体的 `directorContext` 只保存导出时的工程事实，并随素材和画布节点传递；由模型根据这些事实与真实画面编写下游提示词，应用不猜测景别、剧情或内容质量。

## 官方 Harness 客户端隔离

`harness/host/client/` 直接复用官方 Harness 的 UI、状态、投影与 React 依赖，以 App 级单例运行时在 Shotloom 页面内挂载，使用 ShadowRoot 隔离样式，不使用 iframe。它不接管 Shotloom 领域状态，不导入 renderer/store，不将官方状态引擎扩散到产品模块。桌面客户端通过原生 IPC 与父进程私有管道连接 Host，不使用 Cookie 登录或浏览器认证跳转；原生调用边界、项目绑定、Tool Bridge 和工具权限校验继续生效。切换项目只切换会话，工具、Skill、模型配置内容未变时不得重复复制或挂载。产品导航和画布引用通过显式适配接口协作；renderer 内仍严格遵守以上两类状态引擎约定。

## Agent 工具的暴露与可见性

工具可见性有四层判定，全部在 `renderer/src/agent/core/visibility.ts` 与 `renderer/src/services/harnessProductTools.ts` 里实现：

1. `agent/agents/definitions.ts` 的 tools 白名单（fail-closed，新工具默认对所有 Agent 不可见）。
2. 同一份定义的 effects 上限。
3. 工具自身的 `isAvailable`（用户设置、工作区状态）。
4. Skill 命名空间工具需对应 SKILL.md 已加载。

剪辑 Agent 的原生工具共 309 个，全量 schema 约 4.8 万 token。因此 `core/openReelTools.ts` 维护一个核心集常驻上下文，其余由 `editor_find_tools` 按关键词在会话内解锁。新增原生工具时默认不进入核心集；只有基础剪辑轮次真正需要的能力才加进 `EDITOR_CORE_TOOL_NAMES`。

`tests/agent-prompt-tool-references.test.mjs` 会校验提示词、契约与 Skill 里引用的工具名是否真实存在，并校验导演台命令表每条命令都有参数契约。改动提示词时先跑它。

## 协议插件与厂商连接

协议、模型预设和厂商默认连接只存在于 `plugin-packages/defaults/<plugin-id>/` 的独立包中。每个目录提供 `manifest.json`、npm `package.json`、README，以及可选的 `runtime/`。`scripts/prepare-provider-plugins.mjs` 校验并生成可重复构建的 `.shotloom-plugin` 包与 SHA-256 索引，输出到桌面资源和浏览器静态资源；不要再向 renderer 配置目录增加厂商清单。`shotloom.yml` 的默认模型在构建时对照这些包校验。

应用的运行目录只读取已安装插件和用户连接，初始为空。桌面版在首次读取目录时把发行资源中的缺失包安装到用户插件存储；浏览器预览安装同源静态包，代码插件执行仍需桌面宿主。默认包遵守同一份身份、版本不可变、文件检查、历史版本和回滚规则；发行包中的代码随应用发行受信任，用户另外安装的代码仍需显式信任。记录已卸载的包，重启或再次分发相同 ID 时不得自动恢复或覆盖用户安装版本。

`defaultConnections` 只在新插件安装时填充模型与连接预设，用户的地址、Key、参数覆盖和显式删除不会在每次启动时被重置。首次从旧内置目录迁移时，已保存的连接完整优先；旧禁用标记只迁移一次。历史任务通过冻结的操作契约和插件历史版本恢复；旧适配器身份通过包内 `legacyProviders` 的显式元数据兼容，不再加载旧厂商模型目录。历史目录只作为 `tests/fixtures/legacy-model-catalog/` 中的迁移证据，不进入发行包。

`domain/provider/plugins/ProviderPlugins.ts` 统一装配目录；任务保存实际插件 ID、版本和操作契约。协议的传输字段不允许被连接能力覆盖。Key 只存用户设置。包经 `commands/provider_plugins.rs` 检查、解包和持久化，代码由独立 Node 进程执行。代码插件不是权限沙箱，不得宣称隔离了文件或网络权限。

插件开发、打包与索引格式见 [provider-plugins.md](./provider-plugins.md)。

媒体协议的路径占位符、独立结果查询、远程取消和缺省状态约束见 [媒体协议接入](./media-protocols.md)。这些是厂商传输契约，不用于推断 Agent 的制作意图或工作流。
