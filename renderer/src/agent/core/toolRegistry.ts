import type {
  AgentToolContext, AgentToolDefinition, JsonObject, JsonSchema, JsonValue, PreparedAgentToolCall,
} from './types';

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

/**
 * 工具 ID 约定：
 * - 普通工具：`^[a-z][a-z0-9_]*$`（例如 `get_canvas`）
 * - 命名空间工具：命名空间和工具名都使用小写 snake_case，中间以 `__` 分隔
 *
 * `__` 是分隔符；左侧是 Skill 命名空间，右侧是基础工具名。
 */
const TOOL_ID_RE = /^[a-z][a-z0-9_]*(?:__[a-z][a-z0-9_]*)?$/;

export function toolNamespacePrefix(toolId: string): string | null {
  const match = toolId.match(/^([a-z][a-z0-9_]*)__/);
  return match ? match[1] : null;
}

export function toolBaseName(toolId: string): string {
  const idx = toolId.indexOf('__');
  return idx >= 0 ? toolId.slice(idx + 2) : toolId;
}

function normalizedNamespaceId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function skillNamespaceIsLoaded(namespace: string, loadedIds: Set<string>): boolean {
  if (namespace === 'skill') return loadedIds.size > 0;
  const expected = normalizedNamespaceId(namespace.slice('skill'.length + 1));
  return [...loadedIds].some((id) => normalizedNamespaceId(id) === expected);
}

export function registerAgentTool<TInput extends JsonObject>(definition: AgentToolDefinition<TInput>): void {
  if (!TOOL_ID_RE.test(definition.id)) throw new Error(`Invalid Agent tool id: ${definition.id}`);
  if (tools.has(definition.id)) throw new Error(`Agent tool already registered: ${definition.id}`);
  tools.set(definition.id, definition as AgentToolDefinition);
}

export function registerSkillTool<TInput extends JsonObject>(
  skillId: string,
  definition: AgentToolDefinition<TInput>,
): void {
  const safeId = String(skillId || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
  if (!safeId) throw new Error('registerSkillTool requires a non-empty skillId');
  registerAgentTool({
    ...definition,
    id: `skill_${safeId}__${definition.id}`,
  });
}

export function unregisterAgentTool(toolId: string): boolean {
  return tools.delete(toolId);
}

export function listAgentTools(context: AgentToolContext): AgentToolDefinition[] {
  // isAvailable 按本轮状态动态裁剪工具；例如读取过模型目录后，
  // 不再重复暴露 inspect_model_catalog。
  // Skill 命名空间工具仅在所属 Skill 被预加载时可见。
  return [...tools.values()].filter((tool) => {
    if (tool.isAvailable?.(context) === false) return false;
    // 检查命名空间可见性
    const ns = toolNamespacePrefix(tool.id);
    if (!ns) return true; // 非命名空间工具始终可见
    if (ns === 'skill' || ns.startsWith('skill_')) {
      return skillNamespaceIsLoaded(ns, context.loadedSkillIds);
    }
    return true;
  });
}

export function assistantToolDefinitions(context: AgentToolContext): JsonObject[] {
  // 转换为 OpenAI-compatible Function Calling 结构，供 modelRequestBody 直接传给模型。
  return listAgentTools(context).map((tool) => ({
    type: 'function',
    function: {
      name: tool.id,
      description: tool.description,
      parameters: JSON.parse(JSON.stringify(tool.resolveInputSchema?.(context) || tool.inputSchema)),
    },
  }) as JsonObject);
}

export function prepareAgentToolCall(name: string, rawArguments: string, context: AgentToolContext): PreparedAgentToolCall {
  // 模型只负责提出调用。所有参数必须在本地重新解析并按注册 schema 校验，
  // 校验通过后 AgentRuntime 才会调用 definition.execute。
  const definition = tools.get(name);
  if (!definition || definition.isAvailable?.(context) === false) throw new Error(`Unknown or unavailable Agent tool: ${name}`);
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
