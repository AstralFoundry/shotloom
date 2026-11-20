# Shotloom 工程约定

本文收录只对开发者有意义的实现约定。`AGENTS.md` 只保留 Agent 行为规则，因为它会被拼进每个模型的系统提示词；这里的内容不会注入模型，改动前请先读本文。

## 开发分支

云端、Tauri 桌面和 React Native App 的日常开发统一提交到 `AstralFoundry/shotloom` 的 `supabase` 分支，功能分支以它为基线，PR 目标也选 `supabase`。上游 `main` 保留独立的 Electron 架构。

## 状态引擎

`renderer/src/store/domainReactivity.ts` 与 zustand 各自只服务一类状态，新增第三种引擎必须先改这份契约：

- 领域与持久状态（工程、节点、任务、设置、Skill、模板、素材库）只用 domainReactivity：状态对象就地可变，改动合并成一次 revision 通知，界面用 `useSyncExternalStore(subscribeDomain, getDomainRevision)` 订阅。画布写入量密集，改成不可变快照会付出无收益的复制成本。
- 界面状态（窗口、浮层、会话运行态）只用 zustand，并且只允许出现在 `app/` 与 `vendor/`。`store/`、`services/`、`agent/`、`domain/` 里出现 zustand 依赖即视为把领域状态搬进界面引擎。
- 唯一登记例外：`store/notificationStore.ts`。提示条必须能被数据层触发，所以它住在 store 层，但仍然是界面状态。
- `app/store/` 不得引入 domainReactivity；`store/` 下的纯函数模块（节点、边、步骤等图数据访问器）不携带引擎，只读写 projectStore 的同一份可变对象。
- 以上边界由 `scripts/verify-module-discipline.mjs` 检查（`npm run check:layers`）。新增例外必须在该脚本的集合里显式登记并说明理由。

## 原生移动端

React Native 预览客户端采用独立 npm 安装，复用 shared 中的纯接口类型、请求边界与产品文案。服务端仍是反馈、回复和站内通知的持久事实来源；原生 React 状态保存页面投影和未提交输入，不引入新的领域状态引擎。原生导航和表单不依赖 renderer 的 DOM、桌面 IPC 或桌面运行时。

原生登录首页使用 React Native 组件，通过系统浏览器完成现有 Supabase / new-api 授权；App 使用 PKCE 与 state 绑定的短时一次性交接码换取 Shotloom 会话凭据，保存在系统安全存储。OAuth token 仍仅留在服务端。原生页面直接请求受限用户接口，服务端校验原生凭据的用途、有效期与接口允许列表，不开放任意 URL、管理操作或模型调用。复杂工作区继续使用无原生工具桥的独立 WebView，通过一次性 POST 交接码建立 HttpOnly Cookie；同账号重新授权时在原文档内更新 Cookie，保留未保存画布状态。旧 `/native` 桥接保留以兼容已发布客户端。预览客户端和 Tauri 正式移动包分开构建，在真机验收完成前不替换正式发布链路。

## 第三方源码目录

第三方源码统一放在项目根目录 `vendor/`：OpenReel 位于 `vendor/openreel/`，三维导演台位于 `vendor/shotloom-director-desk/`（从 AstralFoundry/shotloom-director-desk 引入）。旧版导演台源码可从 Git 历史回溯，不作为运行入口。不要在 `renderer/src` 下再建 vendor。新导演台单独编译到 `renderer/public/director-desk-app/`，只通过 iframe 运行；产品通过 `app/adapters/directorDeskBridge.ts` 的 postMessage 协议交互，不直接导入其运行时状态。根 `npm run typecheck` 同时检查产品与导演台，模块分层检查也覆盖导演台源码。

导演台 `revision` 是 iframe 会话内计数；批量写入必须同时携带快照的 `sessionId`（`expectedSessionId`）和 `revision`（`expectedRevision`）。重复 ready/load 初始化必须幂等，不能重新载入旧文档。冲突回执附带最近 32 个版本范围内的 `revisionDiff`；缓存缺失时明确标记不完整。`autoPreview` 在写入成功后取帧，预览失败保留 `applied: true`，避免调用方重复应用批次。导出媒体的 `directorContext` 只保存导出时的工程事实，并随素材和画布节点传递；由模型根据这些事实与真实画面编写下游提示词，应用不猜测景别、剧情或内容质量。

导演台批量 `patch` 在产品工具 schema 中声明实际字段类型，覆盖数值/动画、向量、灯具、机位与素材参数；执行器继续负责按操作的字段白名单、真实范围与跨字段完整性。通用工具入口执行数值有限性、minimum/maximum 及动态字段的子 schema。执行器拒绝时返回 `receivedEdit`，保留失败项的实际 JSON 类型，避免将字符串数字或嵌套向量误诊为 AnimatedNumber 不接受数值。真实 Chrome Worker 回环测试验证数值、关键帧、向量与布尔值不会在传输中被改型。

