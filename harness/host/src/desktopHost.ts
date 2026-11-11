import { openDatabase } from './db/connection.js';
import { HostCrud } from './crud/hostCrud.js';
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createHost, type SessionBinding } from './createHost.js';
import { registerProductTools, type ProductTool, type ProductBridge } from './productTools.js';
import { startClientServices } from './webHost.js';
import * as SkillFiles from '@deepseek-ai/dsh-skill-filesystem';
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { Context } from '@deepseek-ai/cordis';
import { SessionCrud } from './crud/sessionCrud.js';

type BindingInput = Omit<SessionBinding, 'sessionId'>;
interface ProductSkill { id: string; description?: string; instructions: string; metadata?: Record<string, unknown>; builtIn?: boolean }
interface Catalog { binding: BindingInput; tools: ProductTool[]; skills?: ProductSkill[] }
interface ProviderConfig { key: string; profile: PiAi.PiAiProviderProfile }
const key = (binding: BindingInput) => JSON.stringify([binding.projectKey, binding.conversationId, binding.agentId, binding.nodeId ?? '']);

/** Desktop composition is reachable only through the inherited native pipe. */
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
    await startClientServices(host, options);
    const owners = new Map<string, Awaited<ReturnType<typeof host.create>>>();
    // This queue serializes composition and catalog writes, never model turns.
    let composition = Promise.resolve();
    let modelPlugin: Awaited<ReturnType<Context['plugin']>> | undefined;
    let modelConfig = '';
    const sessionCrud = new SessionCrud(database);
    const providerConfigs = new Map<string, string>();
    const skillVersions = new Map<string, string>();
    async function seedDefaultModel(owner: Awaited<ReturnType<typeof host.create>>, model?: { provider: string; model: string; reasoningEffort?: string }, providers?: Record<string, ProviderConfig>) {
      const selection = host.ctx.sessionProjections.stateOf(owner.agent.session, 'modelSelection');
      const selected = selection?.pending ?? selection?.lastUsed;
      const removed = selected && providers && !providers[selected.provider]?.profile.models?.some(item => item.id === selected.model);
      // Seed empty sessions and replace selections removed from the configured
      // catalog. Keep every explicit choice that remains available.
      if (model && ((!owner.agent.session.requestHeader() && !selection?.pending) || removed)) {
        await host.ctx.sessionController.selectModel({ sessionId: owner.agent.session.id, ...model });
      }
    }
    async function bind(request: Catalog & { sessionId?: string; defaultModel?: { provider: string; model: string; reasoningEffort?: string }; providers?: Record<string, ProviderConfig> }) {
        const work = composition.then(async () => {
          const { binding } = request;
          if (!binding || !Array.isArray(request.tools)) throw new Error('Binding and named product tools are required');
          const tools = supportedTools(request.tools);
          if (request.sessionId) {
            const saved = host.binding(request.sessionId);
            if (!saved || key(saved) !== key(binding)) throw new Error('Session binding mismatch');
            if (host.ctx.workspaceRegistry.archivedSessionIds.includes(SessionId(request.sessionId))) {
              await host.ctx.workspaceRegistry.unarchiveSession(SessionId(request.sessionId));
            }
          }
          const catalogKey = key(binding);
          if (request.providers) {
            const providers: Record<string, PiAi.PiAiProviderProfile> = {};
            for (const [route, entry] of Object.entries(request.providers)) {
              if (!/^[a-z][a-z0-9-]+$/.test(route)) throw new Error('Invalid product provider route');
              const ref = `SHOTLOOM_${route.replaceAll('-', '_').toUpperCase()}`;
              const version = createHash('sha256').update(JSON.stringify(entry)).digest('hex');
              if (providerConfigs.get(route) !== version) {
                await host.ctx.credentials.set(credentialRef(ref), entry.key);
                providerConfigs.set(route, version);
              }
              providers[route] = { ...entry.profile, apiKeyEnv: ref };
            }
            const next = JSON.stringify(providers);
            if (next !== modelConfig) {
              await modelPlugin?.dispose();
              modelPlugin = await host.ctx.plugin(PiAi, { providers });
              modelConfig = next;
            }
          }
          const skillVersion = request.skills && createHash('sha256').update(JSON.stringify(request.skills)).digest('hex');
          const skillsChanged = skillVersion !== undefined && skillVersions.get(catalogKey) !== skillVersion;
          if (skillsChanged && request.skills) {
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
            if (skillsChanged) {
              // Re-mount the official provider to synchronously invalidate its
              // catalog, without waiting for Chokidar's stability window.
              const provider = skillProviders.get(catalogKey);
              if (!provider) throw new Error('Session Skill provider is unavailable');
              await provider.plugin.dispose();
              provider.plugin = await provider.scope.plugin(SkillFiles, { includeDefaultRoots: false, customSkillDirs: [skillPath(binding)], watch: true });
            }
            catalogs.set(catalogKey, { binding, tools, skills: request.skills ?? catalogs.get(catalogKey)?.skills });
            hostCrud.saveCatalog(catalogKey, catalogs.get(catalogKey)! as unknown as Record<string, unknown>);
            if (skillVersion) skillVersions.set(catalogKey, skillVersion);
            await seedDefaultModel(existing, request.defaultModel, request.providers);
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
          await seedDefaultModel(owner, request.defaultModel, request.providers);
          owners.set(owner.binding.sessionId, owner);
          if (skillVersion) skillVersions.set(catalogKey, skillVersion);
          return owner;
        });
        composition = work.then(() => {}, () => {});
        const owner = await work;
        return { sessionId: owner.binding.sessionId, tools: [...new Set([...catalogs.values()].flatMap(row => row.tools.map(tool => tool.name)))],
          toolTitles: Object.fromEntries([...catalogs.values()].flatMap(row => row.tools.map(tool => [tool.name, tool.title || tool.name]))) };
    }
    async function setSessionsArchived(projectKey: string, sessionIds?: string[], archived = true) {
      const requested = sessionIds ? new Set(sessionIds) : undefined;
      const changed: string[] = [];
      for (const binding of hostCrud.bindings() as Array<{ projectKey?: string; sessionId?: string }>) {
        const id = binding.sessionId;
        if (binding.projectKey !== projectKey || !id || (requested && !requested.has(id)) || !sessionCrud.find(id)) continue;
        if (archived) await host.ctx.workspaceRegistry.archiveSession(SessionId(id), { stopActivity: true });
        else await host.ctx.workspaceRegistry.unarchiveSession(SessionId(id));
        changed.push(id);
      }
      return { sessionIds: changed };
    }
    return { host, bind, setSessionsArchived };
  } catch (error) { await host.dispose(); throw error; }
}
