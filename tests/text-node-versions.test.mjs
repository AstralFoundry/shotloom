import assert from 'node:assert/strict';
import test from 'node:test';
import { updatedTextVersions } from '../renderer/src/utils/textNodeVersions.mjs';

test('text versions preserve saved content and recovery creates a new revision', () => {
  const first = updatedTextVersions({ textContent: '初稿', updatedAt: '2026-01-01T00:00:00.000Z' }, '修改稿', '2026-01-02T00:00:00.000Z');
  assert.deepEqual(first.map((version) => version.content), ['初稿', '修改稿']);
  const restored = updatedTextVersions({ textContent: '修改稿', textVersions: first }, '初稿', '2026-01-03T00:00:00.000Z');
  assert.deepEqual(restored.map((version) => version.content), ['初稿', '修改稿', '初稿']);
  assert.equal(updatedTextVersions({ textContent: '初稿', textVersions: restored }, '初稿').length, 3);
});
