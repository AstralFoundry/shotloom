import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createServer } from 'vite';

let server;
let registry;
let recipesStore;
let skills;

before(async () => {
  server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  registry = await server.ssrLoadModule('/src/agent/core/toolRegistry.ts');
  ({ recipesStore } = await server.ssrLoadModule('/src/store/recipesStore.js'));
  skills = await server.ssrLoadModule('/src/services/builtInSkills.js');
  const { registerCatalogTools } = await server.ssrLoadModule('/src/agent/tools/catalogTools.ts');
  registerCatalogTools();
  recipesStore.recipes = [
    { id: 'image-reference', generationType: 'image', enabled: true, systemPrompt: 'Compose around the subject.' },
    { id: 'video-reference', generationType: 'video', enabled: true },
    { id: 'disabled-reference', generationType: 'image', enabled: false },
  ];
});
after(async () => { await server?.close(); });

test('templates are accessible without a loaded Skill, but disabled and missing records are rejected', async () => {
  const events = [];
  const context = {
    loadedSkillIds: new Set(), signal: new AbortController().signal,
    capabilities: { nodeExecution: false }, state: new Map(), emit: (event) => events.push(event),
  };
  const list = registry.prepareAgentToolCall('list_recipes', '{"generationType":"image"}', context);
  const result = await list.definition.execute(list.input, context);
  assert.deepEqual(result.recipes.map((item) => item.id), ['image-reference']);
  const load = registry.prepareAgentToolCall('load_recipe', '{"recipeId":"image-reference"}', context);
  assert.equal((await load.definition.execute(load.input, context)).instructions, 'Compose around the subject.');
  assert.equal(events[0].recipeId, 'image-reference');
  for (const id of ['disabled-reference', 'missing-reference']) {
    const call = registry.prepareAgentToolCall('load_recipe', JSON.stringify({ recipeId: id }), context);
    assert.throws(() => call.definition.execute(call.input, context), /not found or disabled/);
  }
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
