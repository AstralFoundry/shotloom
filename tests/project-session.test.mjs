import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProjectSession,
  hasFullProjectSessionSnapshot,
} from '../renderer/src/utils/projectSession.mjs';

test('已落盘项目的会话只保存轻量身份，不重复保存大型画布数据', () => {
  const project = {
    id: 'project-1',
    schema: 'shotloom-project',
    name: '大型项目',
    nodes: [{ id: 'node-1', output: 'x'.repeat(6_000_000) }],
    edges: [{ id: 'edge-1' }],
    tasks: [{ id: 'task-1', result: 'x'.repeat(6_000_000) }],
    library: { assetRootDir: '/projects/assets' },
    settings: { autoSave: true },
  };

  const session = buildProjectSession({
    project,
    projectDir: '/projects/demo',
    filePath: '/projects/demo/project.shotloom.json',
  });

  assert.equal(session.snapshotKind, 'identity');
  assert.equal(session.project.name, '大型项目');
  assert.equal(session.project.library.assetRootDir, '/projects/assets');
  assert.equal('nodes' in session.project, false);
  assert.equal('tasks' in session.project, false);
  assert.ok(JSON.stringify(session).length < 2_000);
  assert.equal(hasFullProjectSessionSnapshot(session), false);
});

test('未落盘项目和旧版完整会话仍可恢复', () => {
  const project = { nodes: [{ id: 'node-1' }], edges: [] };
  const session = buildProjectSession({ project, projectDir: null, filePath: null });

  assert.equal(session.snapshotKind, 'full');
  assert.equal(session.project, project);
  assert.equal(hasFullProjectSessionSnapshot(session), true);
  assert.equal(hasFullProjectSessionSnapshot({ project }), true);
});
