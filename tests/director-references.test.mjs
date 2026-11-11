import assert from 'node:assert/strict';
import test from 'node:test';
import { directorReferenceCatalog, resolveDirectorReference } from '../renderer/src/services/agent/directorReferences.ts';

const snapshot = { document: { format: 'director-desk', version: 3, projectId: 'project-a', activeSceneId: 'scene-a', resources: [
  { id: 'model-a', name: '导入的茶几', package: { huge: 'model-bytes' }, copyright: '', license: '', source: 'local' },
], scenes: [
  { id: 'scene-a', name: '第一场', state: { entities: [{ id: 'actor-a', name: '主角', kind: 'actor', position: [1, 2, 3] }] } },
  { id: 'scene-b', name: '第二场', state: { entities: [{ id: 'actor-b', name: '配角', kind: 'actor' }] } },
] } };
const catalog = { assets: [{ id: 'chair-a', name: '椅子', kind: 'prop' }] };

test('导演台引用先列当前场景实体，再列可添加建模资产', () => {
  const entries = directorReferenceCatalog(snapshot, catalog);
  assert.deepEqual(entries.map(item => [item.label, item.referenceScope]), [
    ['主角', 'director-entity'], ['导入的茶几', 'director-asset'], ['椅子', 'director-asset'],
  ]);
  assert.equal(entries.some(item => item.label === '配角'), false);
  const resolved = resolveDirectorReference(entries[0].id, snapshot, catalog);
  assert.equal(resolved.snapshot.sceneId, 'scene-a');
  assert.deepEqual(resolved.snapshot.entity.position, [1, 2, 3]);
  const resource = resolveDirectorReference(entries[1].id, snapshot, catalog);
  assert.equal(resource.snapshot.resource.id, 'model-a');
  assert.doesNotMatch(JSON.stringify(resource), /model-bytes/);
  assert.equal(resolveDirectorReference(entries[2].id, snapshot, catalog).snapshot.asset.id, 'chair-a');
});

test('切换场景或替换场景对象后旧引用失效', () => {
  const id = directorReferenceCatalog(snapshot, catalog)[0].id;
  assert.throws(() => resolveDirectorReference(id, { document: { ...snapshot.document, activeSceneId: 'scene-b' } }, catalog), /失效/);
  assert.throws(() => resolveDirectorReference(id, { document: { ...snapshot.document, projectId: 'another-project' } }, catalog), /失效/);
  const resourceId = directorReferenceCatalog(snapshot, catalog)[1].id;
  assert.throws(() => resolveDirectorReference(resourceId, { document: { ...snapshot.document, resources: [] } }, catalog), /失效/);
});
