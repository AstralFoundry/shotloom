# 模型管理后台

入口：与客户端同站点的 `/admin`。复用 New API 登录和 Shotloom BFF 会话，管理员身份由私有 `shotloom.app_admins` 表授予，与上游管理员身份分开。

## 启用

先应用 `supabase/migrations/20261115131802_shotloom_model_administration.sql`。首次管理员必须先登录 Shotloom，再由数据库运维执行以下 SQL；把两个参数替换为实际 OAuth client ID 和 New API 用户数字 ID。不要使用用户名或可编辑的用户 metadata 授权。

```sql
begin;
with granted as (
  insert into shotloom.app_admins(client_id,user_id)
  select client_id,id from shotloom.users
  where client_id = 'YOUR_CLIENT_ID' and sub = 'YOUR_NEWAPI_USER_ID'
  on conflict do nothing returning client_id,user_id
)
insert into shotloom.admin_audit(client_id,actor_id,action,details)
select client_id,user_id,'bootstrap',jsonb_build_object('source','database operator') from granted;
commit;
```

确认授权确实命中一位已登录用户：

```sql
select u.client_id,u.sub,u.username from shotloom.app_admins a
join shotloom.users u on u.id = a.user_id and u.client_id = a.client_id;
```

日常授权和撤销管理员使用后台“用户管理”，保留最后管理员保护、并发校验与审计。每次管理请求重新检查权限。

## 发布流程

1. 管理员点击“同步上游模型”，使用自己的 OAuth token 读取 New API `/v1/models`。因此同步范围为该管理员在上游可访问的模型；应使用具有完整目标模型权限的管理账号。
2. 新模型默认未发布。同步保留显示名称、类型、模板、排序与发布开关，消失的模型保留记录并标记不可用。同步失败不会修改数据。
3. 选择文本、图片、视频或音频类型，选择现有声明式执行模板，填写名称、排序并发布。类型和模板必须匹配。模板决定参数和能力，管理员还需确认实际协议兼容；未适配协议需先在代码目录增加受支持的模板。
4. 客户端重新加载设置后，只安装“已发布且配置完整 ∩ 当前用户上游可用”的模型契约。内置模型仅作为执行模板，原始上游 ID 始终保留，不生成厂商别名。后台更新后已打开的客户端需刷新；服务端立即执行新的发布状态。

`/api/models` 提供发布配置和当前用户可用的上游信息；`/api/admin/models`、`/api/admin/models/sync`、`/api/admin/audit` 均由服务端鉴权。所有表仅允许 BFF service_role 访问，启用 RLS，不向浏览器暴露服务密钥。

同步与保存通过同一数据库函数串行提交，并在同一事务写入审计日志；revision 冲突返回 409，刷新后再保存。日志界面显示最近 100 条。

生成请求（包括原生 Harness）必须在服务端匹配已发布模型与模板接口，上游继续执行当前用户的模型权限检查。既有异步任务的只读查询和结果下载可继续使用，不因下架中断。

首次迁移不自动发布任何模型：必须先授权管理员、同步、配置和发布，再让用户升级到依赖该目录的客户端，否则模型选择列表为空。

2026-11-15 已按用户要求在当前 Supabase 项目应用迁移、验证并完成首次配置，未部署应用。分类清单保存在 `server/seeds/model-classification.json`，是人工核对的本次快照，不用于自动推断后续新增模型。39 个模型中：文本 25、图片 7、视频 5、音频 2；其中 25 个文本与 3 个 GPT 图片模型配置模板并发布，其余 11 个已分类、待适配、未发布。基础 Chat Completions 模板只声明文本协议，不额外承诺视觉输入或 Agent 工具调用；DeepSeek 使用其已有工具模板。此过程未执行付费生成。

数据库回归校验：`server/tests/model-publications.sql` 覆盖同步、下架保留、乐观锁、审计原子性、应用隔离、权限和发布约束，事务结束后回滚测试数据。

2026-11-15 应用已部署，发布号 `20261115-rebase-mobile-151905`。浏览器打开 `/admin` 返回 200 并显示模型管理页面；普通已登录测试账号访问 `/api/admin/me` 和 `/api/admin/models` 均返回 `403 ADMIN_REQUIRED`，`/api/models` 返回 200 和 28 个已发布模型。本次只读验收未修改发布配置，管理员保存和同步操作尚未在该线上版本执行。

## 用户与管理员管理

应用 `supabase/migrations/20261115142227_shotloom_user_administration.sql` 后，后台提供当前应用用户的搜索、分页与管理员授权/撤销。用户需要先通过 New API 登录 Shotloom，才会出现在本应用用户列表中；这里管理的是 Shotloom 权限，不改变 New API 平台角色。

