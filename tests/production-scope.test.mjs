import assert from 'node:assert/strict';
import test from 'node:test';

import { readSource } from './helpers/sourceContract.mjs';

test('制作范围由模型理解完整语义，不由产品工具预分类', () => {
  const guide = readSource('AGENTS.md');
  const tools = readSource('renderer/src/services/harnessProductTools.ts');
  assert.match(guide, /不要在应用代码中用关键词、正则/);
  assert.doesNotMatch(tools, /decideProductionRequest|productionScopeAmbiguous|requiresProductionPlan|productionIntent|productionSourceUnitCount/);
});
