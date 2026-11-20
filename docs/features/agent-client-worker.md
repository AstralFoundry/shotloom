# Agent 客户端 Worker

开发 worktree：`shotloom-agent-client-20261120`，分支 `codex/agent-client-20261120`，从 `supabase` 的 `f5b3b52779f5c29934f83f983b8bac8a1f3f59e8` 创建。

参考 `vvicat-ai-short-studio` 的 `integrate/browser-dsh-staging-20261120`，固定阅读提交 `eeacfeb7b91d4053de9c85c47f60d13f0bc3b5d0`。该实现将完整 Agent 循环放到浏览器 Dedicated Worker，使用官方 experimental runtime/packer；IndexedDB 保存运行状态，服务器仅保留一次模型推理与业务边界。参考实现的存储 sink、浏览器图片附件和 assert 兼容适配用于本项目的对应模块。

本项目沿用 DSH `0.2.1-alpha.2` 的循环、官方 UI 和同版 experimental runtime/packer，避免将客户端迁移与全套 DSH 升级混成一次改动。Zod 入口预打包解决官方加载器的循环求值；构建时核验所需内部导出，升级版本需重跑浏览器验证。

官方加载器默认以 `new Function` 包装模块。构建同时生成 `modules.mjs`，运行时只使用其中预编译的函数，缺失模块直接拒绝；不从本地状态加载可执行代码，不放宽产品 CSP。浏览器验证同时对文档和 Worker 施加现有生产 CSP。

## 运行边界

所有端使用 `renderer/src/services/browserHarnessTransport.ts`，无桌面或云端 Host 分流。现有角色提示词、契约、Skill、原生剪辑工具目录和产品工具校验保持复用。Worker 内的文件能力只访问自己的虚拟目录，不提供原生 Bash 或任意本机文件访问；媒体和剪辑工具仍通过现有产品 API 执行。

`harness/host/scripts/build-worker.mjs` 为现有 Host 装配生成浏览器镜像，把 SQLite CRUD 替换为本地文件后端、附件替换为浏览器解码、模型适配器替换为请求桥。模型循环、目标、提问、审批、子 Agent、投影、压缩与聊天 UI 继续由官方包提供。事件逐条存储，持久化只提交变动文件，不在附件上传时扫描并重写完整历史。

IndexedDB `shotloom-agent-worker-v1` 按账号及工程存放事件、checkpoint、附件、设置、Skill 和操作回执。同账号同工程的 Web Lock 覆盖所有角色，另一窗口会得到明确的占用错误。页面恢复仅展示历史，不调用模型或重放工具；用户发送消息或恢复目标后才允许该会话及其委派的子会话执行。

写工具发出前持久保存 `dispatching`，成功后保存 `settled`。原调用结果未知时返回 `TOOL_OUTCOME_UNKNOWN`，由模型读取真实项目和任务后决定恢复动作，不能用原标识重新提交。模型及工具外部副作用前等待会话 flush 和严格 IndexedDB 事务；存储失败销毁 Worker。工具已经发出时的中断无法撤回外部任务，回执用于后续核对。

旧服务器和桌面历史没有批量删除或自动迁移；旧 ID 保留为 `legacyHarnessSessionId`，本地绑定按工程、会话、角色和节点查找，不把其他设备写入工程的本地 ID 当作本机日志。清理站点数据会删除本机 Agent 历史。当前会话列表沿用工程中的会话条目，本地日志不跨设备同步。

## 服务端

`POST /api/agent/model` 只处理一次推理。Cookie/原生会话、账号绑定和已发布模型的协议路径仍按现有边界验证。供应商地址和 Key 由服务端决定，忽略客户端提交的地址、认证头和凭据引用。模型请求正文不进入 Agent 数据库，错误异常和错误结束事件统一脱敏。

模型推理使用现有 Shotloom 登录及模型网关。纯本地存储模式中的自定义直连供应商配置尚未适配这条服务端转发链路，不能据此宣称离线或自带 Key 模式已验收。原生平台还需要分别验证 Worker、Web Locks、OffscreenCanvas、可转移流及 CSP。

## 验证

```sh
npm run prepare:harness
npm run harness:verify-package
node --test tests/browser-agent-relay.test.mjs
node --test harness/host/test/browser-storage.test.mjs
npm run check
```

`harness:verify-package` 复用导演台已安装的 `playwright-core`，使用独立浏览器及本机临时 HTTP 端口验证官方 UI、真实 Worker、模型测试流、工具续轮、PNG 附件、本地落盘、刷新恢复和归档；不使用生产凭据或付费模型。CI 安装 Chromium，本机也可使用已安装的 Chrome。

