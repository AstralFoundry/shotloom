import type { StoredSkill } from '../tools/catalogTools';

export interface SkillDocument {
  id: string;
  content: string;
}

const SKILL_ID = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

function frontmatterString(value: string): string {
  return JSON.stringify(value);
}

/**
 * Skill id 同时是 Agent 定义、`skill` 工具入参和界面选择器用的稳定标识，
 * 因此只允许小写字母、数字和连字符，且不允许路径或分隔符字符。
 */
export function assertSkillId(id: string): void {
  if (!SKILL_ID.test(id)) {
    throw new Error(`Skill ID ${id || '(empty)'} 必须使用小写字母、数字和连字符，且首尾不能是连字符`);
  }
}

/**
 * 把已启用的 Skill 装配成交给模型的说明文本。缺用途或缺正文的 Skill 不可加载，
 * 重复 id 会让 `skill` 工具的查找产生歧义，两者都在装配阶段直接失败。
 */
export function buildSkillDocuments(skills: StoredSkill[]): SkillDocument[] {
  const enabled = skills.filter((skill) => skill.enabled !== false);
  const seen = new Set<string>();
  return enabled.map((skill) => {
    const id = String(skill.id || '').trim();
    assertSkillId(id);
    if (seen.has(id)) throw new Error(`Skill ID 重复：${id}`);
    seen.add(id);
    const name = String(skill.name || id).trim();
    const description = String(skill.description || '').trim();
    const instructions = String(skill.instructions || '').trim();
    if (!description || !instructions) throw new Error(`Skill ${id} 缺少用途说明或完整指令`);
    const workflow = String(skill.workflow || '').trim();
    const sections = [
      `---\nname: ${id}\ndescription: ${frontmatterString(description)}\n---`,
      `# ${name}`,
      instructions,
      workflow ? `## Workflow\n\n${workflow}` : '',
    ].filter(Boolean);
    return { id, content: `${sections.join('\n\n')}\n` };
  });
}
