import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('native runtime supervisor provides health watchdog, stall detection and circuit breaking', () => {
  const runtime = read('src-tauri/src/commands/agent_runtime.rs');
  assert.match(runtime, /failure_times_ms: VecDeque<u128>/);
  assert.match(runtime, /circuit_open_until_ms/);
  assert.match(runtime, /failed three consecutive health probes/);
  assert.match(runtime, /session_stalled/);
  assert.match(runtime, /agent_runtime_diagnostics/);
  assert.match(runtime, /agent_runtime_note_activity/);
});

test('native runtime atomically materializes enabled Skills for OpenCode', () => {
  const runtime = read('src-tauri/src/commands/agent_runtime.rs');
  assert.match(runtime, /pub skills: Vec<RuntimeSkill>/);
  assert.match(runtime, /runtime_root\.join\("skills-next"\)/);
  assert.match(runtime, /std::fs::rename\(&staging, &target\)/);
  assert.match(runtime, /"skills": \{ "paths": skill_paths \}/);
  assert.match(runtime, /valid_native_skill_id/);
});

test('OpenCode 原生裁剪工具输出并在压缩上下文时通知界面', () => {
  const nativeRuntime = read('src-tauri/src/commands/agent_runtime.rs');
  const runtime = read('renderer/src/agent/runtime/OpenCodeRuntime.ts');
  const presenter = read('renderer/src/app/copilot/CopilotRuntimePresenter.ts');
  assert.match(nativeRuntime, /"tool_output": \{/);
  assert.match(nativeRuntime, /"max_lines": 2000/);
  assert.match(nativeRuntime, /"max_bytes": 51200/);
  assert.match(nativeRuntime, /"compaction": \{[\s\S]*?"prune": true/);
  assert.match(runtime, /event\.type === 'session\.compacted'/);
  assert.match(runtime, /part\.type === 'compaction'/);
  assert.match(presenter, /event\.type === 'context_compaction'/);
  assert.match(presenter, /kind: 'system'/);
  assert.doesNotMatch(presenter, /droppedHistoryCount/);
});

test('workspace writes use instance, generation and canvas revision fences', () => {
  const identity = read('renderer/src/services/agentProjectIdentity.ts');
  const tools = read('renderer/src/agent/tools/canvasTools.ts');
  const executor = read('renderer/src/services/agent/agentCanvasExecutor.ts');
  assert.match(identity, /instanceId: string/);
  assert.match(identity, /generation: number/);
  assert.match(tools, /expectedCanvasFingerprint/);
  assert.match(tools, /AgentCanvasRevisionConflictError/);
  assert.match(executor, /body\.projectInstanceId/);
  assert.match(executor, /body\.projectGeneration/);
});

test('provider configuration has a secret-free last-known-good fallback', () => {
  const runtime = read('renderer/src/agent/runtime/OpenCodeRuntime.ts');
  assert.match(runtime, /stripProviderSecrets/);
  assert.match(runtime, /agent-provider-lkg\.json/);
  assert.match(runtime, /providerLkgFallback/);
  assert.match(runtime, /stripProviderSecrets[\s\S]*authorization/i);
});

test('crash recovery persists heartbeats and relieves sustained memory pressure', () => {
  const recovery = read('src-tauri/src/commands/recovery.rs');
  const workbench = read('renderer/src/app/ReactWorkbench.tsx');
  assert.match(recovery, /runtime-recovery\.json/);
  assert.match(recovery, /previous-unclean-exit\.json/);
  assert.match(recovery, /system-memory-pressure/);
  assert.match(recovery, /low_memory_polls/);
  assert.match(workbench, /recoverInterruptedAgentRuns/);
  assert.match(workbench, /relieveAgentHistoryMemoryPressure/);
});

test('durable JSON storage isolates corruption and rejects legacy schemas', () => {
  const common = read('src-tauri/src/commands/common.rs');
  const settings = read('src-tauri/src/commands/settings.rs');
  const projects = read('renderer/src/store/projectStore.js')
    + read('renderer/src/store/projectNormalization.js');
  assert.match(common, /\.corrupt-\{stamp\}/);
  assert.match(common, /tmp-\{\}/);
  assert.match(settings, /SETTINGS_STORAGE_VERSION: u64 = 7/);
  assert.match(settings, /fn validate_current_settings/);
  assert.doesNotMatch(settings, /fn migrate_settings/);
  assert.match(projects, /PROJECT_SCHEMA_VERSION = 2/);
  assert.match(projects, /function assertCurrentProjectSchema/);
  assert.doesNotMatch(projects, /function migrateProject\s*\(/);
});

test('agent hot paths use coalesced streaming, bounded delivery and latest-wins persistence', () => {
  const presenter = read('renderer/src/app/copilot/CopilotRuntimePresenter.ts');
  const adapter = read('renderer/src/app/adapters/copilotAdapter.ts');
  const saveQueue = read('renderer/src/services/latestSaveQueue.mjs');
  assert.match(presenter, /cachedStructuralSnapshot/);
  assert.match(adapter, /window\.setTimeout\(flush, 32\)/);
  assert.match(adapter, /MAX_QUEUED_DELIVERIES = 3/);
  assert.match(adapter, /deliveryStage: "queued"/);
  assert.match(saveQueue, /pendingLatest/);
  assert.match(saveQueue, /maxRetryAttempts/);
  assert.match(saveQueue, /waitForIdle\(\)/);
});

test('plan writes fence stale revisions and runtime failures are structured', () => {
  const plans = read('renderer/src/agent/runtime/productionPlanStore.ts');
  const tools = read('renderer/src/agent/tools/productionPlanTools.ts');
  const diagnostics = read('renderer/src/agent/runtime/runtimeDiagnostics.ts');
  const sessions = read('renderer/src/services/copilotSessionLifecycle.mjs');
  assert.match(plans, /StaleProductionPlanRevisionError/);
  assert.match(tools, /expectedRevision/);
  assert.match(diagnostics, /runtime_port_conflict/);
  assert.match(diagnostics, /runtime_tool_bridge/);
  assert.ok(diagnostics.indexOf('runtime_tool_bridge') < diagnostics.indexOf('runtime_network'));
  assert.match(diagnostics, /circuitOpenUntilMs/);
  assert.match(sessions, /DEFAULT_KEEP_COUNT = 80/);
  assert.match(sessions, /expandCopilotArchivesForPersistence/);
});
