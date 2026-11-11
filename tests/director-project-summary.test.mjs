import assert from 'node:assert/strict';
import test from 'node:test';
import { directorProjectSummary } from '../renderer/src/app/canvas/directorProjectSummary.ts';

test('导演台卡片从重新读取的持久化场景恢复当前戏段统计', () => {
  const saved = {
    format: 'director-desk', version: 3, activeSceneId: 'second',
    scenes: [
      { id: 'first', state: { entities: [{ kind: 'actor' }], cuts: [], duration: 5 } },
      { id: 'second', state: { entities: [{ kind: 'actor' }, { kind: 'crowd' }, { kind: 'camera' }], cuts: [{ time: 0 }, { time: 8 }], duration: 15 } },
    ],
  };
  const reopened = JSON.parse(JSON.stringify(saved));
  assert.deepEqual(directorProjectSummary(reopened), { actors: 2, cameras: 1, shots: 2, duration: 15 });
  assert.equal(directorProjectSummary({ ...reopened, activeSceneId: 'missing' }), null);
  assert.equal(directorProjectSummary(null), null);
});
