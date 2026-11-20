# Polyfork 在线模型库接入调研（2026-11-19）

## 结论

可以把 Polyfork 的**免费低模 GLB**作为导演台的在线素材来源：官方允许产品让自己的用户搜索、挑选并直接加载 CDN 模型；也允许按 CC BY 4.0 保存、转存、再分发免费网格，但每个模型必须携带署名。免费 GLB 不需要账号、API key 或购买。普通 Pro 不等于给平台用户分发 `.mjs` 或 HD 的授权。[许可全文][license]、[API 描述][api]、[Agent 指南][prompt]。

建议首版只做免费 GLB 的分页搜索、预览与用户选中后的导入，沿用导演台已有的模型导入、持久化链路；如果文件进入 Shotloom 云端或导出包，明确采用 CC BY 路线并保存来源、署名和许可。这里没有修改应用代码。

## 官方接口与数据边界

正式域名是 `https://polyfork.dev`，不是 `polyfork.com`。以下均见 [GET /api][api]、[llms.txt][llms]、[prompt.txt][prompt]，已实测的请求在后文单列。

| 用途 | 正式入口 | 要点 |
| --- | --- | --- |
| 搜索 / 浏览 | `GET /api/assets` | `q`、`class`、`free=1`、`kit`、`min_triangles`、`max_triangles`、`ik`、`sort`、`page`、`per_page`；每页最多 100 |
| 模型详情 | `GET /api/assets/{id}` | 完整元数据、`download.glb`、`credit`、`license`、`renders`、比例与材质信息 |
| 套件 | `GET /api/kits`、`GET /api/kits/{id}` | 套件为共享比例与配色的一组模型；`status` 区分 `published` 与 `filling-up` |
| 匿名权限 / 配额 | `GET /api/me` | 匿名也可读；返回当前 `access`，无需先注册 |
| 免费 GLB | `GET /cdn/{id}.glb` | 无认证；优先使用详情给出的 `download.glb` |
| 其他网格导出 | 详情 `export_formats` 中的 `/dl/{id}.fbx`、`.usdz`、`.usda`、`.obj` | 免费模型无需 key；OBJ 还需相邻 `.mtl` |

列表响应为 `{ total, page, per_page, assets, access, filters, coverage, ... }`，不是裸数组；详情直接返回模型对象。普通列表有 `thumbnail`、`preview_glb`、`download`；`fields=compact` 可缩短候选行，但本次实测紧凑行**没有**缩略图和下载地址，需要详情补全。`size_m`、`triangles`、`thumbnail` 等可能为 `null`，不能据此拒绝整个列表。实测目录共 3,446 项，此数不是固定契约。[API][api]、[现场列表][search]。

`q` 是词匹配，不是语义检索。默认按相关性排序；API 用 `coverage`、`strong_matches`、`full_matches`、`matched_on` 解释结果。`sort=tris` 会改变候选顺序，本次 `chair` 甚至先出现内部制作说明提到椅子的路缘石；不要把排序后的首项当作用户所需物体。中文或罕见表达可能漏检，应由 Agent 理解完整语义、选择英文常用词或浏览分类，应用不硬编码意图规则。[搜索实测][search]、[提示指南][prompt]。

模型约定为米、Y 向上、右手系、正面朝 +Z；一般落在地面 `y=0`，墙挂物、地形等有明确例外，以详情 `origin` 和 `origin_y` 为准。官方说普通 GLB 为 glTF 2.0、无 Draco / meshopt；不要把商城用 `preview_glb` 当最终导入文件，它可能减少节点与法线，应使用 `download.glb`。[API][api]、[指南][prompt]、[扶手椅详情][detail]。

## 认证、费用与访问方式

