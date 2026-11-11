import { ToolCallId } from '@deepseek-ai/dsh-llm';
import { Context } from '@deepseek-ai/cordis';
import Llm from '@deepseek-ai/dsh-llm';
import Agents, { type Agent, type AgentHandle, type AgentOptions } from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import Sessions, { SessionId } from '@deepseek-ai/dsh-session';
import Projections from '@deepseek-ai/dsh-session-projection';
import * as SessionStats from '@deepseek-ai/dsh-session-stats';
import TokenMeter from '@deepseek-ai/dsh-token-meter';
import BasicCompaction from '@deepseek-ai/dsh-compaction-basic';
import ToolResultPruner from '@deepseek-ai/dsh-compaction-tool-result-pruner';
import * as ImageOffload from '@deepseek-ai/dsh-compaction-image-offload';
import * as CompactCommand from '@deepseek-ai/dsh-command-compact';
import Persistence from './sqlitePersistence.js';
import { openDatabase } from './db/connection.js';
import { HostCrud } from './crud/hostCrud.js';
import * as SessionFormat from '@deepseek-ai/dsh-session-log-deepseek';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite';
import Subagents from '@deepseek-ai/dsh-subagent';
import * as SpawnSubagents from '@deepseek-ai/dsh-subagent-spawn-in-process';
import * as SubagentTool from '@deepseek-ai/dsh-tool-subagent';
import * as SubagentControl from '@deepseek-ai/dsh-tool-subagent-control';
import Goals from '@deepseek-ai/dsh-goal';
import * as GoalDriver from '@deepseek-ai/dsh-goal-round-driver';
import * as GoalTools from '@deepseek-ai/dsh-tool-goal';
import Commands from '@deepseek-ai/dsh-commands';
import * as GoalCommand from '@deepseek-ai/dsh-command-goal';
import PlanMode from '@deepseek-ai/dsh-plan-mode';
import Approval from '@deepseek-ai/dsh-user-approval';
import PermissionPresets from '@deepseek-ai/dsh-permission-presets';
import Subprocess from '@deepseek-ai/dsh-subprocess-local';
import Sandbox from '@deepseek-ai/dsh-sandbox-local';
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy';
import Bash from '@deepseek-ai/dsh-bash-sandbox';
import * as ShellEnv from '@deepseek-ai/dsh-shell-env';
import * as BashTool from '@deepseek-ai/dsh-tool-bash';
import Questions from '@deepseek-ai/dsh-user-questions';
import * as AskUser from '@deepseek-ai/dsh-tool-ask-user';
import * as Todo from '@deepseek-ai/dsh-tool-todo';
import Skills from '@deepseek-ai/dsh-skill';
import * as SkillFiles from '@deepseek-ai/dsh-skill-filesystem';
import * as SkillTools from '@deepseek-ai/dsh-tool-skill';
import WorkingDirectory from '@deepseek-ai/dsh-working-directory';
import FileSystem from '@deepseek-ai/dsh-fs-local';
import * as Checkpoints from '@deepseek-ai/dsh-session-checkpoint-policy';
import Credentials from '@deepseek-ai/dsh-credentials-local';
import AttachmentLocal from '@deepseek-ai/dsh-attachment-local';
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment';
import { mkdir, readFile, readdir, realpath } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';

export const roles = ['canvas-primary', 'editor-primary', 'text-primary', 'director-primary'] as const;
export type ProductRole = typeof roles[number];

/** Trusted desktop binding. This is product metadata, never model input. */
export interface SessionBinding {
  sessionId: string;
  projectKey: string;
  conversationId: string;
  agentId: ProductRole;
  nodeId?: string;
  /** Durable local-child mapping; the native bridge retains its canonical editor Session. */
  toolSessionId?: string;
  parentSessionId?: string;
}

export interface HostOptions {
  dataRoot: string;
  contentRoot: string;
  rulesPath: string;
  skillDirs?: string[];
  scopedSkills?: boolean;
  /** Product tool registration runs in the unpublished official Agent scope. */
  registerTools?: (scope: Context, binding: Readonly<SessionBinding>) => void | Promise<void>;
}

/** 契约按自身 frontmatter 装配：appliesTo 决定归属，priority 决定顺序（越小越靠前）。 */
interface Contract {
  id: string;
  appliesTo: string[];
  priority: number;
  text: string;
}

const DEFAULT_CONTRACT_PRIORITY = 100;

