/**
 * 工具 ID 命名约定。注册、可见性解析和展示层都从这里读取同一套规则，
 * 避免各处再用 `startsWith('video_project_')` 这类前缀猜测工具归属。
 */

/**
 * - 普通工具：`^[a-z][a-z0-9_]*$`（例如 `canvas_list_nodes`）
 * - 命名空间工具：命名空间和工具名都用小写 snake_case，以 `__` 分隔，
 *   左侧是 Skill 命名空间，右侧是基础工具名。
 */
export const TOOL_ID_RE = /^[a-z][a-z0-9_]*(?:__[a-z][a-z0-9_]*)?$/;

export function toolNamespacePrefix(toolId: string): string | null {
  const match = toolId.match(/^([a-z][a-z0-9_]*)__/);
  return match ? match[1] : null;
}

export function toolBaseName(toolId: string): string {
  const index = toolId.indexOf('__');
  return index >= 0 ? toolId.slice(index + 2) : toolId;
}

export function skillToolNamespace(skillId: string): string {
  const safeId = String(skillId || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
  if (!safeId) throw new Error('registerSkillTool requires a non-empty skillId');
  return `skill_${safeId}`;
}

/** 命名空间对应的 Skill 是否已经真正加载。 */
export function skillNamespaceIsLoaded(namespace: string, loadedSkillIds: Set<string>): boolean {
  const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const expected = normalized(namespace.slice('skill_'.length));
  return [...loadedSkillIds].some((id) => normalized(id) === expected);
}
