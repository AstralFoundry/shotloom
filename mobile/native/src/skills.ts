import type { NativeApi } from './api';

export type Skill = { id: string; name: string; description: string; category: string; version: number; instructions: string; enabled: boolean; agentIds?: string[]; updatedAt?: string; builtIn?: boolean; [key: string]: unknown };
export type SkillCatalog = { storageVersion?: number; skills?: Skill[]; systemSkillIds?: string[]; [key: string]: unknown };
const fingerprint = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
export function normalizeSkill(input: unknown): Skill {
  if (!input || typeof input !== 'object') throw new Error('Invalid skill');
  const value = input as Record<string, unknown>;
  const skill = { ...value, id: String(value.id || '').trim(), name: String(value.name || '').trim(), description: String(value.description || '').trim(), instructions: String(value.instructions || '').trim(), category: String(value.category || 'general').trim(), version: Number(value.version || 1), enabled: value.enabled !== false } as Skill;
  if (skill.builtIn) throw new Error('System skills are read-only');
  if (!/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(skill.id)) throw new Error('Use a skill ID containing lowercase letters, numbers and hyphens (1–80 characters).');
  if (!skill.name || !skill.description || !skill.instructions) throw new Error('Name, description and instructions are required.');
  if (!Number.isInteger(skill.version) || skill.version < 1) throw new Error('Version must be a positive integer.');
  if (skill.agentIds && (!Array.isArray(skill.agentIds) || skill.agentIds.some(id => typeof id !== 'string'))) throw new Error('Invalid agent assignments');
  delete skill.recipeIds;
  return skill;
}
export function parseSkillImport(payload: unknown): Skill[] {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const items = Array.isArray(payload) ? payload : Array.isArray(record.skills) ? record.skills : [record.skill || payload];
  if (!items.length) throw new Error('No skills in this file');
  return items.map(normalizeSkill);
}
export async function saveSkills(api: Pick<NativeApi, 'request' | 'setCached'>, edits: Skill[], options: { remove?: Skill; expected?: Skill; create?: boolean } = {}): Promise<SkillCatalog> {
  const catalog = await api.request<SkillCatalog>('/catalog/skills');
  const skills = catalog.skills || [];
  const normalized = edits.map(normalizeSkill);
  const ids = [...normalized.map(skill => skill.id), ...(options.remove ? [options.remove.id] : [])];
  if (ids.some(id => catalog.systemSkillIds?.includes(id))) throw new Error('System skills are read-only');
  if (options.create && normalized.some(skill => skills.some(current => current.id === skill.id))) throw new Error('A skill with this ID already exists.');
  const expected = options.expected || options.remove;
  if (expected && fingerprint(skills.find(skill => skill.id === expected.id)) !== fingerprint(expected)) throw new Error('This skill changed on another page. Refresh before saving.');
  const next = new Map(skills.map(skill => [skill.id, skill]));
  if (options.remove) next.delete(options.remove.id);
  for (const skill of normalized) next.set(skill.id, { ...skill, updatedAt: new Date().toISOString() });
  const { systemSkillIds, ...stored } = catalog;
  const value = { ...stored, storageVersion: catalog.storageVersion || 1, skills: [...next.values()] };
  await api.request('/catalog/skills', 'PUT', value);
  const saved = { ...value, systemSkillIds };
  api.setCached('/catalog/skills', saved);
  return saved;
}
