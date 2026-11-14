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
