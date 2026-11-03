import type { createHost } from './createHost.js';
import WebServer from '@deepseek-ai/dsh-host-webserver';
import * as Connection from '@deepseek-ai/dsh-client-connection';
import Registry from '@deepseek-ai/dsh-typert-registry';
import Gateway from '@deepseek-ai/dsh-api-gateway';
import * as Remotes from '@deepseek-ai/dsh-api-remotes';
import Storage from '@deepseek-ai/dsh-storage';
import * as SqliteStorage from './sqliteDomainStorage.js';
import * as DomainStorage from '@deepseek-ai/dsh-storage-domain';
import Workspace from '@deepseek-ai/dsh-workspace';
import FileUpload from '@deepseek-ai/dsh-client-file-upload';
import SessionController from '@deepseek-ai/dsh-api-session-controller';
import WorkspaceController from '@deepseek-ai/dsh-api-workspace-controller';
import SettingsController from '@deepseek-ai/dsh-api-settings-controller';
import DefaultModel from '@deepseek-ai/dsh-agent-default-model';
import * as Frontend from '@deepseek-ai/dsh-host-frontend-static';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';

/** Official RPC/stream transport. Product provisioning stays outside chat RPC. */
export async function startWebHost(host: Awaited<ReturnType<typeof createHost>>, options: {
  dataRoot: string;
  distIndex: string;
  port?: number;
  defaultModel?: { provider: string; model: string };
}) {
  const { ctx } = host;
  await ctx.plugin(Registry);
  for (const pkg of [
    'dsh-api-session-controller', 'dsh-api-workspace-controller',
    'dsh-api-settings-controller', 'dsh-user-questions', 'dsh-goal',
    'dsh-client-file-upload', 'dsh-subagent', 'dsh-commands', 'dsh-llm', 'dsh-permission-presets',
  ]) {
    const { TYPERT } = await import(`@deepseek-ai/${pkg}/typert`);
    ctx.typert.register(TYPERT);
  }
  await ctx.plugin(Storage);
  await ctx.plugin(SqliteStorage, { path: join(options.dataRoot, 'agent.sqlite') });
  await ctx.plugin(DomainStorage, { backend: 'sqlite' });
  await ctx.plugin(Workspace);
  await ctx.plugin(Connection);
  await ctx.plugin(FileUpload);
  await ctx.plugin(DefaultModel, options.defaultModel ?? { provider: 'deepseek', model: 'deepseek-chat' });
  await ctx.plugin(SessionController, { nativeOpen: false });
  await ctx.plugin(WorkspaceController);
  await ctx.plugin(SettingsController);
  await ctx.plugin(Gateway);
  await ctx.plugin(Remotes);
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: options.port ?? 0 });
  const frontendRoot = dirname(options.distIndex);
  const graph = JSON.parse(await readFile(join(frontendRoot, 'boot.json'), 'utf8')) as {
    entries: { id: string; rev: string }[];
  };
  const bundles = new Map(graph.entries.map(row => [`/plugins/??${row.id}/client.js&rev=${row.rev}`, join(frontendRoot, 'plugins', row.id, 'client.js')]));
  ctx.webServer.register({ kind: 'prefix', path: '/plugins', handler: async (req, res) => {
    const file = bundles.get(req.url ?? '');
    if (!file || (req.method !== 'GET' && req.method !== 'HEAD')) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : await readFile(file));
  } });
  await ctx.plugin(Frontend, { distIndex: options.distIndex });
  return { url: ctx.connection.authenticatedUrl(`http://127.0.0.1:${ctx.webServer.port}/`) };
}
