# Agent 提示词缓存

Shotloom 使用官方 `@deepseek-ai/dsh-llm-pi-ai` 和其 pi-ai 依赖发送 Agent 请求。厂商协议与兼容能力由插件的 `mode.agent` 声明，应用不按厂商名称自行构造缓存协议。此处核对的是 Agent 文本请求，不包含图片、视频生成任务。

## 已接入的厂商

| 厂商 | 当前 Agent 协议 | 缓存处理与边界 |
| --- | --- | --- |
| OpenAI | Responses | 官方适配器使用会话缓存键；选择长期保留时发送 `prompt_cache_retention: "24h"`。是否支持仍取决于模型和渠道。 |
| Anthropic Claude | Messages | 官方适配器添加缓存断点；长期保留映射为 `ttl: "1h"`，工具定义也允许缓存断点。 |
| Google Gemini | OpenAI 兼容 | 使用 `/v1beta/openai`，沿用支持模型的隐式缓存。当前没有创建显式缓存资源或传入 `cached_content`。Google 文档说明 Gemini 2.5 及后续模型默认启用隐式缓存，命中并无保证。 |
| DeepSeek | Chat Completions | 保留自动前缀缓存，官方适配器识别 `prompt_cache_hit_tokens`。 |
| 通义千问 Qwen | Chat Completions | 使用 `/compatible-mode/v1`，保留隐式缓存；当前没有注入其显式 `cache_control`，也没有新增显式缓存写入统计。 |
| 智谱 GLM | Chat Completions | 使用 `/api/paas/v4`，保留自动缓存；标准 `prompt_tokens_details.cached_tokens` 由官方适配器读取。 |
| Moonshot Kimi | Chat Completions | 保留服务端缓存行为；已安装官方适配器支持其顶层 `cached_tokens` 回执。本次未取得可读的官方缓存文档，具体模型条件待账号实测。 |
| xAI Grok | Chat Completions / Responses | 保留自动缓存；两种协议的标准缓存读取回执由对应官方适配器处理。插件不声明 OpenAI 的长期保留能力。 |
| MiniMax | Chat Completions | 保留官方自动缓存行为，读取标准兼容回执；不发送 OpenAI 的长期保留参数。 |

StarRouter 是按需安装的聚合渠道，缓存能力依赖上游路由；插件保守声明不支持 OpenAI 长期保留参数。没有 Agent 文本能力的媒体厂商不属于这次缓存接入范围。

## 设置和可观测性

插件连接设置中的保留偏好仅作用于 Agent。自动表示不覆盖官方适配器默认值；短期、长期是向适配器传递的偏好，不代表强制命中，也不是缓存开关。`supportsLongCacheRetention: false` 的模型不会因用户选择长期而收到 OpenAI 的 24 小时参数。

打开聊天顶部用量明细，查看官方每轮、会话缓存读取与写入 token。未返回缓存回执时不能根据响应速度推测命中；上游兼容网关是否透传 usage 也会影响统计。保持系统提示、工具定义和历史前缀稳定才有复用机会，具体门槛、淘汰时间和价格以厂商说明为准。

## 验证范围与插件更新

`harness/host/test/modelConfig.test.mjs` 从真实发行插件构建九家厂商的路由，验证接口前缀、保留能力、连接设置和兼容字段校验。`host.test.mjs` 通过本地 SSE 服务运行真实官方适配器，验证 Responses 会话缓存键、长期参数及 Chat Completions 三种缓存读取回执的归一化。测试没有向付费厂商发请求，不能证明远端实际命中率或所有模型均可用。

相关厂商源码包已升至 `1.0.3`；`npm run prepare:plugins` 生成本地发行包，不代表已发布 npm。已安装版本不会被发行资源强制覆盖，旧安装需要手动更新相应插件后使用新契约。

## 官方资料

- [Google 隐式与显式缓存](https://ai.google.dev/gemini-api/docs/caching) 与 [OpenAI 兼容接口](https://ai.google.dev/gemini-api/docs/openai)
- [DeepSeek 上下文缓存](https://api-docs.deepseek.com/guides/kv_cache)
- [Qwen 上下文缓存](https://www.alibabacloud.com/help/en/model-studio/context-cache)
- [智谱缓存](https://docs.bigmodel.cn/cn/guide/capabilities/cache)
- [xAI 缓存用量和价格](https://docs.x.ai/developers/advanced-api-usage/prompt-caching/usage-and-pricing)
- [MiniMax 提示词缓存](https://platform.minimax.io/docs/api-reference/text-prompt-caching)

OpenAI、Claude 参数映射以及 Kimi 回执兼容还核对了本项目锁定版本的官方适配器源码；更换适配器版本后应重跑上述测试。
