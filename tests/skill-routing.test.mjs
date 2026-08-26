import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const runtime = readFileSync(new URL('../renderer/src/agent/runtime/OpenCodeRuntime.ts', import.meta.url), 'utf8');
const catalog = readFileSync(new URL('../renderer/src/agent/tools/catalogTools.ts', import.meta.url), 'utf8');
const prompt = readFileSync(new URL('../renderer/src/agent/content/prompts/system-base.md', import.meta.url), 'utf8');
const nativeSkills = readFileSync(new URL('../renderer/src/agent/runtime/nativeSkills.ts', import.meta.url), 'utf8');
const nativeRuntime = readFileSync(new URL('../src-tauri/src/commands/agent_runtime.rs', import.meta.url), 'utf8');

test('Skill 由 OpenCode 原生目录直接提供，不再先调用自定义目录工具', () => {
  assert.doesNotMatch(runtime, /routeSkill|agent: 'intent-router'|Skill Router/);
  assert.doesNotMatch(catalog, /id: 'inspect_skill_catalog'|id: 'load_skill'/);
  assert.match(runtime, /nativeRuntimeSkills\(availableAgentSkills\(\)\)/);
  assert.match(runtime, /part\.type === 'tool' && part\.tool === 'skill'/);
  assert.match(nativeRuntime, /"skills": \{ "paths": skill_paths \}/);
  assert.match(nativeRuntime, /materialize_runtime_skills/);
  assert.match(nativeSkills, /SKILL\.md|Shotloom Recipe Scope/);
  assert.match(prompt, /普通聊天、解释、分析和简单画布操作不需要 Skill/);
  assert.match(prompt, /原生 `skill` 工具/);
  assert.doesNotMatch(runtime, /当前没有已启用 Skill，助手无法启动/);
});

test('Skill 路由仍要求完整语义，不恢复关键词猜测', () => {
  assert.match(prompt, /不得按孤立关键词路由/);
  assert.equal(existsSync(new URL('../renderer/src/utils/skillRouting.mjs', import.meta.url)), false);
  assert.equal(existsSync(new URL('../renderer/src/agent/runtime/skillRoutingDecision.ts', import.meta.url)), false);
});
