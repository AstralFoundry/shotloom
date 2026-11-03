import assert from 'node:assert/strict';

import test from 'node:test';
import { readSource } from './helpers/sourceContract.mjs';
const roles = readSource('renderer/src/services/agentInputRole.ts');
const adapter = readSource('renderer/src/app/adapters/canvasAdapter.ts');
test('画布允许先连线，模型输入能力留到运行前检查', () => {
  assert.doesNotMatch(roles, /getModelInputCapabilityForRoles/); assert.match(roles, /return \{ valid: true, role \}/);
});
test('React 画布通过唯一边持久化函数创建连线', () => {
  assert.match(adapter, /import \{[^}]*\baddCanvasEdge\b[^}]*\}/); assert.match(adapter, /addCanvasEdge\(store\.project, connection\.source, connection\.target/);
});
