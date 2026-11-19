import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSkillImport, saveSkills, type Skill, type SkillCatalog } from '../src/skills';

const skill: Skill = { id: 'story-outline', name: 'Story outline', description: 'Plan a story', instructions: 'Write the outline', category: 'text', version: 1, enabled: true, agentIds: ['canvas-primary'], metadata: { source: 'user' }, contracts: ['preserve-me'] };
function fixture(catalog: SkillCatalog, fail = false) {
  const writes: SkillCatalog[] = [];
  const cache = new Map<string, unknown>();
  return { writes, cache, api: { setCached(path: string, value: unknown) { cache.set(path, value); }, async request<T>(_path: string, method = 'GET', value?: unknown): Promise<T> { if (method === 'GET') return structuredClone(catalog) as T; if (fail) throw new Error('Unavailable'); writes.push(value as SkillCatalog); return null as T; } } };
}
test('editing one native skill preserves other skills, metadata and catalog fields', async () => {
  const other = { ...skill, id: 'other-skill' };
  const f = fixture({ storageVersion: 2, skills: [skill, other], extra: 'preserve', systemSkillIds: ['reserved'] });
  const saved = await saveSkills(f.api, [{ ...skill, enabled: false }], { expected: skill });
  assert.deepEqual(saved.skills?.[0]?.metadata, skill.metadata);
  assert.deepEqual(saved.skills?.[0]?.contracts, skill.contracts);
  assert.deepEqual(saved.skills?.[1], other);
  assert.equal(saved.skills?.[0]?.enabled, false);
  assert.equal(f.writes[0]?.extra, 'preserve');
  assert.equal(f.writes[0]?.systemSkillIds, undefined);
  assert.deepEqual(f.cache.get('/catalog/skills'), saved);
});
test('reserved IDs, duplicate creation and stale edits cannot overwrite stored skills', async () => {
  const f = fixture({ skills: [skill], systemSkillIds: ['reserved'] });
  await assert.rejects(saveSkills(f.api, [{ ...skill, id: 'reserved' }]), /read-only/);
  await assert.rejects(saveSkills(f.api, [skill], { create: true }), /already exists/);
  await assert.rejects(saveSkills(f.api, [{ ...skill, name: 'Changed' }], { expected: { ...skill, version: 2 } }), /changed/);
  assert.equal(f.writes.length, 0);
  assert.equal(f.cache.size, 0);
});
test('imports accept web catalog and single-skill formats, validating all items before writes', async () => {
  assert.deepEqual(parseSkillImport({ format: 'shotloom.skill-catalog', skills: [skill] }), [skill]);
  assert.deepEqual(parseSkillImport({ skill }), [skill]);
  assert.throws(() => parseSkillImport({ skills: [skill, { ...skill, id: '../admin' }] }), /skill ID/);
  assert.throws(() => parseSkillImport({ ...skill, builtIn: true }), /read-only/);
  assert.throws(() => parseSkillImport({ ...skill, instructions: ' ' }), /required/);
  const f = fixture({ skills: [skill] }, true);
  await assert.rejects(saveSkills(f.api, [{ ...skill, enabled: false }]), /Unavailable/);
  assert.equal(f.writes.length, 0);
});
test('deletion removes only the selected existing skill', async () => {
  const other = { ...skill, id: 'other-skill' };
  const f = fixture({ skills: [skill, other] });
  const saved = await saveSkills(f.api, [], { remove: skill });
  assert.deepEqual(saved.skills, [other]);
});
test('JSON object key order from storage does not look like a conflicting edit', async () => {
  const { instructions, ...rest } = skill;
  const f = fixture({ skills: [{ instructions, ...rest }] });
  await saveSkills(f.api, [{ ...skill, name: 'Renamed' }], { expected: skill });
  assert.equal(f.writes[0]?.skills?.[0]?.name, 'Renamed');
});
