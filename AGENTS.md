# Shotloom Agent Engineering Guide

## 核心原则

Shotloom 的 Agent 以模型为决策主体。不要在应用代码中用关键词、正则、文本长度、数量阈值或枚举穷举去猜测用户意图、制作范围、任务复杂度和内容质量。

- 模型负责理解用户完整语义、选择工作流、拆分任务、规划依赖、判断是否需要追问，以及评估交付是否充分。
- 用户表达明确时直接继续，不得因为缺少某个内部状态字段而重复询问。
- 用户表达确实会导致多个显著不同结果时，由 Router 使用 question 工具集中澄清。
- Prompt、Skill、Contract 和 AGENTS.md 用来约束 Agent 的工作方式；不要把开放式工作流要求改写成阻塞所有工具的代码门禁。
- 工具回执应把可恢复的问题返回给 Agent，让 Agent 修正后继续；不要因一个可修复的规划瑕疵让整轮运行失败。

## 代码应该强制的边界

代码只强制执行无法安全交给模型自行保证的客观边界：

- 权限与用户设置，例如关闭“允许 Agent 运行节点”后不得启动生成。
- 付费、删除、覆盖、外部发送等不可逆或有成本的操作边界。
- 数据真实性，例如节点、任务、文件和工具回执是否真实存在。
- 数据存储的基本完整性，例如目标记录存在、标识可稳定引用、写入结构可以持久化。
- 完成声明必须有真实结果或成功工具回执支持。

这些校验应尽量返回具体、可操作的信息。可以安全修复的数据应规范化并附带 warning，不应直接终止 Agent。

## 代码不应该强制的判断

以下内容属于 Agent 的认知和制作职责，默认不得写成硬编码门禁：

- 根据用户文字判断“只规划”“规划并执行”“分析”或其他意图。
- 根据文本长度、时码数量或节点数量判断是否必须创建计划。
- 强制一个时间段对应一个视频节点、一个文本节点不能代表若干工作项等制作质量规则。
- 强制工作项数量、阶段数量、镜头数量或固定拆分粒度。
- 因规划依赖写错、提示词暂缺或后续阶段尚未展开而拒绝保存整个计划。
- 在用户已经明确要求后，仍要求先回答内部的 production scope 或 capability 问题。

这类问题应在 Agent Contract 中说明目标和质量标准，由模型根据实际内容处理，并在工具回执出现 warning 时自行修正。

## 分层约定

- Router：理解用户意图，选择工作流，必要时提问。
- Planner：形成可调整的计划和工作项，不拥有执行权限。
- Executor：通过真实画布工具实施计划，遵守用户设置和工具权限。
- Reviewer：依据真实节点、任务、文件和回执核验结果。
- Runtime/Store：传递状态并保存事实，不替 Router 或 Planner 做语义判断。

保持分层清晰，但不要为了分层创建只有几行转发逻辑的文件或函数。优先让一个模块完整拥有一项职责。

## 状态引擎

`renderer/src/store/domainReactivity.ts` 与 zustand 各自只服务一类状态，新增第三种引擎必须先改这份契约：

- 领域与持久状态（工程、节点、任务、设置、Skill、模板、素材库）只用 domainReactivity：状态对象就地可变，改动合并成一次 revision 通知，界面用 `useSyncExternalStore(subscribeDomain, getDomainRevision)` 订阅。画布写入量密集，改成不可变快照会付出无收益的复制成本。
- 界面状态（窗口、浮层、会话运行态）只用 zustand，并且只允许出现在 `app/` 与 `vendor/`。`store/`、`services/`、`agent/`、`domain/` 里出现 zustand 依赖即视为把领域状态搬进界面引擎。
- 唯一登记例外：`store/notificationStore.ts`。提示条必须能被数据层触发，所以它住在 store 层，但仍然是界面状态。
- `app/store/` 不得引入 domainReactivity；`store/` 下的纯函数模块（节点、边、步骤等图数据访问器）不携带引擎，只读写 projectStore 的同一份可变对象。
- 以上边界由 `scripts/verify-module-discipline.mjs` 检查（`npm run check:layers`）。新增例外必须在该脚本的集合里显式登记并说明理由。

## 第三方源码目录

第三方源码统一放在项目根目录 `vendor/`：OpenReel 位于 `vendor/openreel/`，三维导演台位于 `vendor/storyai-3d-director-desk/`。不要在 `renderer/src` 下再建 vendor。导演台仍只通过独立 HTML 入口和 iframe 运行，产品通过 `app/adapters/directorDeskBridge.ts` 的 postMessage 协议交互，不直接导入其运行时状态。导演台源码继续纳入根 TypeScript 和模块分层检查。导演台可复用不持有状态的产品 i18n 字典；不得因此导入产品 Store 或服务。

## 官方 Harness 客户端隔离

`harness/host/client/` 使用官方 Harness 自有的状态、投影与 React 依赖，只在独立 iframe 文档内运行。它不接管 Shotloom 领域状态，不导入 renderer/store，不将官方状态引擎扩散到产品模块。产品只通过受认证的 Host、Tool Bridge 和来源校验的工作台导航消息与其协作；renderer 内仍严格遵守以上两类状态引擎约定。
