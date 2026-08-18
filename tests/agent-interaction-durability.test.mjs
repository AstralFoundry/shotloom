import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runStore = readFileSync(new URL('../renderer/src/agent/runtime/runStore.ts', import.meta.url), 'utf8');
const projectStore = readFileSync(new URL('../renderer/src/store/projectStore.js', import.meta.url), 'utf8')
  + readFileSync(new URL('../renderer/src/store/projectNormalization.js', import.meta.url), 'utf8');
const closeGuard = readFileSync(new URL('../renderer/src/composables/useWindowClose.js', import.meta.url), 'utf8');
const lifecycle = readFileSync(new URL('../renderer/src/agent/tools/lifecycleTools.ts', import.meta.url), 'utf8');

test('Agent 问题和工具确认使用统一的项目级持久化交互', () => {
  assert.match(projectStore, /agentInteractions: \[\]/);
  assert.match(projectStore, /agentInteractions: Array\.isArray\(project\?\.agentInteractions\)/);
  assert.match(runStore, /kind: AgentInteractionKind/);
  assert.match(runStore, /status: AgentInteractionStatus/);
  assert.match(runStore, /continuation: AgentRunContinuation/);
  assert.match(runStore, /expiresAt: string/);
});

test('结构化澄清支持批量问题且关闭窗口受 Runtime 健康状态保护', () => {
  assert.match(lifecycle, /type: 'array', minItems: 1/);
  assert.doesNotMatch(lifecycle, /clarificationCount|maxItems: 3(?:\s*[,}])|questions\.length > 3/);
  assert.match(lifecycle, /multiple: \{ type: 'boolean' \}/);
  assert.match(closeGuard, /getAgentRuntimeHealth/);
  assert.match(closeGuard, /blockingReasons/);
});