- 免费低模、公开查询、CDN GLB 均可匿名。本次没有发送 `Authorization`，搜索、详情和 GLB 都成功。
- 免费账号只需邮箱，创建 Bearer key 后可下载 `/dl/{id}.mjs`、单模型 ZIP 和整套件 ZIP。**CDN `.mjs` 可匿名引用，与 `/dl` 源码下载要求不同**；但 Shotloom 无需运行外部源码即可导入 GLB。
- Pro 增加 HD。实测 `/api/me` 宣告年费 149 美元；这是本次响应值，不宜写死到产品。HD preview 是公开预览，不代表完整 HD 或平台分发权。API Bearer key 不可放进网页；账户 CDN token 与 API key 是不同凭据。
- 实测匿名 remix 烘焙配额为每小时 40、每月 100，按 IP 共享；免费账号每小时 100、每周 300。它们是**新变体生成配额**，不是普通 GLB 下载或搜索的请求上限。首版无需调用 remix。
- 已查阅文档未给普通搜索 / 下载固定 RPS、日次数或 SLA，也没有公开版本化 API 路径。许可要求按需获取、发送标明产品的 User-Agent、遇到 HTTP 429 退避。浏览器脚本不能自行设置 User-Agent，若要满足自定义 UA，需由已有受控主进程 / 服务端请求链路发送，不能假定前端 `fetch` 设置会生效。

来源：[API][api]、[llms][llms]、[许可][license]、[本次匿名账户响应][me]。没有注册、购买、请求付费生成或批量下载。

## 许可、缓存与来源留存

| 对象 / 行为 | 许可边界 |
| --- | --- |
| 免费 GLB / FBX / USD / OBJ，包括烘焙变体与整套场景网格 | 可选 CC BY 4.0 或 Polyfork 自有许可 |
| 用户端直接加载免费 CDN 文件 | 官方明确允许平台和编辑器；素材选择处注明来自 Polyfork，终端用户作品无需因这一路线额外署名 |
| Shotloom 自有存储、云缓存、下载包或素材库再分发免费网格 | CC BY 4.0 允许，但每项携带 `credit`，可链接原模型页，修改后注明修改；不要仅在全局 About 页写一句而丢失每项来源 |
| `.mjs`、HD、私有套件 | 不属于免费网格的 CC BY；普通免费 / Pro 不覆盖向平台用户托管或再分发，需另行平台许可 |
| 官方 renders / thumbnails | 许可明确排除 CC BY；首版引用官方图片 URL，不把图片一起抓取后镜像或当作 CC BY 文件导出 |
| GitHub 索引文本、列表与 `catalog.json` | 仓库 LICENSE 单独允许复制与构建；并非模型或品牌的统一许可证 |

应随模型保存：provider=`polyfork`、asset id、原模型页、原下载 URL、获取时间、原始 `credit`、选择的许可及许可 URL、修改说明。内容摘要 / ETag 用于识别拿到的具体版本。GLB 内已有 copyright 也应保留；重新导出可能清掉它，因此还需工程元数据或导出包的署名文件。对于用户私有云副本，也可统一采用免费网格的 CC BY 路线，不因存储私有就假定无需保留署名。以上是针对现有云导入链路的实施建议，不是额外接口要求。[许可][license]、[索引 LICENSE][index-license]、[GLB 实测][glb]。

许可称免费网格一旦按 CC BY 发布不可撤回，但将来新发布模型可能停止提供 CC BY，所以导入时保留当次详情里的许可与来源，不能把今日所有模型免费写成永久规则。官方 CDN 指向会更新，不是不可变版本地址；GitHub 仓库也明确只有索引、没有模型本体。[许可][license]、[官方仓库][repo]。

官方文档有一处冲突：`llms.txt` 末尾泛称“给平台用户使用需要平台许可”，但同文 License summary、`/api`、`prompt.txt` 与 **2026 年 11 月许可全文**明确允许免费 CDN 引用及 CC BY 免费网格托管。此处采用许可全文的具体边界，不把泛化的自动阅读提示当成免费 GLB 集成必须付费的结论。[许可][license]、[llms][llms]。

## 现场验证证据

时间：2026-11-19 11:36:03–11:36:51 UTC（北京时间 19:36）。使用 Python HTTPS GET；UA 为 `Shotloom/PolyforkResearch (https://github.com/AstralFoundry/shotloom)`；发送 `Origin: http://localhost:5173`，不发送认证。