用户列表只返回基本资料和角色，不返回会话或上游凭据。服务端从登录会话确定操作者与应用范围。角色变更使用预期角色校验以避免并发覆盖，与模型配置使用同一应用锁，并在事务内记录审计。最后一位管理员不能被撤销；撤销自己的角色后立即退出管理界面。日常授权和撤销应通过后台进行。

2026-11-15 已核验以下两个账号拥有 Shotloom 管理权限：New API ID 1（用户名 `854771076`）和 ID 2（邮箱 `854771076@qq.com`）。真实 BFF 用户搜索与权限查询均已通过。

后台沿用应用的深浅主题与组件，提供文本、图片、视频、音频分类概览及模型搜索/筛选。手机端将表格行纵向展示，保留每个字段标签、操作按钮与分页；模型编辑弹窗适配屏幕宽高。

验证：`server/tests/admin-users.sql` 在当前 Supabase 项目内以回滚事务覆盖应用隔离、普通用户拒绝访问、最后管理员保护、角色冲突、自我撤权与审计；HTTP 回归测试覆盖参数验证及数据库错误状态映射。

浏览器验证覆盖 375、768、1024、1440 像素宽度、手机横屏、深色主题与减少动画设置；模型搜索、用户搜索及模型编辑预填均已检查，三个管理页面没有整页横向溢出。

## RunningHub 网关模板

后台新增两个 New API 兼容模板：

| 上游模型 ID | 类型 | 执行模板 ID |
| --- | --- | --- |
| `minimax-h3-reference-to-video` | 视频 | `newapi-runninghub-minimax-h3-reference-to-video` |
| `krea2-normal-v1` | 图片 | `newapi-runninghub-krea2-normal-v1` |

模板保存在 `shared/runninghubGatewayTemplates.json`，复用 OpenAI 声明式适配器，通过当前用户的 New API 凭据调用网关。原有 RunningHub 直连工作流模板不进入后台发布列表。部署后，管理员同步上游模型并选择对应模板发布；本次代码变更不自动发布模型。

MiniMax H3 使用 `/v1/videos`，支持 5–15 秒、16:9 / 9:16、480p / 720p / 1K / 2K，提供纯文本和最多 4 张参考图片两种模式。参考图通过 multipart 文件上传，不把 URL 当作已经上传的文件；当前模板不开放视频和音频参考输入。任务通过 `GET /v1/videos/{taskId}` 轮询，完成后经带身份校验的 `/v1/videos/{taskId}/content` 下载。Krea2 使用 `/v1/images/generations`，支持单张图片、1K / 2K 和插件声明的七种比例。

渠道使用 RunningHub Task Plugin，内置“渠道测试”不支持此类型。需实际提交最小生成请求验证，并继续检查任务结果；有错误回执时不能宣称已生成成功。还需在 New API 配置计费，并把两个模型映射到真实 RunningHub workflow ID。

验证：`tests/runninghub-gateway.test.mjs` 覆盖实际适配器的图片提交、多参考图 multipart、视频轮询、失败信息和鉴权下载描述；`server/tests/runninghub-templates.test.ts` 覆盖发布编译与允许的网关路由。

2026-11-21 线上渠道检查：渠道 12（RunningHub，type 61）配置了这两个模型；Task Plugin 已为 1.0.1，使用渠道保存的 `.cn` 地址。经用户授权，仅新增 `billing_setting.plugin_billing_expr` 的两条规则，初始售价为 $0.002/RH 币：

```text
runninghub::minimax-h3-reference-to-video = tier("RH coins", (u("coins") ?? 200) * 0.002)
runninghub::krea2-normal-v1 = tier("RH coins", (u("coins") ?? 15) * 0.002)
```

提交时插件尚未提供币耗，分别预扣 $0.40 / $0.03（最终还应用账号分组倍率），完成后用实际币耗重新结算；成功任务缺少币耗回执时保留预扣价。该价格是本站初始售价，不是已核实的上游采购成本。

价格配置回读及最小生成请求均已验证。当前生成仍被工作流映射阻塞：未配置映射时返回 RunningHub `404 NOT_FOUND`；仓库旧 H3 workflow ID `2086743729407733762` 返回 `380 workflow not exists`，测试后已撤销该无效映射。尚需两个模型当前账号可访问的真实 workflow ID。最近失败请求的网关日志 quota 均为 0；没有成功任务或媒体产物，实际币耗结算尚未实测。未部署本次 Shotloom 模板变更，也未发布线上模型。
