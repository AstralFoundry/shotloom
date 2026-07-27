import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const roles = readFileSync(new URL('../renderer/src/services/agentInputRole.ts', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('../renderer/src/app/adapters/canvasAdapter.ts', import.meta.url), 'utf8');
test('画布允许先连线，模型输入能力留到运行前检查', () => {
  assert.doesNotMatch(roles, /getModelInputCapabilityForRoles/); assert.match(roles, /return \{ valid: true, role \}/);
});
test('React 画布通过唯一边持久化函数创建连线', () => {
  assert.match(adapter, /import \{ addCanvasEdge \}/); assert.match(adapter, /addCanvasEdge\(store\.project, connection\.source, connection\.target/);
});
