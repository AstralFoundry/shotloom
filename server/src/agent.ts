import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { startDesktopHost } from '../../harness/host/src/desktopHost';
import type { nativeTransport } from '../../harness/host/src/nativeTransport';
import { requireAuth } from './auth';
import { env } from './env';
import { agentPersistence } from './lib/agentPersistence';
import { agentAttachments } from './lib/agentAttachments';
import { badRequest, notFound } from './lib/errors';
import { envelope } from './lib/respond';
import type { AppEnv } from './lib/types';
import { loadSession } from './lib/supabase';

type Runtime = Awaited<ReturnType<typeof startDesktopHost>>;
type Carrier = ReturnType<typeof nativeTransport>;
interface Connection {
  id: string; userId: string; sessionId: string; runtime: Runtime;
  send(value: unknown): void; carrier: Carrier; connected: boolean; close(): void;
  tools: Map<string, { resolve(value: unknown): void; reject(error: Error): void }>;
  queue: string[]; queuedBytes: number; wake?: () => void;
}
interface UserHost { runtime: Runtime; root: string; connections: Set<string>; owners: Map<string, Connection>; idle?: NodeJS.Timeout; closing?: Promise<void> }
const hosts = new Map<string, Promise<UserHost>>();
const connections = new Map<string, Connection>();
const role = z.enum(['canvas-primary', 'editor-primary', 'text-primary', 'director-primary']);
const bindingSchema = z.object({ projectKey: z.string().min(1), conversationId: z.string().min(1), agentId: role, nodeId: z.string().optional() });
const bindSchema = z.object({
  binding: bindingSchema, sessionId: z.string().optional(),
  tools: z.array(z.object({ name: z.string().regex(/^[a-zA-Z0-9_-]+$/), title: z.string().optional(), description: z.string(),
    parameters: z.record(z.string(), z.unknown()), roles: z.array(role),
    effect: z.enum(['read', 'write', 'generation', 'delete', 'overwrite', 'export']), approvalRequired: z.boolean().optional(),
  })),
  skills: z.array(z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/), description: z.string().optional(), instructions: z.string(),
    metadata: z.record(z.string(), z.unknown()).optional(), builtIn: z.boolean().optional(),
  })).optional(),
  providers: z.record(z.string().regex(/^[a-z][a-z0-9-]+$/), z.object({ profile: z.object({
    api: z.enum(['openai-completions', 'openai-responses', 'anthropic-messages']), displayName: z.string(),
    models: z.array(z.object({ id: z.string(), name: z.string(), contextWindow: z.number().int().positive().optional(),
      maxTokens: z.number().int().positive().optional(), input: z.array(z.enum(['text', 'image'])),
      reasoningEfforts: z.record(z.string(), z.string()).optional(), compat: z.object({ supportsReasoningEffort: z.boolean() }).optional(),
    })),
  }) })).optional(),
  defaultModel: z.object({ provider: z.string(), model: z.string(), reasoningEffort: z.string().optional() }).optional(),
});
const messageSchema = z.object({ requestId: z.string().uuid(), kind: z.enum(['fetch', 'stream', 'cancel', 'uplink']), payload: z.unknown().optional() });
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw badRequest('Agent 请求格式无效');
  return result.data;
}

