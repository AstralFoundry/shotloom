import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canRequestAgentClarification,
  clearAgentToolsForTests,
  listAgentTools,
  prepareAgentToolCall,
  registerAgentTool,
} from '../renderer/src/agent/core/toolRegistry.ts';

test('唯一 Agent 可在关键信息缺失时询问', () => {
  assert.equal(canRequestAgentClarification(), true);
});

test('命名空间工具预先暴露，但执行前必须加载对应 Skill', () => {
  clearAgentToolsForTests();
  registerAgentTool({
    id: 'skill_short_drama__inspect_structure',
    title: '拆分场次',
    description: '测试工具',
    effect: 'agent_state_write',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: () => ({ success: true }),
  });
  const context = {
    requestId: 'test', turnId: 'turn', projectKey: 'project', conversationId: 'conversation',
    signal: new AbortController().signal,
    loadedSkillIds: new Set(['video-production']), attachments: [],
    capabilities: { nodeExecution: false }, state: new Map(), emit: () => {},
  };
  assert.deepEqual(listAgentTools(context).map((tool) => tool.id), ['skill_short_drama__inspect_structure']);
  assert.throws(
    () => prepareAgentToolCall('skill_short_drama__inspect_structure', '{}', context),
    /requires its Skill to be loaded first/,
  );
  context.loadedSkillIds = new Set(['short-drama']);
  assert.equal(prepareAgentToolCall('skill_short_drama__inspect_structure', '{}', context).definition.id,
    'skill_short_drama__inspect_structure');
  clearAgentToolsForTests();
});

test('默认 Agent 工具以真实注册表为准并允许 Runtime 重复激活', () => {
  const source = readFileSync(
    new URL('../renderer/src/agent/tools/registerDefaultTools.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /hasAgentTool\('get_canvas'\)/);
  assert.doesNotMatch(source, /let registered = false/);
});
