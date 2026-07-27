import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasPersistedProject,
  resolveProjectRoute,
} from '../renderer/src/utils/projectNavigation.mjs';

const openProject = {
  projectDir: '/projects/demo',
  filePath: '/projects/demo/project.shotloom.json',
  project: { schema: 'shotloom-project' },
};

test('空白内存项目不算已打开项目', () => {
  assert.equal(hasPersistedProject({
    projectDir: null,
    filePath: null,
    project: { schema: 'shotloom-project', name: '未命名项目' },
  }), false);
});

test('项目工作台路由在没有落盘项目时统一回到项目库', () => {
  for (const route of ['creation', 'tasks', 'assets', 'materials']) {
    assert.equal(resolveProjectRoute(route, {}), 'projects');
  }
  assert.equal(resolveProjectRoute('apps', {}), 'projects');
  assert.equal(resolveProjectRoute('unknown', {}), 'projects');
  assert.equal(resolveProjectRoute('projects', {}), 'projects');
});

test('已打开项目可以进入全部项目工作台页面', () => {
  for (const route of ['creation', 'tasks', 'assets', 'materials']) {
    assert.equal(resolveProjectRoute(route, openProject), route);
  }
});
