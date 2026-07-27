import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canRequestAgentClarification,
  clearAgentToolsForTests,
  listAgentTools,
  registerAgentTool,
} from '../renderer/src/agent/core/toolRegistry.ts';

test('唯一 Agent 可在关键信息缺失时询问', () => {
  assert.equal(canRequestAgentClarification(), true);
});

test('命名空间工具只对实际加载的 Skill 可见', () => {
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
  assert.equal(listAgentTools(context).length, 0);
  context.loadedSkillIds = new Set(['short-drama']);
  assert.deepEqual(listAgentTools(context).map((tool) => tool.id), ['skill_short_drama__inspect_structure']);
  clearAgentToolsForTests();
});
