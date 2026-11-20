import { startDesktopHost } from '../src/desktopHost.ts';
import { nativeTransport } from '../src/nativeTransport.ts';
import { browserPersistence } from './persistence.mjs';

export async function boot() {
  const bridge = globalThis.shotloomBrowserHost;
  const persistence = browserPersistence();
  const runtime = await startDesktopHost({ dataRoot: '/dsh/state', contentRoot: '/dsh/content', rulesPath: '/dsh/content/AGENTS.md',
    clientToolsOnly: true, distIndex: '', persistence,
    bridge: { authorize: true, receipts: persistence.host, async dispatch(request, signal) {
      await bridge.beforeEffect();
      const receipt = await bridge.tool(request, signal);
      await bridge.barrier();
      return { success: true, result: receipt };
    } },
  });
  bridge.flush = () => runtime.host.ctx.sessionPersistence.flush();
  const enabled = new Set();
  runtime.host.ctx.on('agent/pre-step', async ({ agent }, next) => {
    const binding = runtime.host.binding(String(agent.session.id));
    return enabled.has(String(agent.session.id)) || enabled.has(binding?.parentSessionId)
      ? next() : { kind: 'reject', reason: '会话已中断，请发送消息或点击继续。' };
  }, { prepend: true });
  const transport = nativeTransport(runtime, message => bridge.send(message));
  return {
    async receive(message) {
      if (message.kind === 'fetch') {
        const path = new URL(message.payload.path, 'http://native.invalid').pathname;
        if (['session/prompt', 'commands/execute', 'goals/create', 'goals/resume'].some(endpoint => path.endsWith('/' + endpoint))) {
          const body = JSON.parse(Buffer.from(message.payload.body, 'base64').toString('utf8'));
          const args = body.payload?.args;
          const sessionId = args?.request?.sessionId ?? args?.sessionId ?? args?.agentId;
          if (typeof sessionId !== 'string') throw new Error('Agent continuation requires an explicit session');
          await bridge.beforeEffect(); enabled.add(sessionId);
        }
      }
      await transport(message);
      await bridge.barrier();
    },
    async bind(config) {
      // 旧云端/桌面会话不冒充本地历史；保留原记录，由画布保存新的本地 ID。
      const bindings = await persistence.host.bindings();
      const saved = bindings.find(row => ['projectKey', 'conversationId', 'agentId', 'nodeId'].every(key => row[key] === config.binding[key]));
      config = { ...config, sessionId: saved?.sessionId };
      const result = await runtime.bind(config);
      await runtime.host.ctx.sessionPersistence.flush();
      await bridge.barrier();
      return result;
    },
    async archive(projectKey, sessionIds, archived) {
      if (archived) for (const id of sessionIds ?? enabled) enabled.delete(id);
      const result = await runtime.setSessionsArchived(projectKey, sessionIds, archived);
      await runtime.host.ctx.sessionPersistence.flush();
      await bridge.barrier();
      return result;
    },
    async dispose() { enabled.clear(); transport.dispose(); await runtime.host.dispose(); await bridge.barrier(); },
  };
}
