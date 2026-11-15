import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth, refreshSession } from './auth';
import { env } from './env';
import { admin } from './lib/supabase';
import { badRequest, conflict, HttpError, notFound, supabaseError } from './lib/errors';
import { envelope } from './lib/respond';
import { relayPath } from './lib/relay';
import type { AppEnv, Json } from './lib/types';
import { compilePublication, executionTemplates, modelTypes } from '../../shared/modelPublications';

const upstreamSchema = z.object({ data: z.array(z.object({
  id: z.string().min(1).refine(id => id.trim() === id && !/[\x00-\x20\\?#%]/.test(id)),
  owned_by: z.string().optional().default(''),
  supported_endpoint_types: z.array(z.string()).nullish().transform(value => value || []),
})) });
const editSchema = z.object({
  id: z.string().min(1), name: z.string().trim().max(200), type: z.enum(modelTypes).nullable(),
  template_id: z.string().nullable(), sort_order: z.number().int().min(-100000).max(100000),
  published: z.boolean(), revision: z.number().int().positive(),
});
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw badRequest(result.error.message);
  return result.data;
}
export async function fetchUpstreamModels(accessToken: string, sessionId: string) {
  const request = (token: string) => fetch(new URL('/v1/models', env.GATEWAY_BASE_URL), {
    headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  let response = await request(accessToken);
  if (response.status === 401) { await response.body?.cancel(); response = await request(await refreshSession(sessionId)); }
  if (!response.ok) throw new HttpError(502, 'UPSTREAM_MODELS', '无法读取当前账号的上游模型');
  const value = parse(upstreamSchema, await response.json());
  return [...new Map(value.data.map(item => [item.id, item])).values()];
}
async function publications() {
  const { data, error } = await admin.from('model_publications').select('*').eq('client_id', env.GATEWAY_CLIENT_ID).order('sort_order').order('id');
  if (error) throw supabaseError('无法读取模型发布配置');
  return data.map(({ client_id: _, ...row }) => row);
}
async function mutate(userId: string, action: string, value: unknown) {
  const { data, error } = await admin.rpc('manage_models', {
    p_client_id: env.GATEWAY_CLIENT_ID, p_actor_id: userId, p_action: action, p_value: value as Json,
  });
  if (error?.code === '40001') throw conflict('模型已被修改或同步，请刷新后重试');
  if (error) throw supabaseError('无法保存模型配置');
  return data;
}
export const modelsApp = new Hono<AppEnv>();
modelsApp.use('/models', requireAuth);
modelsApp.use('/admin/*', requireAuth);
modelsApp.get('/models', async c => {
  const [rows, upstream] = await Promise.all([publications(), fetchUpstreamModels(c.get('accessToken'), c.get('sessionId'))]);
  const available = new Map(upstream.map(model => [model.id, model]));
  const published = rows.filter(row => available.has(row.id) && compilePublication(row));
  return c.json(envelope({ publications: published, upstreamModels: published.map(row => available.get(row.id)!) }));
});
modelsApp.use('/admin/*', async (c, next) => {
  const { data, error } = await admin.from('app_admins').select('user_id')
    .eq('client_id', env.GATEWAY_CLIENT_ID).eq('user_id', c.get('userId')).maybeSingle();
  if (error) throw supabaseError('无法校验管理员权限');
  if (!data) throw new HttpError(403, 'ADMIN_REQUIRED', '此账号没有 Shotloom 管理员权限');
  await next();
});
modelsApp.get('/admin/me', c => c.json(envelope({ userId: c.get('userId') })));
modelsApp.get('/admin/users', async c => {
  const query = parse(z.object({
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(200).default(''),
  }).strict(), c.req.query());
  const { data, error } = await admin.rpc('list_admin_users', {
    p_client_id: env.GATEWAY_CLIENT_ID, p_actor_id: c.get('userId'), p_query: query.search,
    p_offset: (query.page - 1) * query.pageSize, p_limit: query.pageSize,
  });
  if (error?.code === '42501') throw new HttpError(403, 'ADMIN_REQUIRED', '此账号没有 Shotloom 管理员权限');
  if (error) throw supabaseError('无法读取用户列表');
  return c.json(envelope(data));
});
modelsApp.put('/admin/users/:id/admin', async c => {
  const userId = parse(z.string().uuid(), c.req.param('id'));
  let value: unknown;
  try { value = await c.req.json(); } catch { throw badRequest('请求体不是合法 JSON'); }
  const input = parse(z.object({ is_admin: z.boolean(), expected_admin: z.boolean() }).strict(), value);
  const { data, error } = await admin.rpc('set_app_admin', {
    p_client_id: env.GATEWAY_CLIENT_ID, p_actor_id: c.get('userId'), p_user_id: userId,
    p_is_admin: input.is_admin, p_expected_admin: input.expected_admin,
  });
  if (error?.code === '42501') throw new HttpError(403, 'ADMIN_REQUIRED', '此账号没有 Shotloom 管理员权限');
  if (error?.code === 'P0002') throw notFound('当前应用中没有此用户');
  if (error?.code === '40001') throw conflict('用户权限已被修改，请刷新后重试');
  if (error?.code === '23514') throw conflict('不能撤销最后一位管理员');
  if (error) throw supabaseError('无法修改管理员权限');
  return c.json(envelope(data));
});
modelsApp.get('/admin/models', async c => c.json(envelope({ models: await publications(),
  templates: executionTemplates.map(({ id, name, type, provider }) => ({ id, name, type, provider })),
})));
modelsApp.get('/admin/audit', async c => {
  const { data, error } = await admin.from('admin_audit').select('id,actor_id,action,model_id,details,created_at')
    .eq('client_id', env.GATEWAY_CLIENT_ID).order('id', { ascending: false }).limit(100);
  if (error) throw supabaseError('无法读取审计日志');
  return c.json(envelope(data));
});
modelsApp.post('/admin/models/sync', async c => c.json(envelope(await mutate(c.get('userId'), 'sync',
  await fetchUpstreamModels(c.get('accessToken'), c.get('sessionId'))))));
modelsApp.put('/admin/models', async c => {
  let value: unknown;
  try { value = await c.req.json(); } catch { throw badRequest('请求体不是合法 JSON'); }
  const edit = parse(editSchema, value);
  if (edit.template_id && !executionTemplates.some(template => template.id === edit.template_id && template.type === edit.type)) {
    throw badRequest('执行适配模板与模型类型不匹配');
  }
  if (edit.published && (!edit.name || !compilePublication({ ...edit, available: true, owned_by: '', supported_endpoint_types: [] }))) {
    throw badRequest('发布前必须填写名称、类型和执行适配模板');
  }
  return c.json(envelope(await mutate(c.get('userId'), 'save', edit)));
});

// GET is limited to model discovery and existing task/result reads, including after unpublishing.
export async function assertPublishedRelay(request: Request, path: string) {
  if (['GET', 'HEAD'].includes(request.method)) {
    if (path === '/v1/models' || /^\/v1\/(?:videos|tasks|files)\/[^/]+(?:\/content)?$/.test(path)
      || /^\/api\/v3\/contents\/generations\/tasks\/[^/]+$/.test(path)
      || /^\/hailuo\/v[12]\/(?:query\/video_generation\/[^/]+|files\/retrieve)$/.test(path)
      || /^\/kling\/v1\/videos\/(?:text2video|image2video)\/[^/]+$/.test(path)) return;
    throw new HttpError(403, 'MODEL_NOT_PUBLISHED', '此模型接口尚未发布');
  }
  let model: unknown;
  try {
    if (request.headers.get('content-type')?.includes('multipart/form-data')) model = (await request.clone().formData()).get('model');
    else model = (await request.clone().json() as { model?: unknown }).model;
  } catch { throw badRequest('模型请求必须包含有效的 model 字段'); }
  if (typeof model !== 'string' || !model) throw badRequest('模型请求缺少 model');
  const { data, error } = await admin.from('model_publications').select('*')
    .eq('client_id', env.GATEWAY_CLIENT_ID).eq('id', model).maybeSingle();
  if (error) throw supabaseError('无法校验模型发布状态');
  const contract = data && compilePublication(data);
  const endpoints = contract?.modes.flatMap(mode => {
    const agent = mode.agent;
    const agentPath = agent?.transport === 'openai-responses' ? '/responses'
      : agent?.transport === 'anthropic-messages' ? '/v1/messages' : '/chat/completions';
    return [mode.endpoint, ...(agent ? [agent.endpoint || { method: 'POST', path: agentPath, scope: 'v1' }] : [])];
  }) || [];
  if (!contract || !endpoints.some(endpoint => endpoint.method === request.method
    && relayPath(endpoint.path, contract.provider, endpoint.scope) === path)) {
    throw new HttpError(403, 'MODEL_NOT_PUBLISHED', '模型未发布或执行接口不匹配');
  }
}
