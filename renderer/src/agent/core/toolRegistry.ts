import type {
  AgentToolContext, AgentToolDefinition, JsonObject, JsonSchema, JsonValue, PreparedAgentToolCall,
} from './types';
import { TOOL_ID_RE, skillToolNamespace, toolBaseName } from './toolIdentity.ts';
import { visibleAgentTools } from './visibility.ts';

export class AgentToolInputError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid tool input: ${issues.join('; ')}`);
    this.name = 'AgentToolInputError';
    this.issues = issues;
  }
}

function valueType(value: JsonValue | undefined): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matches(schema: JsonSchema, value: JsonValue | undefined, path: string, issues: string[]): void {
  if (schema.anyOf || schema.oneOf) {
    const attempts = (schema.anyOf || schema.oneOf || []).map((choice) => {
      const nested: string[] = [];
      matches(choice, value, path, nested);
      return nested;
    });
    if (!attempts.some((nested) => nested.length === 0)) {
      const closest = attempts.sort((a, b) => a.length - b.length)[0];
      issues.push(...(closest?.length ? closest : [`${path} does not match an allowed shape`]));
    }
    return;
  }
  if (schema.enum && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) {
    issues.push(`${path} must be one of ${schema.enum.join(', ')}`);
    return;
  }
  if (schema.type && valueType(value) !== schema.type && !(schema.type === 'number' && valueType(value) === 'integer')) {
    issues.push(`${path} must be ${schema.type}`);
    return;
  }
  if (schema.type === 'object' && value && !Array.isArray(value)) {
    const record = value as Record<string, JsonValue | undefined>;
    for (const key of schema.required || []) if (record[key] === undefined) issues.push(`${path}.${key} is required`);
    for (const [key, child] of Object.entries(schema.properties || {})) {
      if (record[key] !== undefined) matches(child, record[key], `${path}.${key}`, issues);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) if (!schema.properties?.[key]) issues.push(`${path}.${key} is not allowed`);
    }
  }
  if (schema.type === 'array' && Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) issues.push(`${path} needs at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) issues.push(`${path} allows at most ${schema.maxItems} items`);
    if (schema.items) value.forEach((item, index) => matches(schema.items!, item, `${path}[${index}]`, issues));
  }
}

export function validateToolInput(schema: JsonSchema, value: JsonValue): void {
  const issues: string[] = [];
  matches(schema, value, '$', issues);
  if (issues.length) throw new AgentToolInputError(issues);
}

export function canRequestAgentClarification(): boolean {
  return true;
}

export function classifyAgentToolResult(result: unknown) {
  const record = result && typeof result === 'object' ? result as Record<string, unknown> : {};
  const skippedCount = Number(record.skippedCount) || 0;
  const appliedCount = Number(record.appliedCount) || 0;
  const failed = record.success === false && appliedCount === 0;
  return {
    failed,
    skippedCount,
    error: failed ? String(record.error || `${skippedCount} 个操作未执行`) : '',
  };
}

// 运行时工具注册表。这里保存的是本地可执行定义；真正发送给模型的只是
// id、description 和 inputSchema，不会把 execute 函数或应用内部状态暴露出去。
const tools = new Map<string, AgentToolDefinition>();

/** 注册表原始全集。可见子集一律由 core/visibility.ts 按 Agent 定义解析。 */
export function allAgentTools(): AgentToolDefinition[] {
  return [...tools.values()];
}

export function registerAgentTool<TInput extends JsonObject>(definition: AgentToolDefinition<TInput>): void {
  if (!TOOL_ID_RE.test(definition.id)) throw new Error(`Invalid Agent tool id: ${definition.id}`);
  if (tools.has(definition.id)) throw new Error(`Agent tool already registered: ${definition.id}`);
  tools.set(definition.id, definition as AgentToolDefinition);
}

export function hasAgentTool(toolId: string): boolean {
  return tools.has(toolId);
}

/**
 * 展示层用的工具标题。运行时事件只携带 toolId，
 * 界面不能再各自维护一份中文名字表，否则新增工具就会漏掉。
 */
export function agentToolTitle(toolId: string): string {
  return tools.get(toolId)?.title || tools.get(toolBaseName(toolId))?.title || '';
}

const effectIcon: Record<string, string> = {
  read: 'search',
  agent_state_write: 'list',
  project_write: 'archive',
  canvas_write: 'workflow',
  media_generation: 'spark',
};

/** 展示层图标：工具自己声明优先，其次按 effect 取类别图标。 */
export function agentToolIcon(toolId: string): string {
  const definition = tools.get(toolId) || tools.get(toolBaseName(toolId));
  if (!definition) return 'wrench';
  return definition.icon || effectIcon[definition.effect] || 'wrench';
}

export function registerSkillTool<TInput extends JsonObject>(
  skillId: string,
  definition: AgentToolDefinition<TInput>,
): void {
  registerAgentTool({
    ...definition,
    id: `${skillToolNamespace(skillId)}__${definition.id}`,
  });
}

export function unregisterAgentTool(toolId: string): boolean {
  return tools.delete(toolId);
}

/**
 * 当前 Agent 在本轮可见的工具集合，同时也是真正序列化进模型请求的集合。
 * 判定全部来自 Agent 定义白名单，未列出的工具不会出现在这里。
 */
export function listAgentTools(context: AgentToolContext): AgentToolDefinition[] {
  return visibleAgentTools(context.agentId, allAgentTools(), context);
}

export function prepareAgentToolCall(name: string, rawArguments: string, context: AgentToolContext): PreparedAgentToolCall {
  // 模型只负责提出调用。所有参数必须在本地重新解析并按注册 schema 校验，
  // 校验通过后 AgentRuntime 才会调用 definition.execute。
  const definition = tools.get(name);
  if (!definition || definition.isAvailable?.(context) === false) throw new Error(`Unknown or unavailable Agent tool: ${name}`);
  if (!listAgentTools(context).some((tool) => tool.id === name)) {
    throw new Error(`Tool ${name} is not visible to Agent ${context.agentId}`);
  }
  let input: JsonObject;
  try {
    input = JSON.parse(rawArguments || '{}') as JsonObject;
  } catch {
    const repaired = String(rawArguments || '{}')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
      .replace(/,\s*([}\]])/g, '$1');
    try {
      input = JSON.parse(repaired) as JsonObject;
    } catch {
      const start = repaired.indexOf('{');
      const end = repaired.lastIndexOf('}');
      try {
        input = JSON.parse(start >= 0 && end > start ? repaired.slice(start, end + 1) : '{}') as JsonObject;
      } catch {
        input = {};
      }
    }
  }
  // 动态 schema 同时用于模型暴露和本地校验，防止模型复用旧历史中的
  // 已关闭能力绕过当前设置。
  validateToolInput(definition.resolveInputSchema?.(context) || definition.inputSchema, input);
  return {
    definition,
    input,
    inputSummary: definition.summarizeInput?.(input) || Object.keys(input).join(', ') || 'no arguments',
  };
}

export function clearAgentToolsForTests(): void {
  tools.clear();
}