本机验证结果：renderer、导演台、Host 和 server 类型检查及所有工程门禁通过；72 项相关回归测试、未打开工程的 Worker 归档测试和真实浏览器验证通过。全量根测试使用 `node --test --test-force-exit --test-timeout=45000 tests/*.test.mjs`，956 项中 949 通过，7 项失败（6 项站点样式令牌、1 项既有 Tauri/HTML CSP 不一致），均已在未修改的 `supabase` 工作区复现。`--test-force-exit` 用于退出原有 SSR 测试遗留句柄，未跳过测试。

Worker 镜像、OpenReel wasm 与嵌入式运行时、主应用 Vite 生产编译均通过。此 worktree 复用原目录依赖，标准 `npm run build` 在 pnpm 自动核验/重装共享 OpenReel 依赖时因无 TTY 中断，因此分别使用现有 npm 脚本完成 OpenReel 编译并运行 Vite；未对共享依赖强制重装。工作区日志位于 `output/agent-worker-*.log`（不提交）。

服务端在 CI 隔离配置下运行测试，45 项通过、4 项 live 用例跳过、0 失败；这组隔离测试未连接真实 Supabase 或付费模型。

旧 Host 测试在当前 Windows 环境有两项 Bash 用例因 Git Bash 的 signal pipe 创建失败而失败，已在未修改的 `supabase` 工作区复现。该问题不纳入本次迁移修复。打包桌面客户端和移动真机验收需另行执行。

### 真实模型验证（2026-11-21）

使用现有 QA 账号完成真实 Supabase OAuth 登录，在独立测试工程 `e15df6f6-915b-4c2c-85cb-f55eab60accd` 的生产构建页面，通过官方聊天 UI → Dedicated Worker → `/api/agent/model` → 实际上游调用 `MiniMax-M3.1-Flash`。请求要求仅返回一句话、不调用工具或生成素材；实际收到 `Worker 真实模型调用成功。`，流以 `finish.stop` 和 `done` 正常结束，耗时约 5.2 秒。上游报告 input 21958、output 9、cacheRead 128、total 22095 tokens（Agent 提示词与工具目录也进入上下文）。

实测修复了响应式 Proxy 无法通过 postMessage、通用已发布 Chat Completions 模板缺少 Agent 声明、面板早于模型配置加载，以及未知上下文窗口被错误包装为无效 context 元数据的问题。新增回归覆盖这些路径；renderer/server 类型检查、Worker 镜像与 Vite 编译、真实浏览器工具续轮测试通过。

测试工程最初显式关闭了自动保存，刷新后缺少工程中的会话索引；保留 Worker 日志，并将实际会话索引保存到该测试工程、启用自动保存后，刷新恢复相同回复与所选模型，资源记录中没有新增 `/api/agent/model` 请求。该验证以工程索引已保存为前提，不代表关闭自动保存后未保存的工程改动会自动恢复。

另一次 `glm-4.7-flash` 的真实调用失败，直接业务 relay 交叉请求也收到上游 HTTP 401“身份验证失败”；MiniMax 同账号成功，因此未把 GLM 通道标记为验收通过。截图及脱敏请求证据位于忽略目录 `output/agent-worker-live-{success,restored}.png`、`output/agent-worker-live-evidence.json`。

### 合并与生产部署（2026-11-21）

已合入并推送 `AstralFoundry/shotloom` 的 `supabase`，部署提交 `5cc1dc0d79b7a47fe088844e1accae70cb6e6865`。合并保留已发布的 RunningHub 模板和 Android 0.9.17 页面及原生修复。独立发布 worktree 为 `shotloom-supabase-release-20261121`，原开发目录不切换分支。

生产地址 `https://shotloom.0xfiang.com`，镜像 `shotloom:worker-5cc1dc0`，容器 `shotloom-app-1` 健康。候选及公网各 16 项检查通过，核对 HTML、Worker 镜像与模块、聊天 UI、入口脚本的 SHA256、脚本 MIME、重新验证缓存和未登录模型调用拒绝。合并后 29 项相关回归、4 项 Worker/真实浏览器测试、renderer/server 类型检查及工程门禁通过。

正式域名下通过 QA 账号和实际聊天 UI 调用 `MiniMax-M3.1-Flash`，约 7.6 秒返回 `Worker 部署验收成功。`，HTTP 200，`finish.stop`、`done: true`，无流错误；上游报告 input 21893、output 8、cacheRead 128、total 22029 tokens。脱敏证据保存在发布 worktree 的 `output/production-model-verification.json`。

旧镜像、原 Compose 覆盖配置和静态资源备份位于 `/opt/shotloom-releases/worker-20261121-5cc1dc0/`；当前 Compose 使用该目录的 `compose.production.yaml`。保留原 Agent cache 卷；本次不执行数据库迁移，不发布新的桌面或移动安装包。
