import type { StoredSkill } from '../tools/catalogTools';

export interface NativeRuntimeSkill {
  id: string;
  content: string;
}

const NATIVE_SKILL_ID = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

function frontmatterString(value: string): string {
  return JSON.stringify(value);
}

export function assertNativeSkillId(id: string): void {
  if (!NATIVE_SKILL_ID.test(id)) {
    throw new Error(`Skill ID ${id || '(empty)'} 必须使用小写字母、数字和连字符，且首尾不能是连字符`);
  }
}

export function nativeRuntimeSkills(skills: StoredSkill[]): NativeRuntimeSkill[] {
  const enabled = skills.filter((skill) => skill.enabled !== false);
  const seen = new Set<string>();
  return enabled.map((skill) => {
    const id = String(skill.id || '').trim();
    assertNativeSkillId(id);
    if (seen.has(id)) throw new Error(`Skill ID 重复：${id}`);
    seen.add(id);
    const name = String(skill.name || id).trim();
    const description = String(skill.description || '').trim();
    const instructions = String(skill.instructions || '').trim();
    if (!description || !instructions) throw new Error(`Skill ${id} 缺少用途说明或完整指令`);
    const recipeIds = [...new Set((skill.recipeIds || []).map(String).filter(Boolean))];
    const workflow = String(skill.workflow || '').trim();
    const sections = [
      `---\nname: ${id}\ndescription: ${frontmatterString(description)}\n---`,
      `# ${name}`,
      instructions,
      workflow ? `## Workflow\n\n${workflow}` : '',
      recipeIds.length
        ? `## Shotloom Recipe Scope\n\n本 Skill 只可使用以下 Recipe ID：${recipeIds.map((recipeId) => `\`${recipeId}\``).join('、')}。需要生成节点时，通过 \`list_recipes\` 和 \`load_recipe\` 读取对应策略。`
        : '',
    ].filter(Boolean);
    return { id, content: `${sections.join('\n\n')}\n` };
  });
}
