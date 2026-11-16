import assert from 'node:assert/strict';

import test from 'node:test';
import { readSource } from './helpers/sourceContract.mjs';

const read = (path) => readSource(path);

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

test('crash recovery persists heartbeats and relieves sustained memory pressure', () => {
  const recovery = read('electron/core/recovery.ts');
  const workbench = read('renderer/src/app/ReactWorkbench.tsx');
  assert.match(recovery, /saveRecovery\(/);
  assert.match(recovery, /previous-unclean-exit/);
  assert.match(recovery, /system-memory-pressure/);
  assert.match(recovery, /lowMemoryPolls/);
  assert.match(recovery, /startHeartbeat/);
  assert.match(workbench, /installMediaPreviewCacheMemoryPressureListener/);
});

test('SQLite storage uses ORM and rejects legacy schemas', () => {
  const database = read('electron/core/db.ts');
  const settings = read('electron/ipc/commands/settings.ts');
  const projects = read('renderer/src/store/projectStore.ts')
    + read('renderer/src/store/projectNormalization.ts');
  assert.match(database, /new DatabaseSync\(/);
  assert.match(database, /journal_mode = WAL/);
  assert.match(settings, /SETTINGS_STORAGE_VERSION = 7/);
  assert.match(settings, /function validateCurrentSettings/);
  assert.doesNotMatch(settings, /fn migrate_settings/);
  assert.match(projects, /PROJECT_SCHEMA_VERSION = 2/);
  assert.match(projects, /function assertCurrentProjectSchema/);
  assert.doesNotMatch(projects, /function migrateProject\s*\(/);
});



test('agent canvas writes land in one typed action module', () => {
  const executor = read('renderer/src/services/agent/agentCanvasExecutor.ts');
  const handlers = read('renderer/src/services/agent/agentActionHandlers.ts');
  // 工具层 → 执行器（批次）→ 动作实现（单一落点）→ 存储；不得再插入注册表转接层。
  assert.doesNotMatch(executor, /actionRegistry|registerDefaultActions|dispatchAction\(/);
  assert.match(handlers, /export async function applyAgentAction/);
  assert.match(handlers, /switch \(action\?\.type\)/);
  // 上下文只暴露项目本体与引用解析，动作实现不能再拿到可随意塞状态的宽松记录。
  assert.match(handlers, /export interface ActionHandlerContext \{[^}]*resolveNodeId/s);
  assert.doesNotMatch(handlers, /interface ActionHandlerContext \{[^}]*\[key: string]/s);
  // create_gen_node 的 inputLinks 与 connect_nodes 必须共用同一套输入边写入，
  // 否则两个工具入口会持久化出两种边结构。
  assert.match(handlers, /connectInputEdge\(node\.id/);
  assert.match(handlers, /connectInputEdge\(targetId/);
});

test('plan writes fence stale revisions and session archives stay bounded', () => {
  const plans = read('renderer/src/store/productionPlanStore.ts');
  const tools = read('renderer/src/agent/tools/productionPlanTools.ts');
  assert.match(plans, /StaleProductionPlanRevisionError/);
  assert.match(tools, /expectedRevision/);
});
