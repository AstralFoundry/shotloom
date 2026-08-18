import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agentNodeAliasMaps,
  agentNodeStableAlias,
} from '../renderer/src/services/agentNodeAlias.mjs';

test('画布节点使用稳定的短别名而不是完整 UUID', () => {
  assert.equal(
    agentNodeStableAlias({ id: '43aafd82-f802-4a0d-ba7b-e3aaaac09f87' }),
    'N-43AAFD82F8',
  );
});

test('短别名碰撞时添加稳定序号', () => {
  const maps = agentNodeAliasMaps([
    { id: '43aafd82-f802-first' },
    { id: '43aafd82-f802-second' },
  ]);
  assert.equal(maps.aliasById['43aafd82-f802-first'], 'N-43AAFD82F8');
  assert.equal(maps.aliasById['43aafd82-f802-second'], 'N-43AAFD82F8-02');
});