async function userHost(userId: string): Promise<UserHost> {
  let pending = hosts.get(userId);
  if (!pending) {
    pending = (async () => {
      const root = await mkdtemp(join(tmpdir(), 'shotloom-agent-'));
      const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
      const owners = new Map<string, Connection>();
      const persistence = agentPersistence(userId, root);
      try {
        const { startDesktopHost } = await import('../../harness/host/dist/desktopHost.js');
        const runtime = await startDesktopHost({ dataRoot: root, contentRoot: join(projectRoot, 'renderer/src/agent/content'),
          rulesPath: join(projectRoot, 'AGENTS.md'), distIndex: '', persistence, clientToolsOnly: true,
          attachmentStorage: agentAttachments(userId, root),
          bridge: { authorize: true, receipts: persistence.host, dispatch: async (request, signal) => {
            const binding = request.binding as { sessionId: string };
            const connection = owners.get(binding.sessionId);
            if (!connection?.connected) throw new Error('客户端已断开，请重新连接后核验真实任务状态');
            const id = randomUUID();
            return new Promise((resolve, reject) => {
              const abort = () => { connection.tools.delete(id); reject(new Error('客户端工具调用已取消')); };
              signal.addEventListener('abort', abort, { once: true });
              connection.tools.set(id, {
                resolve(value) { signal.removeEventListener('abort', abort); resolve(value); },
                reject(error) { signal.removeEventListener('abort', abort); reject(error); },
              });
              if (signal.aborted) { abort(); return; }
              connection.send({ kind: 'tool', requestId: id, value: request });
            });
          } },
        });
        return { runtime, root, connections: new Set<string>(), owners };
      } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
    })().catch(error => { hosts.delete(userId); throw error; });
    hosts.set(userId, pending);
  }
  const host = await pending;
  if (host.closing) { await host.closing; return userHost(userId); }
  return host;
}