| 请求 | 实测结果 |
| --- | --- |
| `/api/assets?q=chair&free=1&sort=tris&per_page=2&fields=compact` | HTTP 200，`total=49`、`page=1`、`per_page=2`，`coverage=ok`、`strong_matches=24` |
| `/api/assets?q=shotloomnonexistentxyz&per_page=1` | HTTP 200，`total=0`、`assets=[]`、`coverage=none`，不是错误页 |
| `/api/assets/armchair-980c7c` | HTTP 200，276 三角形、`free=true`、完整 GLB 下载地址、署名行与双许可说明 |
| `/api/assets/shotloom-nonexistent-xyz` | HTTP 404，JSON `error: "no such asset"`，附 guide URL |
| `/api/me` | HTTP 200，`authenticated=false`、`plan=anonymous`，返回上述配额 |
| `/cdn/armchair-980c7c.glb` | HTTP 200，33,084 字节；GLB 头 `glTF`、版本 2、声明长度等于实际长度；JSON 含 glTF 2.0、1 个 mesh、内置 buffer、无必需扩展；没有动画 |

API 实测头：`Content-Type: application/json; charset=utf-8`、`Access-Control-Allow-Origin: *`、`Access-Control-Allow-Headers: Authorization`、`Cache-Control: no-cache`。GLB 实测头：`Content-Type: model/gltf-binary`、`Access-Control-Allow-Origin: *`、`Cache-Control: public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400, stale-if-error=2592000`、`ETag: "b342bddc47d78df28c53a948beb7a7ad"`。这是 GET 响应验证，未做浏览器端 CSP、OPTIONS 或 WebGL 渲染验收。[搜索][search]、[详情][detail]、[GLB][glb]。

样例 SHA-256：`64168de732a58090d105decbd825f8b671767c561f89a23aefa3111516ae24d3`。GLB `asset.copyright` 为 `Armchair by Polyfork (https://polyfork.dev/asset/armchair-980c7c), CC BY 4.0`，`asset.extras.license` 为 `CC-BY-4.0 OR LicenseRef-Polyfork`，包含许可 URL 和原模型页。[样例][glb]。

起初 Python 默认 UA 获取官网页面返回 403；换标明产品或普通浏览器 UA 后成功。不能把一次默认 UA 的 403 解释成需要 API key。样例只下载到系统临时目录用于结构验证，未加入仓库或素材库；没有主动触发 429、测试购买 / HD 权限、运行远程 `.mjs` 或导入真实用户项目。

## Shotloom 现有代码与最小接入范围

用户确认只需要用户 / Agent 搜索和下载模型。用户提供的域名为 `https://polyfork.com/`；本次该域名证书校验失败，已核验的 API 与许可来自 `https://polyfork.dev`，不能将两者当作已验证的同一站点。

- `vendor/shotloom-director-desk/src/features/model-import/model-import-dialog.tsx` 已支持 GLB / glTF / FBX / OBJ，完成模型打包、检查、尺寸和朝向校正、放入场景；当前入口为本地文件选择。
- `vendor/shotloom-director-desk/src/core/resources/model-package.ts` 的 `packModelFiles` 已检查 glTF 2.0、文件完整性并生成可持久化包。`model-path.ts` 禁止在包内引用任意网络地址，因此应先下载所需文件，再沿用打包校验，不放开模型加载器的网络边界。
- `vendor/shotloom-director-desk/src/core/resources/gltf-model.ts` 暂无 Draco 支持；本次免费 GLB 样例无必需扩展，但尚未在实际渲染器中导入验证。
- `vendor/shotloom-director-desk/src/core/resources/project-resources.ts` 的 `ModelResource` 已有 `copyright`、`license`、`source`；可保存来源与署名，无需为首版重建资源格式。
- `renderer/src/services/cloudDirectorModels.ts` 已把模型包按 SHA-256 去重并持久化到私有云对象；`cloudApi.ts` 在工程保存、读取、剪贴板及导出链路复用此能力。

最小实现为：用户搜索 / 分页 / 详情 / 下载入口；Agent 共用同一查询、详情与下载实现；下载回执返回真实文件位置、来源、署名、许可和格式。若要 Agent 自动放入导演台，另需接入 iframe 导入命令；不要把“已下载”报成“已放入场景”。进入工程的模型继续走现有导入和保存流程。Agent 工具应按 `docs/engineering.md` 更新注册、可见性与参数契约；搜索不按关键词替用户决定制作范围或质量。

以上是最初调研时的代码范围；用户确认开发后的实现和验证如下。

## 已实现与开发验证（2026-11-19）

用户入口为导演台「场景 → 添加 → 导入模型 → 在线模型 · Polyfork」。支持英文关键词搜索、每页 24 项、详情、下载模型包和下载后导入。选中模型的署名、来源与操作按钮显示在结果列表上方。导入沿用本地模型的单位、朝向、材质选择与放置流程，没有新增模型加载器或依赖。

