# 媒体协议接入 / Media protocol integrations

这些协议由 Shotloom 根据厂商公开接口独立实现。参考其他项目仅用于确定厂商覆盖范围；没有导入 BeefTV 的插件包、模板表达式或运行时。

Shotloom implements these protocols independently from the providers' public interfaces. Other projects informed coverage only; no BeefTV packages, template expressions or runtime are imported.

## 首批范围 / Initial coverage

| 服务 / Service | 协议与预设 / Protocol and preset | 当前范围 / Supported operations | 官方依据 / Official sources |
| --- | --- | --- | --- |
| 火山方舟 / Volcengine Ark | Seedream 5.5 (`doubao-seedream-5-5-261028`) | 文生图、参考图编辑，接在现有火山连接下 / Text to image and reference editing in the existing Ark connection | [Images API](https://www.volcengine.com/docs/82379/1541523) |
| Black Forest Labs | FLUX.2 Pro (`flux-2-pro`) | 文生图、单参考图编辑、异步查询 / Text to image, single-reference editing and polling | [Generation guide](https://docs.bfl.ai/quick_start/generating_images), [OpenAPI](https://api.bfl.ai/openapi.json) |
| Google | Veo 3.1 Preview (`veo-3.1-generate-preview`) | 文生视频、长任务查询、鉴权下载，接在现有 Google 连接下 / Text to video, operation polling and authenticated download in the Google connection | [Video guide](https://ai.google.dev/gemini-api/docs/video), [official SDK REST mappings](https://github.com/googleapis/python-genai/blob/v1.55.0/google/genai/models.py), [official SDK model examples](https://github.com/googleapis/python-genai/blob/main/google/genai/tests/models/test_generate_videos.py) |
| Runway | Gen-4.5、Gen-4 Turbo | Gen-4.5 文生/首帧图生视频；Turbo 首帧图生视频；查询与远程取消 / Gen-4.5 text/image to video, Turbo image to video, polling and cancellation | [API](https://docs.dev.runwayml.com/api/), [OpenAPI](https://docs.dev.runwayml.com/openapi.json) |
| Vidu | Q2、Q2 Pro | Q2 文生视频；Q2 Pro 首帧图生视频；查询 / Q2 text to video, Q2 Pro image to video and polling | [Text to video](https://platform.vidu.com/docs/api-reference/video-models/vidu-q2/text-to-video), [Image to video](https://platform.vidu.com/docs/api-reference/video-models/vidu-q2/image-to-video) |
| fal.ai | FLUX Schnell、Veo 3 Fast | 图片和视频队列、状态查询、单独取结果、远程取消 / Image and video queues, status, separate result retrieval and cancellation | [Queue API](https://docs.fal.ai/model-apis/model-endpoints/queue), [FLUX schema](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/flux/schnell), [Veo schema](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/veo3/fast) |
| Replicate | FLUX Schnell | 图片预测、异步查询、远程取消 / Image predictions, polling and cancellation | [HTTP API](https://replicate.com/docs/reference/http) |

协议与模型预设位于 `plugin-packages/defaults/<plugin-id>/manifest.json`，每个插件独立打包。发行包默认安装 32 个插件，提供 18 个连接和 86 个模型；运行目录只读取用户存储中的安装记录与连接。API 地址和 Key 属于用户连接，参数可在连接中修改。

Protocols and initial model presets live in independently packaged manifests under `plugin-packages/defaults/`. Releases install 32 plugins providing 18 connections and 86 model presets. The runtime catalog reads installed records and saved connections only. Endpoints, keys and capability edits belong to user connections.

## 运行契约 / Runtime contracts

- `{model}` 编码为单个 URL 组件；`{modelPath}` 将 owner/model/subpath 的每段独立编码；`{modelOwner}` / `{modelName}` 分别取前两段。空路径和 `.` / `..` 段会被拒绝。任务 ID 保留必要的路径层级并编码每段。
- fal.ai 的提交路径包含完整模型子路径，但查询、结果和取消路径只包含 owner/app，不能在这些路径中带上 `schnell` 或 `fast`。
- `taskResultEndpoint` 声明完成后单独读取的 JSON 结果；它与下载媒体文件的 `resultEndpoint` 不同。取结果失败会返回错误，重试只查询已有任务，不再次提交生成。
- `pendingWhenStatusMissing` 仅在响应返回相同任务 ID 时允许缺省状态视为运行中，供 Veo 的长任务使用。错误响应和无任务身份的空响应不会被当作正常等待。
- `cancelEndpoint` / `cancelRequestTemplate` 声明真实的远程取消请求；没有该接口的协议继续如实返回“仅停止本地等待”。
- `progressScale` 显式处理厂商进度单位，输出限制在 0–100。
- `requestValueMaps` 显式转换厂商参数枚举：画布统一使用画面比例和秒数，协议负责转换 Runway 的像素比例、fal.ai 的图片尺寸枚举与时长单位，不根据用户文字猜测。

`{model}` encodes one URL component; `{modelPath}` encodes each owner/model/subpath segment. `{modelOwner}` and `{modelName}` resolve the first two segments. Invalid dot or empty segments are rejected. Queue status/result/cancel paths on fal.ai use owner/app only. `taskResultEndpoint` fetches completed JSON separately from media download. Failed result retrieval does not resubmit generation. Missing status is considered pending only when explicitly enabled and the response identifies the same task. Remote cancellation and progress units are declared explicitly by each protocol. `requestValueMaps` translates stable canvas parameters into provider enums, such as Runway pixel ratios and fal.ai image sizes; protocol templates add duration units where required.

队列生命周期共用不代表任意模型的输入字段相同。当前 fal.ai 和 Replicate 操作按表中的模型字段定义；接入采用不同输入结构的新模型时，应增加独立操作并核验请求字段，不能只改模型 ID 就假定兼容。

A shared queue lifecycle does not imply identical model inputs. The fal.ai and Replicate operations currently use the schemas listed above. Models with different inputs require a separate operation and field verification, rather than merely changing the model ID.

## 验证边界 / Verification

`tests/media-protocols.test.mjs` 使用手写请求与回执样本，通过本地 HTTP 服务验证提交、图片输入、查询、独立取结果、失败、进度、取消与中止。样本与实现分别编写，不从协议 JSON 反推预期请求。

The integration test sends independently authored wire samples through a local HTTP service. It covers submission, image inputs, polling, result retrieval, failures, progress, cancellation and aborts. Expected requests are not generated from the implementation JSON.

未进行付费线上生成，不宣称所有账号、区域和预览模型均已实测。官方页面与 OpenAPI 于 2026-11-15 核对；Google 文档页面本次网络不可达，其 REST 字段以官方 SDK 的公开映射核对，当前预览模型能否在具体账号使用仍需线上验证。

No paid live generation was performed. Account access, regions and preview model availability have not been live-tested. Official pages and OpenAPI schemas were checked on 2026-11-15. The Google guide was unreachable in this environment; its REST fields were checked against published official SDK mappings, and current preview access still requires account-level verification.

2026-11-15 的模型目录更新与未完成核对项见 [模型目录核对 / Model catalog audit](./model-catalog-audit.md)。

协议能力遗漏及尚未核实项目见 [厂商协议覆盖核对 / Provider protocol coverage audit](./protocol-capability-audit.md)。
