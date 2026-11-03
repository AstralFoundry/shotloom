import assert from 'node:assert/strict';
import test from 'node:test';
import { sortEnabledFirst } from '../renderer/src/services/catalogOrder.ts';

test('技能列表把已启用项排在停用项之前且保持组内原有顺序', () => {
  const items = [
    { id: 'disabled-first', enabled: false },
    { id: 'enabled-first', enabled: true },
    { id: 'enabled-implicit' },
    { id: 'disabled-second', enabled: false },
    { id: 'enabled-second', enabled: true },
  ];

  assert.deepEqual(
    sortEnabledFirst(items).map((item) => item.id),
    ['enabled-first', 'enabled-implicit', 'enabled-second', 'disabled-first', 'disabled-second'],
  );
  assert.deepEqual(
    items.map((item) => item.id),
    ['disabled-first', 'enabled-first', 'enabled-implicit', 'disabled-second', 'enabled-second'],
  );
});
