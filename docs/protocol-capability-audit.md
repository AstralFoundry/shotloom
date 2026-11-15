# 厂商协议覆盖核对 / Provider protocol coverage audit

核对日期：2026-11-15。对照当前 18 个连接及 32 个协议，读取厂商官方文档、OpenAPI 和第一方 SDK。这里记录的是接口覆盖差距，不是已实现清单，也不是账号可用性保证。没有发起付费生成。

Checked against 18 connections and 32 protocols using official documentation, OpenAPI schemas and first-party SDKs. Findings describe coverage gaps, not completed integrations or guaranteed account access. No paid generation was performed.

## 结论 / Findings

确实有遗漏，而且不只是模型名称。主要是语音输入/输出、图片编辑、视频参考/编辑/延长，以及平台另行提供的原生生成 API。相同厂商或相同任务查询接口不代表提交结构相同；不能通过复制模型 ID 宣称完成接入。

Coverage gaps include speech input/output, image editing, reference-based video, video editing/extension and platform-native generation APIs. Shared providers or task lifecycles do not establish compatible request schemas.

以下“已核实缺口”表示官方材料明确存在该能力，但当前内置目录没有对应操作；第一方 SDK 证据与完整 HTTP 契约分开标注。表中列出与创作产品有关的主要接口，不穷举管理、计费和所有第三方市场模型。

“Verified gap” means an official source describes a capability absent from the bundled operations. SDK evidence is distinguished from a verified HTTP contract. The audit focuses on creative workflows rather than billing/admin APIs or exhaustive marketplace enumeration.

## 现有连接逐项核对 / Existing connections