Agent 复用现有工具通道：

| 通道 | operation | 参数与结果 |
| --- | --- | --- |
| `director_desk_query` | `search_polyfork_models` | `query`、`page`；返回真实模型 ID 与分页列表 |
| `director_desk_query` | `get_polyfork_model` | `id`；返回尺寸、署名、来源与许可 |
| `director_desk_command` | `download_polyfork_model` | `id`；返回保留的 ZIP `artifactId` 与当前页面有效的下载 URL，场景不变 |
| `director_desk_command` | `import_polyfork_model` | `id`、最新快照的 `expectedSessionId` / `expectedRevision`，可选 `name` / `position`；成功后返回实体和资源 ID |

下载产物可通过已有 `export_artifact_deliver` 的 `download` 模式保存到设备。导入前后校验工程与版本，防止等待网络时把模型写入已切换的工程；撤销重做和同内容资源去重沿用原有实现。工程资源和 ZIP 都保留逐项署名、CC BY 4.0、原页面、原下载 URL 与获取时间。

服务端新增三个需要 Shotloom 登录的受控 `/api/polyfork/assets`、`/api/polyfork/assets/:id`、`/api/polyfork/assets/:id/model` 接口。只访问固定官方主机，发送产品 User-Agent，拒绝重定向、付费模型、缺失署名许可、不符合预期的下载地址、超过 32 MiB 的文件及无效 GLB 头；HTTP 429 按 Retry-After 在当前服务进程内退避。缩略图引用官方地址，不随 ZIP 镜像。两个导演台宿主入口均传入现有 BFF 地址；桌面 CSP 只新增官方缩略图来源。

验证结果：

- 渲染端、导演台、服务端 TypeScript 检查通过；导演台生产构建与发布隐私检查通过，已生成产品 iframe 静态文件。
- 127 项导演台、Agent 工具与提示词、云模型回归通过；新增服务端测试通过，覆盖认证、参数、付费/许可/下载地址限制、大小和格式、429 退避。新增前端服务测试覆盖 BFF 请求、真实格式的 GLB 打包、摘要、ZIP 原字节与许可、错误回执。
- 模块、存储、样式、UI、测试架构检查通过。现有 `check:i18n` 因工作区生成文件为 CRLF、脚本要求 LF 而失败；另行核对换行归一化后的内容完全一致，本次没有改动该生成文件。
- 浏览器运行真实导演台和生产 BFF 路由，仅登录数据库请求使用测试会话；搜索、详情、GLB 均请求真实 Polyfork HTTPS 服务，没有写入真实账号或云工程。
- 用户界面实际完成 Armchair 搜索、下载、模型解析和放入场景，署名保留，撤销重做通过。Agent 实际完成查询、详情、ZIP 下载及坐标 `[2, 0, -1]` 导入，撤销重做通过；使用旧 revision 导入得到 `REVISION_MISMATCH`，没有新增实体。
- Agent ZIP 中为 `armchair-980c7c.glb`（33,084 字节）与 `LICENSE.txt`；GLB SHA-256 与最初官方样例一致：`64168de732a58090d105decbd825f8b671767c561f89a23aefa3111516ae24d3`。

验证环境的部分 Node HTTPS 连接曾尝试不可达的 IPv6 地址，临时验证服务使用 IPv4 优先；网络仍出现过传输超时，重试后完成。产品保留连接/传输超时回执，不放宽 TLS 或地址校验。尚未部署服务端与客户端版本，未做正式登录、桌面安装包或真机端到端验收，也未触碰 HD、付费授权或远程 `.mjs` 执行。

[api]: https://polyfork.dev/api
[llms]: https://polyfork.dev/llms.txt
[prompt]: https://polyfork.dev/prompt.txt
[license]: https://polyfork.dev/licensing
[repo]: https://github.com/lucas-martinic/polyfork-catalog
[index-license]: https://github.com/lucas-martinic/polyfork-catalog/blob/main/LICENSE.md
[search]: https://polyfork.dev/api/assets?q=chair&free=1&sort=tris&per_page=2&fields=compact
[detail]: https://polyfork.dev/api/assets/armchair-980c7c
[me]: https://polyfork.dev/api/me
[glb]: https://polyfork.dev/cdn/armchair-980c7c.glb
