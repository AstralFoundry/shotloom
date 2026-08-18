import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const runtime = readFileSync(new URL('../renderer/src/agent/runtime/OpenCodeRuntime.ts', import.meta.url), 'utf8');
const catalog = readFileSync(new URL('../renderer/src/agent/tools/catalogTools.ts', import.meta.url), 'utf8');
const prompt = readFileSync(new URL('../renderer/src/agent/content/prompts/system-base.md', import.meta.url), 'utf8');

test('Skill 选择并入主 Agent，不再用独立模型请求阻塞首 token', () => {
  assert.doesNotMatch(runtime, /routeSkill|agent: 'intent-router'|Skill Router/);
  assert.match(catalog, /id: 'inspect_skill_catalog'/);
  assert.match(catalog, /id: 'load_skill'/);
  assert.match(prompt, /普通聊天、解释、分析和简单画布操作不需要 Skill/);
});

test('Skill 路由仍要求完整语义，不恢复关键词猜测', () => {
  assert.match(catalog, /不要按孤立关键词选择/);
  assert.match(prompt, /不得按孤立关键词路由/);
  assert.equal(existsSync(new URL('../renderer/src/utils/skillRouting.mjs', import.meta.url)), false);
  assert.equal(existsSync(new URL('../renderer/src/agent/runtime/skillRoutingDecision.ts', import.meta.url)), false);
});