| 连接 / Connection | 发现与当前差距 / Finding and gap | 官方依据 / Official evidence |
| --- | --- | --- |
| OpenAI | 现有 Chat/Images，Agent 使用 Responses。缺少直连语音合成、转写及实时音频操作；现有转接商音频不能代替原厂协议。Responses 可用于后续统一文本接入，Chat 并非已停用。**不新增 Sora：官方已说明 Videos API 于 2026-09-24 停用。** / Direct speech/transcription/realtime coverage is missing. Do not add the discontinued Videos API. | [Audio](https://developers.openai.com/api/docs/guides/audio), [Responses migration](https://developers.openai.com/api/docs/guides/migrate-to-responses), [Video shutdown notice](https://developers.openai.com/api/docs/guides/video-generation) |
| StarRouter | 现有文本、图片、音频、视频。官网/文档未取得可核对的正文，无法判断新增接口，不把原厂更新视为转接商已支持。 / Further coverage remains unverified. | [官网 / Site](https://starrouter.io) |
| Google | 现有文本、Gemini 图片、Veo 文生视频。第一方 SDK 另有 Imagen 专用生成、Veo 首尾帧和参考输入；当前操作未覆盖。官方网页多次超时，接入时须核对 Gemini Developer API 与 Vertex AI 的差异，不能合并宣称支持。 / SDK shows additional image/video operations; API and regional availability require separate checks. | [Image SDK tests](https://github.com/googleapis/python-genai/blob/main/google/genai/tests/models/test_generate_images.py), [Video SDK tests](https://github.com/googleapis/python-genai/blob/main/google/genai/tests/models/test_generate_videos.py) |
| xAI | 当前视频只映射文本/首帧。官方 SDK 已有多参考图、视频编辑和延长；对应 HTTP 字段/路径尚未完整核实。 / Reference video, editing and extension are SDK-verified gaps; HTTP mappings remain to be checked. | [第一方 SDK / SDK](https://github.com/xai-org/xai-sdk-python#video-generation) |
| Anthropic | 已有 Messages。多模态理解、工具调用不等于图片/视频生成，没有依据把它列为缺失的媒体生成协议。 / No native media-output gap established from the reviewed materials. | [官方文档索引 / Docs](https://platform.claude.com/llms.txt) |
| DeepSeek | 目前仅 Chat。官方还提供 Responses、Anthropic 兼容 Messages、TTS、ASR；搜索/文件/OCR 等属于辅助工具接口，应另外归类。 / Additional text transports and speech tools are missing. | [Chat interfaces](https://api-docs.deepseek.com/guides/build_a_chatbot), [TTS](https://api-docs.deepseek.com/guides/tts/), [ASR](https://api-docs.deepseek.com/guides/asr/) |
| 阿里百炼 / Qwen | 已有文本/图片/视频。官方目录还列语音合成、识别、实时语音和全模态实时模型；缺少对应音频协议。具体 HTTP/WS 契约尚未完成核实。 / Audio coverage is missing; wire contracts require further verification. | [官方模型目录 / Models](https://help.aliyun.com/zh/model-studio/models) |
| Kimi / Moonshot | 当前 OpenAI 兼容文本接入。官方文档中的多模态输入和工具能力不应计为原生媒体生成缺口。 / Multimodal input and tools do not establish native media generation. | [官方索引 / Docs](https://platform.kimi.com/docs/llms.txt) |
| 智谱 / BigModel | 已有文本/图片/视频；官方另有 GLM-TTS 和语音识别 API，当前未接。 / Direct speech synthesis and recognition are missing. | [官方接口索引 / API index](https://docs.bigmodel.cn/llms.txt) |
| MiniMax | 已有文本/图片/视频/音频。仍缺 ASR、音色克隆等独立操作；异步/流式语音及 H3 上下文/再生成操作也未完整暴露。 / Speech recognition, voice cloning and advanced operations remain uncovered. | [API index](https://platform.minimax.io/docs/llms.txt), [Voice cloning](https://platform.minimax.io/docs/api-reference/voice-cloning-clone.md) |
| 火山方舟 / Bytedance | 现有图片/视频；官方目录另列文本/Responses、多模态向量和 3D。文本生成应优先补；向量/3D 属于另行扩展的能力。不要把火山语音的独立鉴权协议当成方舟兼容接口。 / Text is a direct gap; embeddings/3D need additional product contracts. | [官方模型列表 / Models](https://docs.volcengine.com/docs/ark/model-list?lang=zh) |
| Kling / 可灵 | 现有视频操作。官方 API 页仅取得客户端页面壳，未完成新增协议核实，不能宣称已覆盖全部。 / New operations remain unverified because the API body could not be retrieved. | [官方 API 入口 / API](https://klingai.com/document-api/apiReference/model/skillsMap) |
| RunningHub | 当前只接工作流创建 API。官方另有独立 `/openapi/v2/…` 模型 API，覆盖图片、视频及其他媒体；与工作流请求结构不同，属于明确遗漏。 / Native model APIs are separate from the existing workflow integration. | [官方接口目录 / API index](https://www.runninghub.ai/runninghub-api-doc-en/), [Image API example](https://www.runninghub.ai/runninghub-api-doc-en/api-536424698), [Multimodal video example](https://www.runninghub.ai/runninghub-api-doc-en/api-498749513) |
| Black Forest Labs | 现有 FLUX 基础图片/视频。缺少 Fill/Expand、视频编辑/放大、去除/去模糊/试衣等操作；FLUX 3 多关键帧也超出当前首帧子集。 / Editing/tool endpoints and advanced keyframes are missing. | [官方 OpenAPI](https://api.bfl.ai/openapi.json) |
| Runway | 当前仅文生/图生视频。OpenAPI 还有文生图、视频编辑、图片/视频放大、角色表演，以及语音/音乐/音效/配音/分离等。属于最大的一组遗漏。 / Image, transformation and audio operations are absent. | [官方 OpenAPI](https://docs.dev.runwayml.com/openapi.json) |
| Vidu | 当前 Q2/Q3 文生/首帧视频。缺首尾帧、参考生视频、参考生图、音效/音乐等；官方 Q4 Preview 参考视频也尚未接。 / Start/end, reference video, image and audio operations are missing. | [API index](https://platform.vidu.com/docs/llms.txt), [Q4 reference video](https://platform.vidu.com/docs/api-reference/video-models/vidu-q4-preview/reference-to-video.md) |
| fal.ai | 当前仅两个图片/视频模型操作。官方市场还有音频、视觉、3D 等；共享队列层可复用，每个模型的输入仍需单独映射。 / Audio/3D and many model-specific operations remain uncovered. | [官方文档索引 / Docs](https://docs.fal.ai/llms.txt), [Model API reference](https://fal.ai/docs/_llms/model-api-reference.txt) |
| Replicate | 当前仅图片预设。Predictions 外层可复用，但视频/音频模型需要分别处理 input 和输出文件类型，不能只新增 ID。 / Video/audio require per-model input and output contracts. | [HTTP API](https://replicate.com/docs/reference/http), [官方模型集合 / Official collections](https://replicate.com/collections/official) |

## 已核实的接口示例 / Verified endpoint examples

这些是核对到的独立请求契约示例，不表示代码已经接入。

These endpoint examples were verified in official sources; they are not implemented by this audit.

- DeepSeek：`POST /v1/tools/tts` 返回音频流，另有 WebSocket；`POST /v1/tools/asr` 上传完整音频，当前文档说明不支持流式识别。二者不能共用文本结果解析器。[TTS](https://api-docs.deepseek.com/guides/tts/)、[ASR](https://api-docs.deepseek.com/guides/asr/)
- Vidu：`POST /ent/v2/start-end2video`、`/ent/v2/reference2video`、`/ent/v2/reference2image`、`/ent/v2/text2audio`，查询共用 `/ent/v2/tasks/{id}/creations`，提交字段不同。[API index](https://platform.vidu.com/docs/llms.txt)
- Runway：`POST /v1/text_to_image`、`/v1/video_to_video`、`/v1/text_to_speech`、`/v1/text_to_music`、`/v1/sound_effect` 等。[OpenAPI](https://docs.dev.runwayml.com/openapi.json)
- BFL：`POST /v1/flux-pro-1.0-fill`、`/v1/flux-pro-1.0-expand`、`/v1/flux-tools/video-edit-v1`、`/v1/flux-tools/video-upscale-v1` 等。[OpenAPI](https://api.bfl.ai/openapi.json)
- RunningHub：`POST /openapi/v2/minimax/h3-image/text-to-image`、`/openapi/v2/bytedance/seedance-2.5-token/multimodal-video`；不能套用旧工作流创建 body。[Image](https://www.runninghub.ai/runninghub-api-doc-en/api-536424698)、[Video](https://www.runninghub.ai/runninghub-api-doc-en/api-498749513)

## 尚未内置的厂商 / Providers not bundled

| 厂商 / Provider | 已核实范围 / Verified scope | 官方来源 / Source |
| --- | --- | --- |
| ElevenLabs | TTS、STT、音效、音乐、变声等；TTS 返回音频，不是图片任务 JSON。 / Speech, sound effects, music and voice transformation. | [API index](https://elevenlabs.io/docs/llms.txt), [TTS](https://elevenlabs.io/docs/api-reference/text-to-speech/convert) |
| Stability AI | 图片生成/编辑、音频、3D；multipart 和二进制响应需要对应传输支持。 / Image, audio and 3D with multipart/binary contracts. | [API reference](https://docs.stability.ai/api-reference) |
| Adobe Firefly | 官方提供图片生成、定制模型及放大能力；鉴权和异步契约需另行实现。 / Image generation, custom models and upscaling require separate integration. | [官方 API 文档 / API docs](https://developer.adobe.com/firefly-services/docs/firefly-api/) |
| Luma | 本次官方文档连接超时，未确认当前 API 契约，暂不列为已核实接入候选。 / Current wire contract remains unverified. | [官方文档 / Docs](https://docs.lumalabs.ai/) |

## 建议实现顺序 / Suggested implementation order

1. **补齐现有媒体操作**：Vidu 首尾帧/参考/图片，Runway 图片/视频编辑，BFL 编辑工具，RunningHub 原生 API。优先复用现有连接和已验证的任务生命周期。
2. **补全音频传输**：二进制音频、multipart 上传、SSE/WS 与流式取消，再接 OpenAI、智谱、MiniMax、Qwen、DeepSeek、ElevenLabs。不能给所有音频套一个 URL 响应模板。
3. **核对后扩展市场与新厂商**：fal/Replicate 按实际模型 schema 逐项接入，Stability/Firefly 独立实现；Google/xAI 的未确认字段继续核实，Kling/StarRouter 保持未核实状态。

First complete operations on existing media connections, then implement the required audio transports, then expand per-model marketplace and new-provider coverage. Each operation needs independent request/response fixtures and submission/query/result/cancel checks where applicable. Documentation alone does not establish live success.
