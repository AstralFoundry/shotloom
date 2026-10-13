import { availableAgentSkills } from '../tools/catalogTools';
import { agentDefinition, type AgentDefinition } from '../agents/definitions.ts';
import { nativeRuntimeSkills } from '../runtime/nativeSkills';
import type { AgentToolContext, JsonObject, JsonSchema } from '../core/types';

/**
 * loop 引擎自带的两个能力：加载 Skill 与派发子 Agent。
 *
 * 它们不进工具注册表，因为注册表是"Shotloom 本地可执行的业务动作"，而这两项是循环自身的
 * 机制；权限仍然完全来自 Agent 定义：`skills` 为空就没有 skill 工具，`dispatch` 为空
 * 就没有派发工具。引擎层不得借此绕过白名单执行别的动作。
 */
export interface LoopBuiltin {
  name: string;
  description: string;
  parameters: JsonSchema;
  run: (input: JsonObject) => Promise<JsonObject>;
}

export interface LoopBuiltinHost {
  agent: AgentDefinition;
  context: AgentToolContext;
  /** 派发一次子 Agent 循环，返回子 Agent 给父级的结论文字。 */
  runSubagent: (child: AgentDefinition, task: string) => Promise<string>;
  emit: (event: JsonObject & { type: string }) => void;
}

function textSchema(properties: Record<string, JsonSchema>, required: string[]): JsonSchema {
  return { type: 'object', properties, required, additionalProperties: false };
}

export function createLoopBuiltins(host: LoopBuiltinHost): LoopBuiltin[] {
  const builtins: LoopBuiltin[] = [];
  const skills = availableAgentSkills(host.agent.id);
  if (skills.length) {
    const contents = new Map(nativeRuntimeSkills(skills).map((skill) => [skill.id, skill.content]));
    builtins.push({
      name: 'skill',
      description: '按 id 加载一个已授予本 Agent 的 Skill，返回其完整方法与质量标准说明。加载后该 Skill 命名空间下的工具才会对你可见。',
      parameters: textSchema({ name: { type: 'string', description: 'Skill id' } }, ['name']),
      run: async (input) => {
        const skillId = String(input.name || '').trim();
        const content = contents.get(skillId);
        if (!content) {
          // 只允许加载定义里授予本 Agent 的 Skill；未授予或不存在都当作不可见处理。
          return { success: false, error: `Skill ${skillId || '(空)'} 不在本 Agent 可用列表：${[...contents.keys()].join(', ') || '无'}` };
        }
        if (!host.context.loadedSkillIds.has(skillId)) {
          host.context.loadedSkillIds.add(skillId);
          const skill = skills.find((item) => item.id === skillId);
          host.emit({
            type: 'skill_used', skillId, name: String(skill?.name || skillId),
            source: skill?.builtIn ? 'built-in' : 'user', createdAt: new Date().toISOString(),
          });
        }
        host.context.state.set('activeSkillId', skillId);
        return { success: true, skillId, content };
      },
    });
  }
  if (host.agent.dispatch.length) {
    const dispatchable = host.agent.dispatch
      .map((id) => agentDefinition(id))
      .filter((child) => child.role === 'subagent');
    builtins.push({
      name: 'dispatch_subagent',
      description: '把一个边界明确的子任务派给指定子 Agent。子 Agent 只能使用它自己定义里的工具与只读能力，并把结论返回给你；只有你可以直接对用户发言。',
      parameters: textSchema({
        agentId: { type: 'string', enum: dispatchable.map((child) => child.id), description: '子 Agent id' },
        task: { type: 'string', description: '包含已选 Skill 约束与真实上下文的完整任务说明' },
      }, ['agentId', 'task']),
      run: async (input) => {
        const childId = String(input.agentId || '');
        const child = dispatchable.find((item) => item.id === childId);
        if (!child) return { success: false, error: `子 Agent ${childId || '(空)'} 不在本 Agent 的 dispatch 列表` };
        const task = String(input.task || '').trim();
        if (!task) return { success: false, error: '派发子任务必须给出完整任务说明' };
        const childSessionId = `${host.context.requestId}:sub:${childId}:${Date.now().toString(36)}`;
        host.emit({
          type: 'subagent_started', parentRunId: host.context.requestId,
          childSessionId, title: `${child.title}：${task.slice(0, 40)}`, createdAt: new Date().toISOString(),
        });
        try {
          const summary = await host.runSubagent(child, task);
          host.emit({
            type: 'subagent_completed', parentRunId: host.context.requestId,
            childSessionId, createdAt: new Date().toISOString(),
          });
          return { success: true, agentId: childId, childSessionId, summary };
        } catch (cause) {
          const error = cause instanceof Error ? cause.message : String(cause);
          host.emit({
            type: 'subagent_failed', parentRunId: host.context.requestId,
            childSessionId, error, createdAt: new Date().toISOString(),
          });
          // 失败返回给父 Agent 而不是抛错：父模型可以改派任务或自行完成，整轮不必因一次派发失败而终止。
          return { success: false, agentId: childId, childSessionId, error };
        }
      },
    });
  }
  return builtins;
}