export async function loadContracts(directory: string): Promise<Contract[]> {
  const files = (await readdir(directory)).filter(name => name.endsWith('.md')).sort();
  const contracts = await Promise.all(files.map(async file => {
    const raw = await readFile(join(directory, file), 'utf8');
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
    if (!match) throw new Error(`Contract ${file} must start with a frontmatter block`);
    const frontmatter = match[1];
    const appliesTo = /^appliesTo:\s*\[(.*)\]\s*$/m.exec(frontmatter)?.[1]
      ?.split(',').map(value => value.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) ?? [];
    if (!appliesTo.length) throw new Error(`Contract ${file} declares no appliesTo`);
    const priority = Number(/^priority:\s*(\d+)\s*$/m.exec(frontmatter)?.[1] ?? DEFAULT_CONTRACT_PRIORITY);
    const id = /^id:\s*(\S+)\s*$/m.exec(frontmatter)?.[1] ?? file.replace(/\.md$/, '');
    return { id, appliesTo, priority, text: raw.slice(match[0].length) };
  }));
  // 同优先级按文件名排序，装配结果稳定可复现。
  return contracts.sort((a, b) => a.priority - b.priority);
}

/** Assembly only: official plugins own the loop, interactions, goals and logs. */
export async function createHost(options: HostOptions) {
  const ctx = new Context();
  const dataRoot = resolve(options.dataRoot);
  await mkdir(dataRoot, { recursive: true });
  const database = openDatabase(join(dataRoot, 'agent.sqlite'));
  const hostCrud = new HostCrud(database);
  ctx.effect(() => () => database.close());
  let bindings = hostCrud.bindings() as unknown as SessionBinding[];
  const prompts = new Map<ProductRole, string>();
  const rules = await readFile(options.rulesPath, 'utf8');
  const planSection = await readFile(join(options.contentRoot, 'prompts', 'harness-plan-mode.md'), 'utf8');
  const runtimeContract = await readFile(join(options.contentRoot, 'prompts', 'harness-runtime.md'), 'utf8');
  // 契约按自身 frontmatter 的 appliesTo 与 priority 装配：新增契约只要写对头部就会生效，
  // 不必回到这里改角色分支。priority 越小越靠前，重要的收尾规则写在最后。
  const contracts = await loadContracts(join(options.contentRoot, 'contracts'));
  for (const [role, file] of [
    ['canvas-primary', 'canvas-agent.md'],
    ['editor-primary', 'editor-agent.md'],
    ['text-primary', 'text-agent.md'],
    ['director-primary', 'director-agent.md'],
  ] as const) {
    const sections = contracts
      .filter(contract => contract.appliesTo.includes('*') || contract.appliesTo.includes(role))
      .map(contract => contract.text);
    const nativeReference = role === 'editor-primary'
      ? await readFile(join(options.contentRoot, 'prompts', 'openreel-editor-reference.md'), 'utf8') : '';
    prompts.set(role, [rules, ...sections, nativeReference, await readFile(join(options.contentRoot, 'prompts', file), 'utf8')].join('\n\n'));
  }
  try {
    await ctx.plugin(Llm);
    await ctx.plugin(Credentials, { dshHome: dataRoot, watch: false });
    await ctx.plugin(Sessions);
    await ctx.plugin(Projections);
    await ctx.plugin(SessionStats);
    await ctx.plugin(TokenMeter);
    await ctx.plugin(ImageOffload);
    await ctx.plugin(ToolResultPruner);
    await ctx.plugin(BasicCompaction, { headroomTokens: 8192, maxTokens: 4096 });
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false });
    await ctx.plugin(Tools);
    await ctx.plugin(Agents);
    await ctx.plugin(SessionFormat);
    await ctx.plugin(Persistence, { path: join(dataRoot, 'agent.sqlite') });
    await ctx.plugin(AgentLoop, { agents: [] });
    await ctx.plugin(FileSystem);
    await ctx.plugin(AttachmentLocal, { dshHome: dataRoot });
    await ctx.plugin(WorkingDirectory);
    await ctx.plugin(Approval, { policy: 'ask' });
    await ctx.plugin(Subprocess);
    await ctx.plugin(Sandbox);
    await ctx.plugin(SandboxPolicy, { mode: 'workspace-write', workspaceRoot: join(dataRoot, 'workspaces') });
    await ctx.plugin(Bash, { cwd: join(dataRoot, 'workspaces'), timeoutMs: 30_000, maxTimeoutMs: 120_000 });
    await ctx.plugin(PermissionPresets, { defaultPreset: 'workspace-write', presets: {
      'read-only': { sandbox: 'read-only', approval: 'ask' },
      'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
      'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
    } });
    await ctx.plugin(ShellEnv, { dshHome: dataRoot });
    await ctx.plugin(BashTool, { enableRunInBackground: false, promoteOnTimeout: false });
    await ctx.plugin(Questions);
    await ctx.plugin(Goals);
    await ctx.plugin(GoalDriver);
    await ctx.plugin(Commands);
    await ctx.plugin(CompactCommand);
    await ctx.plugin(GoalCommand);
    await ctx.plugin(GoalTools);
    await ctx.plugin(PlanMode, { section: planSection });
    await ctx.plugin(AskUser);
    await ctx.plugin(Todo, { allowParallelInProgress: true });
    await ctx.plugin(Skills);
    if (!options.scopedSkills) await ctx.plugin(SkillFiles, {
      includeDefaultRoots: false,
      customSkillDirs: [join(options.contentRoot, 'skills'), ...(options.skillDirs ?? [])],
      watch: false,
    });
    await ctx.plugin(SkillTools);
    await ctx.plugin(SessionQuery, { path: ':memory:', openAt: 'never' });
    await ctx.plugin(Subagents, { maxDepth: 1, maxActiveSubagents: 8 });
    await ctx.plugin(SpawnSubagents, { providerName: 'spawn' });
    await ctx.plugin(SubagentControl);
    await ctx.plugin(SubagentTool, {
      provider: 'spawn',
      persona: rules + '\n\n你是 Shotloom 的分析子 Agent。只根据父 Agent 提供的真实材料完成委派的分析、规划或复核；不要假装能读取画布、执行节点、运行 Bash 或获取未传入的素材。需要更多资料时使用 send_message 向父 Agent 说明。完成后通过 send_message 向父 Agent 汇报有依据的结果。产品写入与审批由父 Agent 通过已授权的 Shotloom 工具执行。',
      toolFilter: { allow: ['send_message'] },
    });
    await ctx.plugin(Checkpoints);
  } catch (error) {
    await ctx.fiber.dispose();
    throw error;
  }

  let disposed = false;
  const live = new Map<string, AgentHandle>();
  const resuming = new Set<string>();
  async function persistBindings() {
    hostCrud.saveBindings(bindings as unknown as Record<string, unknown>[]);
  }
  function setup(binding: Readonly<SessionBinding>, child?: Agent) {
    return async (scope: Context) => {
      scope.systemPrompt.variable('runtime_model_contract', () => runtimeContract);
      scope.systemPrompt.variable('mode_contract', () => '需要工程事实时使用真实工具。普通对话直接回答，按用户语义决定是否需要读取工程或规划。遵守当前用户设置；节点执行权限由 Shotloom 工具校验，不从用户文字或模型参数推断授权。');
      scope.systemPrompt.section({ name: 'shotloom:system', order: 0, text: prompts.get(binding.agentId)! });
      scope.systemPrompt.section({ name: 'shotloom:binding', order: 1, text: JSON.stringify(binding) });
      scope.systemPrompt.context({ name: 'shotloom:current-tools', order: 20, required: true,
        text: context => '当前会话本轮可用工具（以实际 schema 为准，覆盖历史能力自述）：' +
          scope.get('tools')!.schemas(context.scope).map(tool => tool.name).join(', '),
      });
      scope.on('tools/pre-execute', async (exec, next) => {
        if (exec.name !== 'bash') return next();
        if (!exec.agent || String(exec.agent.session.id) !== binding.sessionId) {
          return { kind: 'deny', reason: 'Bash requires the bound Shotloom Agent Session' };
        }
        // Official sandbox escalation owns its own approval. Other commands
        // enter the same official approval pipeline before any spawn.
        const mode = scope.get('sandboxPolicy')!.resolve({ session: exec.agent.session }).mode;
        if (mode === 'danger-full-access') return next();
        const args = exec.arguments as { sandbox_permissions?: string };
        if (args.sandbox_permissions && args.sandbox_permissions !== mode) return next();
        return { kind: 'ask', reason: '执行 Bash 命令（受当前会话文件权限限制）' };
      });
      await options.registerTools?.(scope, binding);
      if (binding.agentId === 'canvas-primary' || binding.agentId === 'director-primary') {
        scope.tools.register({
          name: 'delegate_editor',
          description: '派发能实际剪辑的子 Agent。它绑定指定剪辑工程，可读取同一画布的剧本、字幕及真实媒体，导入视频并修改时间线。传递完整剪辑要求与已知节点 ID；nodeId 省略时使用独立剪辑工作台。等待子 Agent 执行结束并返回真实结果；运行期间写入审批显示在当前画布会话。',
          parameters: { type: 'object', properties: { nodeId: { type: 'string' }, prompt: { type: 'string' }, description: { type: 'string' } }, required: ['prompt', 'description'], additionalProperties: false },
          output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
          isConcurrencySafe: () => false,
          async execute(input, exec) {
            if (!exec.agent || String(exec.agent.session.id) !== binding.sessionId) return { success: false, code: 'SCOPE_MISMATCH' };
            const args = input as { nodeId?: string; prompt: string; description: string };
            const prepare = scope.tools.get('canvas_prepare_editor', exec.agent);
            if (!prepare) return { success: false, error: 'Editor delegation is unavailable in this workspace' };
            const receipt = await prepare.execute(args.nodeId ? { nodeId: args.nodeId } : {}, { ...exec, callId: ToolCallId(`${exec.callId}:prepare-editor`) });
            const result = (receipt as { result?: { result?: { success?: boolean; binding?: SessionBinding } } }).result?.result;
            const editor = result?.binding;
            const canonical = editor && bindings.find(item => item.sessionId === editor.sessionId);
            if (!result?.success || !canonical || canonical.agentId !== 'editor-primary' || canonical.projectKey !== binding.projectKey
              || canonical.nodeId !== editor?.nodeId || canonical.conversationId !== editor?.conversationId) {
              return { success: false, error: 'Editor preparation did not return a trusted bound Session', receipt };
            }
            const childId = SessionId(randomUUID());
            const childBinding: SessionBinding = { ...canonical, sessionId: String(childId), toolSessionId: canonical.sessionId, parentSessionId: binding.sessionId };
            bindings.push(childBinding);
            let accepted = false;
            try {
              await persistBindings();
              const subagents = scope.get('subagents')!;
              const activation = await subagents.startActivation({ provider: 'spawn', label: args.description, childId,
                delivery: 'parent', signal: exec.signal,
                request: { parent: exec.agent, maxDepth: 1, prompt: [{ type: 'text', text: args.prompt }] },
              });
              accepted = true;
              const cancel = () => subagents.interrupt(childId, { kind: 'ancestor', agent: exec.agent! });
              exec.signal.addEventListener('abort', cancel, { once: true });
              try {
                if (exec.signal.aborted) cancel();
                const outcome = await activation.result;
                return { success: true, childId: String(activation.childId), nodeId: canonical.nodeId, status: 'finished', outcome };
              } finally { exec.signal.removeEventListener('abort', cancel); }
            } catch (error) {
              if (!accepted) {
                bindings = bindings.filter(item => item.sessionId !== String(childId));
                await persistBindings();
              }
              return { success: false, ...(accepted ? { childId: String(childId) } : {}), error: error instanceof Error ? error.message : String(error) };
            }
          },
        });
      }
      scope.tools.register({
        name: 'read_uploaded_file', description: 'Read UTF-8 text from a file attached to this exact conversation. Use the attachmentId in the recorded file handle; supports byte windows.',
        parameters: { type: 'object', properties: { attachmentId: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 1048576 } }, required: ['attachmentId'], additionalProperties: false },
        output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
        isConcurrencySafe: () => true,
        async execute(input, exec) {
          if (!exec.agent || String(exec.agent.session.id) !== binding.sessionId) return { success: false, code: 'SCOPE_MISMATCH' };
          const args = input as { attachmentId: string; offset?: number; limit?: number };
          const files = exec.agent.session.snapshotEvents().flatMap(event => event.type === 'user/message' ? event.data.content.filter(block => block.type === 'file').map(block => block.attachment) : []);
          const file = files.find(file => String(file.attachmentId) === args.attachmentId) as FileAttachmentRef | undefined;
          if (!file) return { success: false, code: 'ATTACHMENT_NOT_IN_SESSION' };
          const offset = args.offset ?? 0, limit = args.limit ?? 131072;
          if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1048576) return { success: false, error: 'Invalid byte window' };
          let position = 0, remaining = limit;
          const chunks: Uint8Array[] = [];
          for await (const chunk of scope.get('attachments')!.readFileStream(file, exec.signal)) {
            const start = Math.max(0, offset - position);
            const part = chunk.subarray(Math.min(start, chunk.length), Math.min(chunk.length, start + remaining));
            if (part.length) { chunks.push(part); remaining -= part.length; }
            position += chunk.length;
            if (remaining === 0) break;
          }
          return { success: true, name: file.name, attachmentId: file.attachmentId, offset, nextOffset: offset + limit - remaining, totalBytes: file.bytes, content: Buffer.concat(chunks).toString('utf8') };
        },
      });
      // Product reference reads remain confined to the selected Skill bundle.
      scope.tools.register({
        name: 'read_skill_reference', description: 'Read a relative reference file from an available product Skill bundle. Load the Skill first.',
        parameters: { type: 'object', properties: { name: { type: 'string' }, file: { type: 'string' } }, required: ['name', 'file'], additionalProperties: false },
        output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
        isConcurrencySafe: () => true,
        async execute(input, exec) {
          if (!exec.agent || String(exec.agent.session.id) !== binding.sessionId) return { success: false, code: 'SCOPE_MISMATCH' };
          const args = input as { name: string; file: string };
          try {
            const skill = await scope.get('skills')!.get(args.name, { scope: exec.agent, signal: exec.signal });
            if (!skill?.invocation.modelInvocable || skill.resourceBase?.kind !== 'directory') return { success: false, error: 'Skill has no available local reference bundle' };
            const root = await realpath(skill.resourceBase.path);
            const file = await realpath(resolve(root, args.file));
            const path = relative(root, file);
            if (!path || path === '..' || path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(path)) return { success: false, code: 'REFERENCE_OUTSIDE_SKILL' };
            return { success: true, name: skill.name, file: path, content: await readFile(file, { encoding: 'utf8', signal: exec.signal }) };
          } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
        },
      });
      if (child && binding.toolSessionId) {
        // Restrictions mask inherited capabilities; the editor tools registered
        // on this child's own scope remain available. Only global names belong here.
        scope.tools.restrict({ allow: ['send_message', 'skill', 'ask_user_question'] });
      }
    };
  }
  // The official continuation manager awaits this hook before the first turn,
  // including cold resumes. Only children with persisted trusted bindings get editor tools.
  ctx.on('agent/created', async ({ agent }) => {
    const binding = bindings.find(item => item.sessionId === String(agent.session.id));
    if (binding?.toolSessionId) {
      await setup(Object.freeze({ ...binding }), agent)(agent.ctx);
    }
    return undefined;
  });
  function own(handle: AgentHandle, binding: Readonly<SessionBinding>) {
    const owned = {
      agent: handle.agent,
      binding,
      async dispose() {
        try { await handle.dispose(); }
        finally { if (live.get(binding.sessionId) === owned) live.delete(binding.sessionId); }
      },
    };
    live.set(binding.sessionId, owned);
    return owned;
  }
  return {
    ctx,
    binding(sessionId: string): Readonly<SessionBinding> | undefined {
      const binding = bindings.find(item => item.sessionId === sessionId);
      return binding ? Object.freeze({ ...binding }) : undefined;
    },
    async create(binding: Omit<SessionBinding, 'sessionId'>, agentOptions: AgentOptions = {}) {
      if (!roles.includes(binding.agentId)) throw new Error('Unknown Shotloom Agent role');
      if (!binding.projectKey || !binding.conversationId) throw new Error('Project and conversation are required');
      if (binding.agentId === 'editor-primary' || binding.agentId === 'text-primary') {
        if (!binding.nodeId) throw new Error('Editor/text session requires a bound node');
      }
      const trusted = Object.freeze({ ...binding, sessionId: randomUUID() });
      // Official browser Session discovery requires a durable cwd. Attachments
      // use this private workspace; product files stay behind Shotloom tools.
      const cwd = join(dataRoot, 'workspaces', trusted.sessionId);
      await mkdir(cwd, { recursive: true });
      const handle = await ctx.agents.create({
        sessionId: SessionId(trusted.sessionId), meta: { cwd }, agentOptions, setup: setup(trusted),
      });
      bindings.push(trusted);
      try {
        // Persist even a blank Session before
        // publishing its product identity, so closing before the first turn is resumable.
        await ctx.sessionPersistence.flush();
        await persistBindings();
      } catch (error) {
        bindings = bindings.filter(item => item.sessionId !== trusted.sessionId);
        await handle.dispose();
        throw error;
      }
      return own(handle, trusted);
    },
    async resume(sessionId: string, agentOptions: AgentOptions = {}) {
      if (live.has(sessionId) || resuming.has(sessionId)) throw new Error('Session already has a live owner');
      const binding = bindings.find(item => item.sessionId === sessionId);
      if (!binding) throw new Error('Session has no trusted Shotloom binding');
      const trusted = Object.freeze({ ...binding });
      resuming.add(sessionId);
      try {
        const handle = await ctx.agents.resume({
          resumeSessionId: SessionId(sessionId), agentOptions, setup: setup(trusted),
        });
        return own(handle, trusted);
      } finally { resuming.delete(sessionId); }
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await persistBindings();
      await ctx.fiber.dispose();
    },
  };
}
