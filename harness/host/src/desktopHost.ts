import { openDatabase } from './db/connection.js';
import { HostCrud } from './crud/hostCrud.js';
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { timingSafeEqual, createHash } from 'node:crypto';
import { join } from 'node:path';
import { createHost, type SessionBinding } from './createHost.js';
import { registerProductTools, type ProductTool, type ProductBridge } from './productTools.js';
import { startWebHost } from './webHost.js';
import * as SkillFiles from '@deepseek-ai/dsh-skill-filesystem';
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import type { Context } from '@deepseek-ai/cordis';

type BindingInput = Omit<SessionBinding, 'sessionId'>;
interface ProductSkill { id: string; description?: string; instructions: string; metadata?: Record<string, unknown>; builtIn?: boolean }
interface Catalog { binding: BindingInput; tools: ProductTool[]; skills?: ProductSkill[] }
interface ProviderConfig { key: string; profile: PiAi.PiAiProviderProfile }
const key = (binding: BindingInput) => JSON.stringify([binding.projectKey, binding.conversationId, binding.agentId, binding.nodeId ?? '']);

/** Private desktop composition endpoint. Only the native shell holds its secret. */
export async function startDesktopHost(options: {
  dataRoot: string; contentRoot: string; rulesPath: string; distIndex: string;
  bridge: ProductBridge;
}) {
  const database = openDatabase(join(options.dataRoot, 'agent.sqlite'));
  const hostCrud = new HostCrud(database);
  const supportPolicy = JSON.parse(await readFile(join(options.contentRoot, 'openreel-agent-policy.json'), 'utf8')) as { excludedTools: Record<string, string> };
  const excludedTools = new Set(Object.keys(supportPolicy.excludedTools).map(name => `openreel_${name}`));
  const supportedTools = (tools: ProductTool[]) => tools.filter(tool => !excludedTools.has(tool.name));
  const catalogs = new Map<string, Catalog>();
  const skillProviders = new Map<string, { scope: Context; plugin: Awaited<ReturnType<Context['plugin']>> }>();
  const toolRegistrations = new Map<string, { scope: Context; dispose: () => void }>();
  for (const row of hostCrud.catalogs() as unknown as Catalog[]) catalogs.set(key(row.binding), { ...row, tools: supportedTools(row.tools) });
  const skillPath = (binding: BindingInput) => join(options.dataRoot, 'product-skills', createHash('sha256').update(key(binding)).digest('hex'));
  const host = await createHost({ ...options, scopedSkills: true, async registerTools(scope, binding) {
    const canonical = binding.toolSessionId ? host.binding(binding.toolSessionId) : binding;
    if (!canonical || canonical.agentId !== binding.agentId || canonical.projectKey !== binding.projectKey || canonical.nodeId !== binding.nodeId) {
      throw new Error('Delegated editor binding is unavailable');
    }
    const catalog = catalogs.get(key(canonical));
    if (!catalog) throw new Error('Session has no trusted product tool catalog');
    const plugin = await scope.plugin(SkillFiles, { includeDefaultRoots: false, customSkillDirs: [skillPath(canonical)], watch: true });
    const dispose = registerProductTools(scope, canonical, catalog.tools, { ...options.bridge, receiptRoot: options.dataRoot }, binding.toolSessionId ? {
      callerSessionId: binding.sessionId,
      approvalAgent: () => host.ctx.agents.get(binding.parentSessionId as import('@deepseek-ai/dsh-session').SessionId),
    } : undefined);
    if (!binding.toolSessionId) {
      skillProviders.set(key(binding), { scope, plugin });
      toolRegistrations.set(key(binding), { scope, dispose });
    }
  } });
  host.ctx.effect(() => () => database.close());
  try {
    const web = await startWebHost(host, options);
    host.ctx.on('webserver/index-inject', table => {
      table.push({ kind: 'global', name: '__SHOTLOOM_TOOL_NAMES__', value: [...new Set([...catalogs.values()].flatMap(row => row.tools.map(tool => tool.name)))] });
      table.push({ kind: 'global', name: '__SHOTLOOM_TOOL_TITLES__', value: Object.fromEntries([...catalogs.values()].flatMap(row => row.tools.map(tool => [tool.name, tool.title || tool.name]))) });
    });
    const origin = new URL(web.url).origin;
    const owners = new Map<string, Awaited<ReturnType<typeof host.create>>>();
    // This queue serializes composition and catalog writes, never model turns.
    let composition = Promise.resolve();
    let modelPlugin: Awaited<ReturnType<Context['plugin']>> | undefined;
    let modelConfig = '';
    host.ctx.webServer.register({ kind: 'exact', path: '/shotloom/session', async handler(req, res) {
      const supplied = Buffer.from(req.headers.authorization ?? '');
      const expected = Buffer.from(`Bearer ${options.bridge.token}`);
      if (req.method !== 'POST' || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        res.writeHead(403).end(); return;
      }
      try {
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 4 * 1024 * 1024) throw new Error('Product session configuration too large');
          chunks.push(chunk);
        }
        const request = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Catalog & { sessionId?: string; defaultModel?: { provider: string; model: string; reasoningEffort?: string }; providers?: Record<string, ProviderConfig> };
        const work = composition.then(async () => {
          const { binding } = request;
          if (!binding || !Array.isArray(request.tools)) throw new Error('Binding and named product tools are required');
          const tools = supportedTools(request.tools);
          if (request.sessionId) {
            const saved = host.binding(request.sessionId);
            if (!saved || key(saved) !== key(binding)) throw new Error('Session binding mismatch');
          }
          const catalogKey = key(binding);
          if (request.providers) {
            const providers: Record<string, PiAi.PiAiProviderProfile> = {};
            for (const [route, entry] of Object.entries(request.providers)) {
              if (!/^[a-z][a-z0-9-]+$/.test(route)) throw new Error('Invalid product provider route');
              const ref = `SHOTLOOM_${route.replaceAll('-', '_').toUpperCase()}`;
              await host.ctx.credentials.set(credentialRef(ref), entry.key);
              providers[route] = { ...entry.profile, apiKeyEnv: ref };
            }
            const next = JSON.stringify(providers);
            if (next !== modelConfig) {
              await modelPlugin?.dispose();
              modelPlugin = await host.ctx.plugin(PiAi, { providers });
              modelConfig = next;
            }
          }
          if (request.skills) {
            const root = skillPath(binding);
            // Product packaging only; the official provider discovers and loads it.
            await rm(root, { recursive: true, force: true });
            await mkdir(root, { recursive: true });
            for (const skill of request.skills) {
              if (!/^[a-z0-9][a-z0-9-]*$/.test(skill.id)) throw new Error('Invalid Skill bundle id');
              const directory = join(root, skill.id);
              if (skill.builtIn) await cp(join(options.contentRoot, 'skills', skill.id), directory, { recursive: true });
              else await mkdir(directory, { recursive: true });
              const metadata = skill.metadata && typeof skill.metadata === 'object' ? `metadata: ${JSON.stringify(skill.metadata)}\n` : '';
              await writeFile(join(directory, 'SKILL.md'), `---\nname: ${skill.id}\ndescription: ${JSON.stringify(skill.description || skill.id)}\n${metadata}---\n${skill.instructions}`, { mode: 0o600 });
            }
          }
          const existing = [...owners.values()].find(owner => key(owner.binding) === catalogKey);
          if (existing) {
            if (request.sessionId && existing.binding.sessionId !== request.sessionId) throw new Error('Conversation already has a live session');
            if (JSON.stringify(catalogs.get(catalogKey)?.tools) !== JSON.stringify(tools)) {
              const registration = toolRegistrations.get(catalogKey);
              if (!registration) throw new Error('Session tool registration is unavailable');
              registration.dispose();
              registration.dispose = registerProductTools(registration.scope, existing.binding, tools, { ...options.bridge, receiptRoot: options.dataRoot });
            }
            if (request.skills) {
              // Re-mount the official provider to synchronously invalidate its
              // catalog, without waiting for Chokidar's stability window.
              const provider = skillProviders.get(catalogKey);
              if (!provider) throw new Error('Session Skill provider is unavailable');
              await provider.plugin.dispose();
              provider.plugin = await provider.scope.plugin(SkillFiles, { includeDefaultRoots: false, customSkillDirs: [skillPath(binding)], watch: true });
            }
            catalogs.set(catalogKey, { binding, tools, skills: request.skills ?? catalogs.get(catalogKey)?.skills });
            hostCrud.saveCatalog(catalogKey, catalogs.get(catalogKey)! as unknown as Record<string, unknown>);
            return existing;
          }
          catalogs.set(catalogKey, { binding, tools, skills: request.skills });
          hostCrud.saveCatalog(catalogKey, catalogs.get(catalogKey)! as unknown as Record<string, unknown>);
          const defaultModel = request.defaultModel && { ...request.defaultModel,
            reasoningEffort: request.defaultModel.reasoningEffort === undefined ? undefined : ReasoningEffortId(request.defaultModel.reasoningEffort),
          };
          const owner = request.sessionId ? await host.resume(request.sessionId, defaultModel) : await host.create(binding, defaultModel);
          // The official browser controller installs its own model selection.
          // Seed that selection through its public API: AgentOptions alone are
          // otherwise overridden by the controller's deployment default.
          const selection = host.ctx.sessionProjections.stateOf(owner.agent.session, 'modelSelection');
          if (request.defaultModel && !owner.agent.session.requestHeader() && !selection?.pending) {
            await host.ctx.sessionController.selectModel({ sessionId: owner.agent.session.id, ...request.defaultModel });
          }
          owners.set(owner.binding.sessionId, owner);
          return owner;
        });
        composition = work.then(() => {}, () => {});
        const owner = await work;
        const url = new URL(host.ctx.connection.authenticatedUrl(`${origin}/`));
        url.hash = new URLSearchParams({ sessionId: owner.binding.sessionId }).toString();
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ sessionId: owner.binding.sessionId, url: url.toString() }));
      } catch (error) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }
    } });
    return { host, origin };
  } catch (error) { await host.dispose(); throw error; }
}
