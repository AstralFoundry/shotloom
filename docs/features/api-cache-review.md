# API 缓存审查（2026-11-16）

本清单依据当前源码与部署配置，不代表已测得生产接口 P95、调用量或缓存命中率。此次仅审查，未接入 KV、修改数据库或改变接口行为。

## 建议先做的缓存

| 优先级 | 数据与入口 | 当前开销 | 初始 TTL 建议 | 隔离与失效 |
| --- | --- | --- | --- | --- |
| P1 | `/models` 的上游可用模型 | 每次调用 new-api `/v1/models`，随后与发布配置交集；见 `server/src/models.ts:27`、`:53` | 30–60 秒 | 按应用、用户及授权上下文隔离；授权变化或主动同步绕过缓存；禁止共享不同用户的模型列表 |
| P1 | 模型发布配置的展示读取 | `/models` 与后台模型列表反复查询 `model_publications`；见 `server/src/models.ts:37`、`:97` | 1–5 分钟 | 按 client_id 隔离；后台 save/sync 成功后失效，避免并发旧请求重新填回旧版本 |
| P1 | 下载签名：`/files/sign`、`/files/content` | 每次调用 Storage 签名；content 路径签名有效期仅 300 秒；见 `server/src/domain.ts:303`、`:313` | content 先用 120–240 秒；sign 必须早于签名到期 | 按应用、用户、bucket、完整对象 key 与签名策略隔离；命中前仍鉴权、校验路径；删除成功后失效；仅缓存 URL，不缓存媒体正文或上传签名 |
| P2 | `/auth/topup/options` | 每次读取上游 `/api/status` 中的充值比例；见 `server/src/lib/gateway.ts:125` | 5 分钟 | 按上游地址和应用隔离；确认比例是否与用户无关；只缓存展示配置，创建支付仍走实时接口 |
| P2 | `/auth/account` 与 `/auth/usage` | 每次分别请求上游账号和消费记录；见 `server/src/auth.ts:175`、`:177` | 展示 5–15 秒 | 按应用、用户及授权上下文隔离；usage 包含页码、页大小；手动刷新绕过；生成、充值后刷新；不得用于扣费或授权判断 |

以上 TTL 是待验证的起点，不是既定性能结论。充值、生成可能由其他端触发，不能仅依赖本端操作后清缓存，TTL 仍须兜底。

## 暂不加通用结果缓存

- 会话、账号归属和管理员权限：撤销后应及时生效。`loadSession` 每次分别查 sessions 和 users（`server/src/lib/supabase.ts:89`）；优先合并为一次数据库查询，同时保留应用归属、有效期和注销校验。现有 refresh Promise 合并只适用于单进程，不等于跨实例锁。
- 生成时的模型发布校验：`assertPublishedRelay`（`server/src/models.ts:122`）属于执行权限边界。展示列表允许短暂陈旧，执行时仍须实时确认模型未下架和端点匹配。
- 项目正文、bundle、编辑器快照：依赖 revision 与保存顺序。避免普通 TTL 造成刚保存后读旧数据。需要时设计按 revision 的快照缓存，先验证真实瓶颈。
- `/projects`、`/library-folders`、`/recent`：先做客户端请求合并或短期页面复用；增删改、移动、导入、克隆和自动保存都会改变列表，服务端缓存失效面较广。
- `/settings`、`/catalog/:kind`：数据本身就在 Postgres，先确认加载频率与响应体大小。写入后须同步刷新多个端，不宜直接套长 TTL。
- 反馈详情、通知列表和未读数：回复、已读、全部已读存在事务和快照语义（`server/src/support.ts:29`、`:61`）。当前客户端主要在进入页面、恢复前台和手动刷新时请求（`renderer/src/app/components/SupportCenter.tsx:131`），未见高频定时轮询证据，首批缓存收益有限。
- OAuth 交换/刷新、支付创建、生成 POST、Agent 消息与 SSE：不是普通 GET 结果缓存。幂等回执属于业务事实，不能用可被淘汰的缓存替代持久记录。

## 缓存不能替代的启动修复

`renderer/src/services/cloudApi.ts:241` 将 settings、auth/account、models 放在同一个 Promise.all 中，`ReactWorkbench.tsx:146` 等待其完成后才加载项目。账号或上游模型接口失败会使整段初始化失败。

应将读取项目所需的设置与账号额度、模型发现的加载分开：项目可打开，额度失败展示未知和重试，模型能力未确认时禁止发起依赖它的生成。避免把一次历史缓存命中当作登录或生成权限证明。

## Supabase KV 的选择

如果 KV 指自建 Postgres key/value 表，它仍会访问同一个数据库，适合保存昂贵上游请求的结果或预计算聚合，不一定能减少原有简单数据库读取的往返和负载。

当前 compose 只声明一个 app 服务（`server/compose.yaml`）。首版建议在服务端采用容量有上限的 TTL 内存缓存，加相同 key 的并发请求合并；多实例需要共享缓存和一致失效时，再选 Redis/Upstash，或者在明确接受数据库开销后使用 Postgres KV。Supabase 官方提供独立 Upstash Redis 集成示例：<https://supabase.com/docs/guides/functions/examples/upstash-redis>。

实施时保持 `/api/*` 的 `Cache-Control: no-store`（`server/src/index.ts:23`）；内部数据缓存不等于允许浏览器或公共 CDN 缓存用户数据。仅缓存成功结果；认证失败不回退旧权限；缓存故障可回源，源站鉴权失败不得放行。后端 KV 凭据仅留在服务端。

先记录接口耗时、上游耗时、命中/未命中、并发合并、淘汰与加载失败，再依据数据调整 TTL 和容量。
