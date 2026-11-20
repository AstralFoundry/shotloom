import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { z } from 'zod';
import { requireAuth } from './auth';
import { env } from './env';
import { assertPublishedRelay } from './models';
import { badRequest } from './lib/errors';
import type { AppEnv } from './lib/types';
import type { GenerateOptions } from '../../harness/host/src/browserModelRelay';

const inputSchema = z.object({
  request: z.object({ model: z.string().min(1), messages: z.array(z.unknown()) }).passthrough(),
  profile: z.object({ api: z.enum(['openai-completions', 'openai-responses', 'anthropic-messages']),
    models: z.array(z.object({ id: z.string(), name: z.string(), input: z.array(z.enum(['text', 'image'])),
      contextWindow: z.number().int().positive().optional(), maxTokens: z.number().int().positive().optional(),
      reasoningEfforts: z.record(z.string(), z.string()).optional(), compat: z.object({ supportsReasoningEffort: z.boolean() }).optional(),
    })).min(1),
  }),
  images: z.array(z.object({ attachmentId: z.string().regex(/^sha256:[a-f0-9]{64}$/), data: z.string().max(28 * 1024 * 1024),
    mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']), bytes: z.number().int().positive().max(20 * 1024 * 1024),
    width: z.number().int().positive().max(16384), height: z.number().int().positive().max(16384), name: z.string().max(256).optional(),
  })).max(8).default([]),
});
export const agentApp = new Hono<AppEnv>();
agentApp.use('*', requireAuth);
agentApp.post('/model', async c => {
  const parsed = inputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw badRequest('Agent 模型请求格式无效');
  const { request, profile, images } = parsed.data;
  const model = profile.models.find(row => row.id === request.model);
  if (!model) throw badRequest('Agent 模型不在当前目录中');
  const path = profile.api === 'openai-responses' ? '/v1/responses' : profile.api === 'anthropic-messages' ? '/v1/messages' : '/v1/chat/completions';
  await assertPublishedRelay(new Request('http://relay.invalid' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: request.model }) }), path);
  const { createBrowserModelRelay } = await import('../../harness/host/dist/browserModelRelay.js');
  // 端点与 Key 仅来自服务端；客户端不能指定任意转发目标或认证头。
  const relay = await createBrowserModelRelay({ ...profile, models: [model], baseURL: new URL('/v1', env.GATEWAY_BASE_URL).href }, c.get('accessToken'), images);
  c.header('Content-Type', 'application/x-ndjson; charset=utf-8');
  c.header('X-Accel-Buffering', 'no');
  return stream(c, async output => {
    const control = new AbortController();
    output.onAbort(() => control.abort());
    const abort = () => control.abort();
    c.req.raw.signal.addEventListener('abort', abort, { once: true });
    try {
      if (c.req.raw.signal.aborted) control.abort();
      for await (const chunk of relay.stream({ ...request, provider: 'shotloom', signal: control.signal } as GenerateOptions)) {
        if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
          throw new Error('Model stream failed');
        }
        await output.writeln(JSON.stringify({ version: 1, chunk }));
      }
      await output.writeln(JSON.stringify({ version: 1, done: true }));
    } catch {
      // 上游异常可能携带 URL、请求或 Key，不回传原始异常内容。
      if (!control.signal.aborted) await output.writeln(JSON.stringify({ version: 1, error: { code: 'MODEL_REQUEST_FAILED', message: '模型调用失败，请核对模型权限、额度和网络后重试。' } }));
    } finally { c.req.raw.signal.removeEventListener('abort', abort); control.abort(); await relay.dispose(); }
  });
});
