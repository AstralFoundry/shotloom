# 模型目录核对 / Model catalog audit

核对日期：2026-11-15。范围是 Shotloom 已有的 18 个厂商连接。直接读取官方文档、官方 OpenAPI 或第一方 SDK；发布名称、API 模型 ID 和请求字段分别核对，不按版本号推测 API ID。

Checked on 2026-11-15 across Shotloom's 18 existing connections, using official documentation, OpenAPI schemas and first-party SDKs. Product names, API identifiers and request fields are checked separately.

本次新增 19 个预设，总计 **32 个协议、18 个连接、86 个模型预设**。未删除或改名原有模型 ID，未改变用户已保存的 Key、地址或默认模型。旧预设保留不表示本次已确认其仍然可用；表中明确列出未能完成核对的厂商。

This refresh adds 19 presets, bringing the catalog to **32 protocols, 18 connections and 86 model presets**. Existing IDs, saved keys, endpoints and user defaults are preserved. Retaining an old preset does not establish its current availability; incomplete checks are identified below.

## 新增模型 / Added presets

| 厂商 / Provider | API 模型 ID / API model IDs | 官方依据 / Official evidence |
| --- | --- | --- |
| OpenAI | `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-luna` | [Models](https://developers.openai.com/api/docs/models), [Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra), [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) |
| Anthropic | `claude-haiku-5-5` | [官方文档索引 / Documentation index](https://platform.claude.com/llms.txt), [第一方 SDK model IDs](https://github.com/anthropics/anthropic-sdk-python/blob/main/src/anthropic/types/model.py) |
| Kimi | `kimi-k3.1-pro`, `kimi-k3.1-pro-highspeed` | [官方快速开始 / Quickstart](https://platform.kimi.com/docs/get-api-key) |
| 智谱 / BigModel | `glm-5.3-flash`, `glm-5.3-flashx` | [GLM-5.3-Flash/FlashX](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash) |
| 阿里云百炼 / Alibaba Model Studio | `qwen3.7-plus` | [模型选择 / Model selection](https://help.aliyun.com/zh/model-studio/models) |
| MiniMax 文本 / Text | `MiniMax-M3.1-Flash`, `MiniMax-M3` | [OpenAI-compatible API](https://platform.minimax.io/docs/api-reference/text-openai-api) |
| MiniMax 图片 / Image | `MiniMax-H3-Image`, `MiniMax-H3-Image-Highspeed` | [Image generation](https://platform.minimax.io/docs/guides/image-generation) |
| Black Forest Labs | `flux-3-image`, `flux-3-image-klein`, `flux-3-video` | [OpenAPI](https://api.bfl.ai/openapi.json), [Image guide](https://docs.bfl.ml/flux_3/flux3_image_generate), [Video guide](https://docs.bfl.ml/flux_3/flux3_video) |
| Vidu | `viduq3-pro`, `viduq3-turbo` | [Q3 文生视频 / Text to video](https://platform.vidu.com/docs/api-reference/video-models/vidu-q3/text-to-video), [图生视频 / Image to video](https://platform.vidu.com/docs/api-reference/video-models/vidu-q3/image-to-video) |
| 火山方舟 / Volcengine Ark | `doubao-seedream-5-0-flash-260915` | [官方模型列表 / Model list](https://docs.volcengine.com/docs/ark/model-list?lang=zh) |

Vidu 在 Shotloom 中的稳定 ID 为 `vidu-q3-pro` / `vidu-q3-turbo`；Seedream Flash 为 `seedream-5.0-flash`。它们的上游 API ID 与展示 ID 分开保存。

Vidu's stable Shotloom IDs are `vidu-q3-pro` / `vidu-q3-turbo`; Seedream Flash uses `seedream-5.0-flash`. Upstream API identifiers are stored separately from these local IDs.

## 请求差异 / Request differences

- OpenAI Sol 的推理选项不含 `none`；Terra 和 Luna 包含。Agent 工具调用继续使用 Responses。
- Kimi K3.1 的 `reasoning_effort` 为 `low` / `high` / `max`，默认 `max`，不套用 OpenAI 的枚举。
- MiniMax M3.1 Flash 为 `low` / `medium` / `high` / `xhigh` / `max`，不支持 `none`；M3 不暴露该调节项。共享媒体连接保留根地址，文本协议声明 `/v1/chat/completions`，Harness 使用对应 `/v1` API 前缀。
- MiniMax H3 Image 使用 `/v1/images/generations` 和 `/v1/images/edits`，编辑请求中的 `images` 为 `{ image_url }` 对象数组，支持 1–16 张参考图；不复用旧 `/v1/image_generation`。
- FLUX 3 Image 使用 `images`、`aspect_ratio` 和 `resolution`；不能套用 FLUX.2 的 `input_image`。图片编辑支持 1–10 张参考图。FLUX 3 Video 的 `t2v` / `i2v` 分别提交文本与首帧，当前预设提供 5–20 秒及同步音频。更多关键帧和续接视频尚未暴露为预设操作。
- Vidu Q3 新增独立操作，提供 1–16 秒与同步音频，保留 Q2 原有操作与时长约束。

Reasoning enums are provider-specific. MiniMax text declares its API prefix explicitly; H3 Image uses the new Images API with object-array references. FLUX 3 has separate image/video schemas rather than FLUX.2 fields. Vidu Q3 has separate operations so Q2 contracts remain unchanged. These are wire-level mappings, not rules that infer user intent.

Haiku 本次只确认 API ID 与 Messages 接入，未取得完整模型详情页；不从 Sonnet 继承未经确认的上下文和最大输出声明。新增模型参数中部分选项是保守子集，不宣称覆盖厂商全部能力。

Haiku's ID and Messages integration were confirmed, but its detail page was unavailable. Unverified context/output limits are omitted rather than inherited from Sonnet. Some preset options deliberately cover a conservative subset of provider capabilities.

## 其余厂商与核对缺口 / Other providers and incomplete checks

| 厂商 / Provider | 本次结果 / Finding |
| --- | --- |
| DeepSeek | [官方定价页](https://api-docs.deepseek.com/quick_start/pricing/)确认 `deepseek-flash` 已指向 DeepSeek-V4.1-Flash-1017，`deepseek-v4-pro` 指向 V4-Pro-0813。保留稳定别名，不新增重复预设。 / Stable aliases already resolve to updated versions; no duplicate preset added. |
| Google | Gemini 官方模型页多次连接超时，浏览器访问也被工具权限拒绝；[第一方 SDK 视频测试](https://github.com/googleapis/python-genai/blob/main/google/genai/tests/models/test_generate_videos.py)仍引用 Veo 3.1 Preview，但这不足以证明完整模型目录没有更新。保留现状，尚未完成核对。 / Official model pages timed out; SDK examples do not establish the full latest catalog. |
| xAI | [官方模型页](https://docs.x.ai/developers/models)及文档索引超时，尚未完成核对。 / Model page and index timed out; unverified. |
| Kling | [官方文档入口](https://klingai.com/document-api/apiReference/model/skillsMap)仅返回客户端页面壳，没有 API ID 与参数正文，尚未完成核对。 / Only a client-rendered shell was retrieved; IDs and schemas remain unverified. |
| Runway | [官方模型目录](https://docs.dev.runwayml.com/guides/models/)和 [OpenAPI](https://docs.dev.runwayml.com/openapi.json)仍列出已接入的 `gen4.5`、`gen4_turbo`；目录也含大量第三方模型，不能当成同一请求结构批量注册。 / Existing native model IDs remain listed; third-party entries require their own wire contracts. |
| fal.ai | 核对了[现有 Veo 队列 schema](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/veo3/fast)。没有完成其全部动态市场模型的枚举；FLUX 3 请求 schema 本次未取到，不按猜测加入。 / Existing endpoint verified; the full marketplace and FLUX 3 schema were not verified. |
| Replicate | [官方模型集合](https://replicate.com/collections/official)已出现 FLUX 3 Image／Video、Vidu Q3 等。当前只保留已验证输入结构的 FLUX Schnell；其他模型需要分别核对 prediction input schema。 / Newly listed models require per-model prediction schemas before registration. |
| RunningHub | 后续已取得[官方 API 目录](https://www.runninghub.ai/runninghub-api-doc-en/)和原生图片/视频请求文档。原生 `/openapi/v2/…` 与现有工作流 API 不同，模型目录未据此自动扩展；缺口见协议核对。 / Native API documentation was subsequently recovered; its contracts differ from the workflow API and are not yet integrated. |
| StarRouter | 官网连接超时，未核对到可靠的新上游 ID；不把原厂新模型自动添加到转接服务。 / Endpoint unavailable; upstream releases are not assumed to exist on this relay. |
| Anthropic 补充 / Additional | 文档索引和第一方 SDK 同时列出 Fable 5.2／Mythos 5.2，但详情页被重定向到地区不可用页面，接入条件和参数未核实，本次不加入默认预设。 / Fable/Mythos IDs were found, but access conditions and invocation details could not be verified. |

## 验证 / Verification

媒体测试通过本地 HTTP 服务验证实际提交、轮询、结果解析，以及新增图片模型的多参考图请求。文本测试检查上游 ID、路径、推理枚举和结果解析，Harness 测试覆盖 MiniMax 的 API 前缀与模型选项。保留原有模型迁移测试。

Tests exercise media submission/polling/results through a local HTTP service, including multi-reference image requests. Text tests cover IDs, endpoints, reasoning enums and response parsing. Harness tests cover MiniMax's API prefix. Existing migration coverage remains in place.

没有进行付费线上生成。文档核对与本地测试不代表具体账号、区域、配额、模型访问权限已经实测，也不代表上表中未核实厂商的目录已更新完成。

No paid live generation was performed. Documentation checks and local tests do not establish account access, regions, quotas or live generation success, nor do they complete the provider checks explicitly marked unverified above.

协议能力的逐厂商补充核对见 [厂商协议覆盖核对 / Provider protocol coverage audit](./protocol-capability-audit.md)。