export const agentApp = new Hono<AppEnv>();
agentApp.use('*', requireAuth);
function scheduleIdleHost(userId: string, host: UserHost) {
  if (host.connections.size || host.idle) return;
  host.idle = setTimeout(() => {
    const current = hosts.get(userId);
    host.closing = host.runtime.host.dispose().then(() => rm(host.root, { recursive: true, force: true }))
      .finally(() => { if (hosts.get(userId) === current) hosts.delete(userId); });
    void host.closing.catch(() => console.error('[agent] Host cleanup failed'));
  }, 60_000).unref();
}
agentApp.post('/sessions/archive', async c => {
  const input = parse(z.object({ projectKey: z.string().min(1), sessionIds: z.array(z.string().min(1)).optional(), archived: z.boolean() }), await c.req.json());
  const userId = c.get('userId');
  const host = await userHost(userId);
  try { return c.json(envelope(await host.runtime.setSessionsArchived(input.projectKey, input.sessionIds, input.archived))); }
  finally { scheduleIdleHost(userId, host); }
});
agentApp.post('/connect', async c => {
  const userId = c.get('userId');
  const host = await userHost(userId);
  if (host.idle) { clearTimeout(host.idle); host.idle = undefined; }
  const { nativeTransport } = await import('../../harness/host/dist/nativeTransport.js');
  const id = randomUUID();
  const connection: Connection = {
    id, userId, sessionId: c.get('sessionId'), runtime: host.runtime, tools: new Map(), queue: [], queuedBytes: 0, connected: false,
    carrier: undefined!,
    send(value) {
      if (!connections.has(id)) return;
      const data = JSON.stringify(value);
      connection.queuedBytes += Buffer.byteLength(data);
      if (connection.queuedBytes > 32 * 1024 * 1024) { connection.close(); return; }
      connection.queue.push(data); connection.wake?.();
    },
    close() {
      if (!connections.delete(id)) return;
      connection.connected = false;
      connection.carrier.dispose();
      connection.wake?.();
      for (const tool of connection.tools.values()) tool.reject(new Error('客户端已断开'));
      connection.tools.clear();
      connection.queue.length = 0; connection.queuedBytes = 0;
      for (const [sessionId, owner] of host.owners) if (owner === connection) {
        host.runtime.host.ctx.agents.get(sessionId as never)?.cancel({ kind: 'user' });
        host.owners.delete(sessionId);
      }
      host.connections.delete(id);
      scheduleIdleHost(userId, host);
    },
  };
  connection.carrier = nativeTransport(host.runtime, value => connection.send(value));
  connections.set(id, connection); host.connections.add(id);
  // A client that never opens its event stream must not retain a Host indefinitely.
  setTimeout(() => { if (!connection.connected) connection.close(); }, 30_000).unref();
  connection.send({ kind: 'connected', requestId: id });
  return c.json(envelope({ id }));
});
function own(c: { req: { param(name: string): string | undefined }; get(name: 'userId' | 'sessionId'): string }): Connection {
  const connection = connections.get(c.req.param('id') || '');
  if (!connection || connection.userId !== c.get('userId') || connection.sessionId !== c.get('sessionId')) throw notFound('Agent 连接已失效');
  return connection;
}
agentApp.get('/:id/events', async c => {
  const connection = own(c);
  if (connection.connected) throw badRequest('Agent 事件流已经连接');
  connection.connected = true;
  return streamSSE(c, async stream => {
    c.header('X-Accel-Buffering', 'no');
    const heartbeat = setInterval(() => {
      void loadSession(connection.sessionId).then(session => {
        if (session?.userId !== connection.userId) connection.close(); else connection.send({ kind: 'heartbeat' });
      }, () => connection.close());
    }, 20_000);
    stream.onAbort(() => connection.close());
    try {
      while (connection.connected) {
        if (!connection.queue.length) await new Promise<void>(resolve => { connection.wake = resolve; });
        while (connection.queue.length && connection.connected) {
          const data = connection.queue.shift()!;
          connection.queuedBytes -= Buffer.byteLength(data);
          await stream.writeSSE({ data });
        }
      }
    } finally { clearInterval(heartbeat); connection.close(); }
  });
});
agentApp.post('/:id/bind', async c => {
  const connection = own(c);
  const config = parse(bindSchema, await c.req.json());
  if (config.sessionId && !await agentPersistence(connection.userId).sessions.find(config.sessionId)) {
    throw notFound('该 Agent 会话尚未迁入当前账号的云端，请导入原桌面历史或新建会话');
  }
  const providers = config.providers && Object.fromEntries(Object.entries(config.providers).map(([route, entry]) => [route, {
    key: connection.sessionId, profile: { ...entry.profile, baseURL: `http://127.0.0.1:${env.PORT}/api/relay/v1`,
      headers: { authorization: `Bearer ${connection.sessionId}`, 'x-shotloom-user': connection.userId },
    },
  }]));
  const result = await connection.runtime.bind({ ...config, providers });
  const host = await hosts.get(connection.userId)!;
  host.owners.set(result.sessionId, connection);
  return c.json(envelope(result));
});
agentApp.post('/:id/message', async c => {
  const connection = own(c);
  const message = parse(messageSchema, await c.req.json());
  if (!connection.connected) throw badRequest('请先连接 Agent 事件流');
  // Stream calls complete over SSE; holding this POST would deadlock the official uplink.
  void connection.carrier(message);
  return c.json(envelope(null));
});
agentApp.post('/:id/tool', async c => {
  const connection = own(c);
  const result = parse(z.object({ requestId: z.string().uuid(), result: z.unknown().optional(), error: z.string().optional() }), await c.req.json());
  const tool = connection.tools.get(result.requestId);
  if (!tool) throw notFound('工具调用已结束');
  connection.tools.delete(result.requestId);
  if (result.error) tool.reject(new Error(result.error)); else tool.resolve({ success: true, result: result.result });
  return c.json(envelope(null));
});
agentApp.delete('/:id', c => { own(c).close(); return c.json(envelope(null)); });

export function closeAgentSession(sessionId: string) {
  for (const connection of connections.values()) if (connection.sessionId === sessionId) connection.close();
}

export async function disposeAgentHosts() {
  for (const connection of connections.values()) connection.close();
  const pending = [...hosts.values()]; hosts.clear();
  for (const entry of pending) {
    const host = await entry;
    if (host.idle) clearTimeout(host.idle);
    await host.runtime.host.dispose();
    await rm(host.root, { recursive: true, force: true });
  }
}
