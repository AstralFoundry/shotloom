import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from './auth';
import { env } from './env';
import { admin } from './lib/supabase';
import { badRequest, conflict, HttpError, notFound, supabaseError } from './lib/errors';
import { envelope } from './lib/respond';
import type { AppEnv, Json } from './lib/types';

const idSchema = z.string().uuid();
const kindSchema = z.enum(['feedback', 'report']);
const statusSchema = z.enum(['pending', 'processing', 'resolved']);
const pageSchema = z.object({
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  kind: kindSchema.optional(), status: statusSchema.optional(),
}).strict();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw badRequest('请求字段无效');
  return parsed.data;
}
async function body(request: { json: () => Promise<unknown> }) {
  try { return await request.json(); } catch { throw badRequest('请求体不是合法 JSON'); }
}
async function action(actor: string, name: string, value: unknown) {
  const { data, error } = await admin.rpc('support_action', {
    p_client_id: env.GATEWAY_CLIENT_ID, p_actor_id: actor, p_action: name, p_value: value as Json,
  });
  if (error?.code === '42501') throw new HttpError(403, 'FORBIDDEN', '没有此操作的权限');
  if (error?.code === 'P0002') throw notFound('记录不存在或无权访问');
  if (error?.code === '40001' || error?.code === '23505') throw conflict('记录或请求内容已变更，请刷新后重试');
  if (error?.code === '22023' || error?.code === '23514') throw badRequest('请求字段无效');
  if (error) throw supabaseError('反馈或通知操作未完成，请重试');
  return data;
}
export const supportApp = new Hono<AppEnv>();
supportApp.use('/feedback/*', requireAuth);
supportApp.use('/notifications/*', requireAuth);
// Administrator membership is checked inside the same transaction as each operation.
supportApp.use('/admin/feedback/*', requireAuth);
supportApp.post('/feedback', async c => c.json(envelope(await action(c.get('userId'), 'submit', parse(z.object({
  id: idSchema, kind: kindSchema, description: z.string().trim().min(1).max(10000),
  reference: z.string().trim().max(1000).default(''),
}).strict(), await body(c.req)))), 201));
for (const [path, prefix] of [['/feedback', ''], ['/admin/feedback', 'admin_']] as const) {
  supportApp.get(path, async c => c.json(envelope(await action(c.get('userId'), `${prefix}list`, parse(pageSchema, c.req.query())))));
  supportApp.get(`${path}/:id`, async c => c.json(envelope(await action(c.get('userId'), `${prefix}detail`, { id: parse(idSchema, c.req.param('id')) }))));
}
supportApp.post('/admin/feedback/:id/replies', async c => c.json(envelope(await action(c.get('userId'), 'reply', {
  ...parse(z.object({ replyId: idSchema, body: z.string().trim().min(1).max(10000) }).strict(), await body(c.req)),
  id: parse(idSchema, c.req.param('id')),
})), 201));
supportApp.put('/admin/feedback/:id/status', async c => c.json(envelope(await action(c.get('userId'), 'status', {
  ...parse(z.object({ status: statusSchema, revision: z.number().int().positive() }).strict(), await body(c.req)),
  id: parse(idSchema, c.req.param('id')),
}))));
supportApp.get('/notifications', async c => c.json(envelope(await action(c.get('userId'), 'inbox', parse(pageSchema.pick({ offset: true, limit: true }), c.req.query())))));
supportApp.put('/notifications/read-all', async c => c.json(envelope(await action(c.get('userId'), 'read_all',
  parse(z.object({ asOf: z.string().datetime({ offset: true }) }).strict(), await body(c.req))))));
supportApp.put('/notifications/:id/read', async c => c.json(envelope(await action(c.get('userId'), 'read', { id: parse(idSchema, c.req.param('id')) }))));
