# Shotloom Agent Host

这是迁移中的独立官方 Harness 装配包，尚未替换桌面入口。实现与未完成范围以 [架构文档](../../docs/shotloom-agent-harness-architecture.md) 为准。

```sh
cd harness/host
npm ci --ignore-scripts
npm run build
npm test
```

也可在工程根目录运行 `npm run harness:test`。安装使用此包自己的 lockfile；不要链接 vendor 的 node_modules。

`createHost()` 返回官方 Context 与产品绑定的 create/resume 接口。宿主通过 `registerTools(scope, binding)` 在官方尚未发布 Agent 时注册命名产品工具。`registerProductTools()` 处理产品角色、会话身份、官方审批和认证桥调用；桌面执行端仍须根据受信绑定核对当前工程、编辑节点和用户权限。

配置项：

- `dataRoot`：官方 Session JSONL、官方凭据与产品会话绑定的数据目录。
- `contentRoot`：包含 prompts/ 和 skills/ 的产品资源目录。
- `rulesPath`：产品 AGENTS.md。
- `skillDirs`：显式传入的附加产品 Skill 根目录；官方 filesystem provider 发现及加载。

官方 DeepSeek adapter 从 Credentials provider 解析 `DEEPSEEK_API_KEY`。测试只注册脚本化模型，不调用付费模型，不修改用户工程。

测试的 HTTP bridge 写入临时文件，并不是 Shotloom 真实画布/剪辑/文本执行端。测试证明的是官方 loop、工具与持久化装配；不能据此宣称桌面迁移或发布验收完成。
