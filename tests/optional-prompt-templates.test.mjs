import * as productFacts from './helpers/productFacts.mjs';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env;
let registry;
let recipesStore;
let skills;
let createAgentRunFacts;
let createAgentSessionState;

before(async () => {
  env = await createRendererEnv();
  registry = await env.load('agent/core/toolRegistry');
  ({ recipesStore } = await env.load('store/recipesStore'));
  skills = await env.load('services/builtInSkills');
  ({ createAgentRunFacts, createAgentSessionState } = await Promise.resolve(productFacts));
  const { registerCatalogTools } = await env.load('agent/tools/catalogTools');
  registerCatalogTools();
  recipesStore.recipes = [
    { id: 'image-reference', generationType: 'image', enabled: true, systemPrompt: 'Compose around the subject.' },
    { id: 'video-reference', generationType: 'video', enabled: true },
    { id: 'disabled-reference', generationType: 'image', enabled: false },
  ];
});
after(async () => { await env?.dispose(); });

test('templates are accessible without a loaded Skill, but disabled and missing records are rejected', async () => {
  const { t } = await env.load('i18n/index');
  const events = [];
  const context = {
    loadedSkillIds: new Set(), signal: new AbortController().signal,
    agentId: 'canvas-primary',
    capabilities: { nodeExecution: false }, run: createAgentRunFacts(), state: createAgentSessionState(), emit: (event) => events.push(event),
  };
  const list = registry.prepareAgentToolCall('list_recipes', '{"generationType":"image"}', context);
  const result = await list.definition.execute(list.input, context);
  assert.deepEqual(result.recipes.map((item) => item.id), ['image-reference']);
  const load = registry.prepareAgentToolCall('load_recipe', '{"recipeId":"image-reference"}', context);
  assert.equal((await load.definition.execute(load.input, context)).instructions, 'Compose around the subject.');
  assert.equal(events[0].recipeId, 'image-reference');
  for (const id of ['disabled-reference', 'missing-reference']) {
    const call = registry.prepareAgentToolCall('load_recipe', JSON.stringify({ recipeId: id }), context);
    assert.throws(() => call.definition.execute(call.input, context), { message: t('tool.feedback.recipeMissing', { id }) });
  }
});

test('built-in skills start enabled or disabled according to SKILL.md metadata', () => {
  const byId = new Map(skills.builtInSkills.map((item) => [item.id, item]));
  assert.equal(byId.get('script-storyboard').enabled, true);
  assert.equal(byId.get('3d-animation-short-generator').enabled, false);

  const hydrated = skills.withBuiltInSkills({ storageVersion: 1, skills: [] });
  assert.equal(hydrated.skills.find((item) => item.id === 'script-storyboard').enabled, true);
  assert.equal(hydrated.skills.find((item) => item.id === '3d-animation-short-generator').enabled, false);
});

test('Skill persistence retains custom instructions and removes obsolete template bindings', () => {
  const entry = { id: 'custom', instructions: 'My own workflow', enabled: false, recipeIds: ['gone'] };
  const saved = skills.withoutBuiltInSkills({ storageVersion: 1, skills: [entry] });
  const restored = skills.withBuiltInSkills(saved).skills.find((item) => item.id === 'custom');
  assert.equal(restored.instructions, entry.instructions);
  assert.equal(restored.enabled, false);
  assert.equal(Object.hasOwn(restored, 'recipeIds'), false);
  assert.ok(skills.builtInSkills.every((item) => !Object.hasOwn(item, 'recipeIds')));
});
