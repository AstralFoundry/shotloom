import { reactive } from '@/store/domainReactivity';
import { desktopApi } from '@/services/desktopApi';
import { getBuiltInSkill } from '@/services/builtInSkills';
import { recipesStore } from '@/store/recipesStore';
import { uid } from '@/utils/format';

export const skillsStore = reactive({
  storageVersion: 1,
  skills: [],
  selectedSkillId: null,
});

export async function loadGlobalSkills() {
  const storage = await desktopApi.skills.getGlobal();
  skillsStore.storageVersion = storage.storageVersion || 1;
  skillsStore.skills = Array.isArray(storage.skills) ? storage.skills : [];
  if (!skillsStore.skills.some((skill) => skill.id === skillsStore.selectedSkillId)) {
    skillsStore.selectedSkillId = skillsStore.skills[0]?.id || null;
  }
}

export async function saveGlobalSkills() {
  const snapshot = JSON.parse(JSON.stringify({
    storageVersion: skillsStore.storageVersion,
    skills: skillsStore.skills,
  }));
  const storage = await desktopApi.skills.setGlobal({
    storageVersion: snapshot.storageVersion,
    skills: snapshot.skills,
  });
  skillsStore.storageVersion = storage.storageVersion || 1;
  skillsStore.skills = storage.skills || [];
}

export function createSkillDraft() {
  return {
    id: uid(),
    name: '新技能',
    description: '说明这个技能适用于什么任务，便于 Agent 自动选择。',
    category: 'general',
    version: 1,
    triggers: { keywords: [] },
    recipeIds: [],
    instructions: '输入这个技能的领域行为、边界和执行说明。',
    enabled: true,
    updatedAt: new Date().toISOString(),
  };
}

export async function updateSkill(skill, patch) {
  if (Array.isArray(patch?.recipeIds)) assertRecipeIdsExist(patch.recipeIds);
  const builtIn = skill?.builtIn === true;
  Object.assign(skill, patch, { updatedAt: new Date().toISOString() });
  skill.builtIn = builtIn;
  await saveGlobalSkills();
}

export async function upsertSkill(input) {
  const existing = skillsStore.skills.find((item) => item.id === String(input.id || '').trim());
  const skill = {
    ...input,
    id: String(input.id || '').trim(),
    name: String(input.name || '').trim(),
    description: String(input.description || '').trim(),
    category: String(input.category || 'general').trim(),
    version: Math.max(1, Number(input.version) || 1),
    triggers: {
      keywords: [...new Set((input.triggers?.keywords || []).map((value) => String(value).trim()).filter(Boolean))],
    },
    instructions: String(input.instructions || '').trim(),
    recipeIds: [...new Set((input.recipeIds || []).map((value) => String(value).trim()).filter(Boolean))],
    enabled: input.enabled !== false,
    builtIn: existing?.builtIn === true,
    updatedAt: new Date().toISOString(),
  };
  if (!/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(skill.id)) {
    throw new Error('技能 ID 仅允许小写字母、数字和连字符，且首尾不能是连字符');
  }
  if (!skill.name || !skill.description || !skill.instructions) throw new Error('技能名称、用途说明和指令均不能为空');
  assertRecipeIdsExist(skill.recipeIds);
  const index = skillsStore.skills.findIndex((item) => item.id === skill.id);
  if (index >= 0) skillsStore.skills[index] = skill;
  else skillsStore.skills.push(skill);
  await saveGlobalSkills();
  return skill;
}

export async function toggleSkill(skillId) {
  const skill = skillsStore.skills.find((s) => s.id === skillId);
  if (!skill) return;
  skill.enabled = skill.enabled === false;
  await saveGlobalSkills();
}

export async function deleteSkill(skillId) {
  if (skillsStore.skills.find((skill) => skill.id === skillId)?.builtIn) return;
  skillsStore.skills = skillsStore.skills.filter((skill) => skill.id !== skillId);
  if (skillsStore.selectedSkillId === skillId) {
    skillsStore.selectedSkillId = skillsStore.skills[0]?.id || null;
  }
  await saveGlobalSkills();
}

function assertRecipeIdsExist(recipeIds = []) {
  const knownIds = new Set(recipesStore.recipes.map((recipe) => String(recipe.id)));
  const unknown = recipeIds.filter((recipeId) => !knownIds.has(String(recipeId)));
  if (unknown.length) throw new Error(`技能引用了不存在的策略：${unknown.join(', ')}`);
}

export async function resetSkillToBuiltIn(skillId) {
  const original = getBuiltInSkill(skillId);
  const index = skillsStore.skills.findIndex((skill) => skill.id === skillId);
  if (!original || index < 0) return false;
  const enabled = skillsStore.skills[index].enabled !== false;
  skillsStore.skills[index] = {
    ...JSON.parse(JSON.stringify(original)),
    enabled,
    builtIn: true,
    updatedAt: new Date().toISOString(),
  };
  await saveGlobalSkills();
  return true;
}
