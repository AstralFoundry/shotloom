import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreMissingGeneratedFiles } from '../renderer/src/services/generatedFileRestoration.ts';

test('startup checks only restorable generated files, without waiting for unrelated uploads', async () => {
  const checked = [];
  const generated = { id: 'generated', path: '/generated.png', source: 'generation', remoteUrl: 'https://example.test/result' };
  const uploaded = { id: 'uploaded', path: '/uploaded.png', source: 'upload' };
  const fileApi = {
    async checkPaths(paths) { checked.push(paths); return paths.map(path => ({ path, status: 'exists' })); },
    async downloadUrlToProject() { assert.fail('existing files must not download'); },
  };
  assert.deepEqual(await restoreMissingGeneratedFiles({ materials: [uploaded] }, fileApi), { restored: 0, failures: [] });
  assert.deepEqual(checked, []);
  await restoreMissingGeneratedFiles({ materials: [uploaded, generated] }, fileApi);
  assert.deepEqual(checked, [['/generated.png']]);
});

test('permission and network failures preserve references without triggering downloads; duplicate paths share checks', async () => {
  const materials = ['a', 'b', 'c'].map(id => ({ id, path: id === 'c' ? '/denied' : '/offline', source: 'generation', remoteUrl: `https://example.test/${id}` }));
  const checked = [];
  const result = await restoreMissingGeneratedFiles({ materials }, {
    pathExists: async path => { checked.push(path); throw new Error(path === '/denied' ? 'HTTP 403' : 'Network unavailable'); },
    downloadUrlToProject: async () => assert.fail('uncertain existence must never trigger a download'),
  });
  assert.deepEqual(checked.sort(), ['/denied', '/offline']);
  assert.equal(result.restored, 0);
  assert.equal(result.failures.length, 3);
  assert.deepEqual(materials.map(item => item.path), ['/offline', '/offline', '/denied']);
});

test('重新打开项目时恢复缺失的生成文件并更新素材事实', async () => {
  const project = {
    materials: [{
      id: 'material-1',
      name: '角色总板.png',
      path: '/missing/角色总板.png',
      remoteUrl: 'https://example.test/角色总板.png',
      source: 'generation',
      size: 0,
    }],
  };
  const checked = [];
  const fileApi = {
    async pathExists(path) {
      checked.push(path);
      return path === '/restored/角色总板.png';
    },
    async downloadUrlToProject(url, name) {
      assert.equal(url, project.materials[0].remoteUrl);
      assert.equal(name, '角色总板.png');
      return {
        filePath: '/restored/角色总板.png',
        name,
        size: 1024,
        checksum: 'abc',
        checksumAlgorithm: 'sha256',
      };
    },
  };

  const result = await restoreMissingGeneratedFiles(project, fileApi);

  assert.equal(result.restored, 1);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(checked, ['/missing/角色总板.png', '/restored/角色总板.png']);
  assert.equal(project.materials[0].path, '/restored/角色总板.png');
  assert.equal(project.materials[0].filePath, '/restored/角色总板.png');
  assert.equal(project.materials[0].size, 1024);
  assert.match(project.materials[0].restoredAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('单个生成文件恢复失败不会阻断其他素材', async () => {
  const project = {
    materials: [
      { id: 'bad', name: '失效.png', path: '/missing/bad.png', remoteUrl: 'https://example.test/bad.png', source: 'generation' },
      { id: 'good', name: '有效.png', path: '/missing/good.png', remoteUrl: 'https://example.test/good.png', source: 'generation' },
    ],
  };
  const fileApi = {
    async pathExists(path) {
      return path === '/restored/good.png';
    },
    async downloadUrlToProject(url) {
      if (url.endsWith('/bad.png')) throw new Error('远端文件失效');
      return { filePath: '/restored/good.png', name: '有效.png' };
    },
  };

  const result = await restoreMissingGeneratedFiles(project, fileApi);

  assert.equal(result.restored, 1);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].materialId, 'bad');
  assert.equal(project.materials[1].path, '/restored/good.png');
});
