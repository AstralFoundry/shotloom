# Agent 断流与工具回执修复

## 已确认的问题

- nginx 的两次 `/api/agent/model` `upstream prematurely closed connection` 与 Docker 重建旧容器精确重合：北京时间 2026-11-21 03:23:31、03:32:08。旧服务在停止信号中调用 `server.close()` 后立即 `process.exit(0)`，尚未结束的 HTTP 200 模型流被截断。进程级回归在旧实现稳定得到 `TypeError: terminated` / `ECONNRESET`。
- Worker 的登录心跳把任意网络错误当成失效，直接销毁 Worker。现复用已有 `verifyCloudSession`，仅确认登录失效/账号变化才通过失效事件停止，临时网络错误保留运行态。
- 工具模型输出只展开了一层回执，产品回执中的 Harness `sessionId` 仍留在顶层，真正的导演台 `sessionId` 和 `revision` 在内层 `result`。模型照顶层 ID 提交会遭 `SESSION_MISMATCH`。现按真实传输/产品合同展开两层，清除产品内部记账字段，保留场景 ID、失败码、真实引用和图片附件。HTTP 与 Worker 共享此修复。
- `canvas_start_generation` 在“允许 Agent 运行节点”关闭时先被 `isAvailable` 拒绝，原有 `NODE_EXECUTION_DISABLED` 分支不可达，授权层误报 `BRIDGE_UNAVAILABLE`。现直接返回可恢复的设置拒绝和操作提示，仍不启动任务；全权限模式不覆盖用户的生成开关。

导演台 `SESSION_MISMATCH` 本身继续生效。真实 iframe 重建或切换场景后必须重新读取快照核对内容，不能覆盖 ID 后自动重放旧批次。此类保护在 Worker 迁移前已存在，不能据报错认定场景丢失。

## 验证

四个问题均有先失败、修改后通过的回归。服务端测试使用生产监听器、真实 TCP 流和停止信号处理；回执测试让官方 Agent 读取快照并使用返回的 ID 提交，修复后成功。真实浏览器 Worker 测试也使用实际双层产品回执，断言进入下一次模型请求的是导演台 ID，兼测工具续轮、图片、本地历史恢复。

相关根测试 56 项、选定 Host 回归 4 项、真实浏览器 Worker 测试 1 项通过；renderer/server/Host 类型检查、模块/存储/测试架构检查、Worker 镜像与 Vite 构建通过。生产切换流程见 `docs/engineering.md` 和 `scripts/activate-production.sh`。

本次不自动重试付费操作、不解除权限校验、不修改导演台会话比较逻辑，不发布原生安装包。

后续全工具审计补齐了可用性/参数错误分类、每工具超时、取消信号和抽帧附件数量边界。最终上线版本、真实模型工具续轮及验证限制见 `agent-tool-boundary-audit-20261121.md`。