导演台资产侧栏通过现有云端 `/api/polyfork/` 搜索和下载模型，保留宿主传入的接口地址与登录校验。下载成功后写入同源 IndexedDB，「本地 → 已下载」可离线复用；目录与模型文件分别存储，缩略图仅在进入视口时加载。场景与下载 ZIP 保留逐模型署名和许可，工程保存独立资源副本，重开时先准备模型再载入场景。

## 官方 Harness 客户端隔离

导演台 `director-desk-staging` Skill v2 吸收自 `vvicat-ai-short-studio` 的 `integrate/browser-dsh-staging-20261120`（`eeacfeb7b91d4053de9c85c47f60d13f0bc3b5d0`）：`director-desk-craft.md`、`professional-directing.md`、`director-composition.md` 与 `shot-transitions.md`。镜头设计、相机动作优先级和六类案例按需读取；保留 Shotloom 的批量工具、会话基线与真实预览合同，不迁入源项目 CLI、整文档替换或人工导出限制。目录 `batchOperations` 来自批量执行器的实际字段表，光影范围与数值动画示例随目录返回；非法参数回执带具体项和真实合同，整批仍由副本预检后原子提交。

`harness/host/client/` 直接复用官方 Harness 的 UI、状态、投影与 React 依赖，以 App 级单例在 Shotloom 页面内挂载，使用 ShadowRoot 隔离样式，不使用 iframe。它不接管 Shotloom 领域状态，不导入 renderer/store，不将官方状态引擎扩散到产品模块。

Web、桌面和移动 WebView 的 Agent 循环统一运行于 Dedicated Worker；`harness/host/browser/` 复用现有角色、Skill、审批、工具装配与持久层合同。工程切换、关页与登录失效销毁 Worker；收起面板继续运行。IndexedDB 按账号和工程隔离本地会话、事件、附件、设置与业务回执，Web Locks 保证同工程只有一个窗口持有写入权。模型或产品工具调用前必须等待持久化屏障；失败停止执行，结果未知的写入不能自动重放。恢复历史不会自动续跑，需用户发送消息或继续目标。

服务器仅通过 `/api/agent/model` 转换单次模型请求，复用登录、发布模型与协议校验，凭据和供应商地址不返回客户端；不创建 Agent Host 或持久化聊天。产品工具仍在 renderer 的真实绑定、项目代际、节点存在性和用户设置边界内执行。`prepare:harness` 生成聊天 UI 和 Worker 镜像，桌面不再打包 Node Agent Host。旧 SQLite/云端历史保留，切换本地会话时保留 `legacyHarnessSessionId`，不自动迁移。详细实现与验证见 [客户端 Worker](features/agent-client-worker.md)。

## 生产发布与流式连接

短剧流程参考同一源分支 `eeacfeb7b91d4053de9c85c47f60d13f0bc3b5d0` 的 `short-drama`：导演本、制作计划、声音设计、恢复与剪辑交付方法，汇入 `video-production/references/drama-production-handoffs.md` 及现有剧本生视频、剪辑 Skill。保留场次意图到逐镜验收、受影响依赖复核、未知提交先查原任务、原声复用与最终声轨字幕；不迁入固定九阶段门禁、版本账本服务、厂商特例或 Remotion 专用工具。

`mail` 上发布必须先启动并验证独立候选容器，再用 `scripts/activate-production.sh <release目录> <候选容器名> <候选端口>` 切换。脚本先重载 nginx，让新请求进入候选，等待旧 nginx worker 退出、已有模型流完成后才重建正式容器；正式容器验证通过后切回，再排空候选连接。排空超时保留两个容器，不强制终止流。不要在用户使用时直接 `compose up --force-recreate` 替换正在接流量的容器。

发布目录需包含源码和构建产物 `build/`、`revision`、`release.before`、`previous-image.txt`、`image.txt`、`compose.production.yaml`、候选验证结果 `candidate-smoke.json` 与可运行的 `smoke.mjs`。脚本校验旧版本和镜像身份，保留旧 hash 静态资源并记录 nginx/Compose 配置备份。服务端收到停止信号后等待现有响应结束，Compose 提供 16 分钟退出宽限期；不自动重放模型或付费工具调用。

## Agent 工具的暴露与可见性

工具可见性有四层判定，全部在 `renderer/src/agent/core/visibility.ts` 与 `renderer/src/services/harnessProductTools.ts` 里实现：

1. `agent/agents/definitions.ts` 的 tools 白名单（fail-closed，新工具默认对所有 Agent 不可见）。
2. 同一份定义的 effects 上限。
3. 工具自身的 `isAvailable`（用户设置、工作区状态）。
4. Skill 命名空间工具需对应 SKILL.md 已加载。

剪辑 Agent 的原生工具共 309 个，全量 schema 约 4.8 万 token。因此 `core/openReelTools.ts` 维护一个核心集常驻上下文，其余由 `editor_find_tools` 按关键词在会话内解锁。新增原生工具时默认不进入核心集；只有基础剪辑轮次真正需要的能力才加进 `EDITOR_CORE_TOOL_NAMES`。

`tests/agent-prompt-tool-references.test.mjs` 会校验提示词、契约与 Skill 里引用的工具名是否真实存在，并校验导演台命令表每条命令都有参数契约。改动提示词时先跑它。
