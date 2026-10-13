import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { agentDefinition } from '../renderer/src/agent/agents/definitions.ts';
import { selectAgentSkills } from '../renderer/src/agent/core/visibility.ts';

const runtime = readFileSync(new URL('../renderer/src/agent/runtime/OpenCodeRuntime.ts', import.meta.url), 'utf8');
const catalog = readFileSync(new URL('../renderer/src/agent/tools/catalogTools.ts', import.meta.url), 'utf8');
const prompt = readFileSync(new URL('../renderer/src/agent/content/prompts/system-base.md', import.meta.url), 'utf8');
const nativeSkills = readFileSync(new URL('../renderer/src/agent/runtime/nativeSkills.ts', import.meta.url), 'utf8');
const nativeRuntime = readFileSync(new URL('../src-tauri/src/commands/agent_runtime.rs', import.meta.url), 'utf8');

const enabledSkills = [
  { id: 'general' }, { id: 'video-production' }, { id: 'short-drama' }, { id: 'video-editing' },
];

test('每个 Agent 的 Skill 集合由自身定义决定', () => {
  // 画布主 Agent 授予全部已启用 Skill；剪辑 Agent 只有 video-editing；子 Agent 一个都不给。
  assert.deepEqual(selectAgentSkills(agentDefinition('canvas-primary'), enabledSkills), enabledSkills);
  assert.deepEqual(selectAgentSkills(agentDefinition('editor-primary'), enabledSkills), [{ id: 'video-editing' }]);
  for (const subagent of ['production-planner', 'stage-executor', 'result-reviewer']) {
    assert.deepEqual(selectAgentSkills(agentDefinition(subagent), enabledSkills), []);
  }
});

test('Skill 由 OpenCode 原生目录直接提供，不再先调用自定义目录工具', () => {
  assert.doesNotMatch(runtime, /routeSkill|agent: 'intent-router'|Skill Router/);
  assert.doesNotMatch(catalog, /id: 'inspect_skill_catalog'|id: 'load_skill'/);
  assert.match(runtime, /nativeRuntimeSkills\(availableAgentSkills\(context\.agentId\)\)/);
  // 作用域字符串不能重新回到运行时代码，Skill 归属只在 Agent 定义里声明。
  assert.doesNotMatch(runtime, /'general' \| 'video-editing'/);
  assert.match(runtime, /part\.type === 'tool' && part\.tool === 'skill'/);
  assert.match(nativeRuntime, /"skills": \{ "paths": skill_paths \}/);
  assert.match(nativeRuntime, /materialize_runtime_skills/);
  assert.match(nativeSkills, /name: \$\{id\}|## Workflow/);
  assert.match(prompt, /普通聊天、解释、分析和简单画布操作不需要 Skill/);
  assert.match(prompt, /原生 `skill` 工具/);
  assert.doesNotMatch(runtime, /当前没有已启用 Skill，助手无法启动/);
});

test('Skill 路由仍要求完整语义，不恢复关键词猜测', () => {
  assert.match(prompt, /不得按孤立关键词路由/);
  assert.equal(existsSync(new URL('../renderer/src/utils/skillRouting.mjs', import.meta.url)), false);
  assert.equal(existsSync(new URL('../renderer/src/agent/runtime/skillRoutingDecision.ts', import.meta.url)), false);
});
