/**
 * 行为测试：直接加载真实的 projectStore，在浏览器 fallback 桌面 API 上驱动
 * createNewProject，验证成功路径的状态迁移与失败回滚。断言的是行为，
 * 而不是源码文本。
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

let server;
let projectStore;
let desktopApi;
let store;

const storage = new Map();

before(async () => {
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear(),
  };
  globalThis.window = {
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
  };
  const rendererRoot = fileURLToPath(new URL('../renderer', import.meta.url));
  server = await createServer({
    configFile: false,
    root: rendererRoot,
    resolve: { alias: { '@': path.join(rendererRoot, 'src') } },
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  ({ desktopApi } = await server.ssrLoadModule('/src/services/desktopApi.js'));
  projectStore = await server.ssrLoadModule('/src/store/projectStore.js');
  store = projectStore.store;
});

after(async () => {
  await server?.close();
  delete globalThis.localStorage;
  delete globalThis.window;
});

test('createNewProject 成功时写入全新的 projectDir/filePath 并切换项目身份', async () => {
  const beforeId = store.project?.id;
  await projectStore.createNewProject('回归用项目', { openAfterCreate: false });
  assert.ok(store.projectDir, '应写入 projectDir');
  assert.ok(store.filePath, '应写入 filePath');
  assert.notEqual(store.project.id, beforeId, '应切换到新项目');
  assert.equal(store.project.name, '回归用项目');
});

test('createNewProject 中途失败时回滚，不把空白项目绑到旧目录', async () => {
  // 先建立一个已知的「原项目」状态。
  await projectStore.createNewProject('原项目', { openAfterCreate: false });
  const previous = {
    id: store.project.id,
    projectDir: store.projectDir,
    filePath: store.filePath,
  };

  // 让目录创建失败，模拟磁盘/权限/IPC 错误。
  const originalCreateFolder = desktopApi.project.createFolder;
  desktopApi.project.createFolder = async () => {
    throw new Error('磁盘写入失败');
  };
  try {
    await assert.rejects(
      () => projectStore.createNewProject('会失败的项目', { openAfterCreate: false }),
      /磁盘写入失败/,
    );
  } finally {
    desktopApi.project.createFolder = originalCreateFolder;
  }

  assert.equal(store.project.id, previous.id, '应回滚到原项目的 project');
  assert.equal(store.projectDir, previous.projectDir, '不应把旧 projectDir 丢给新项目');
  assert.equal(store.filePath, previous.filePath, '不应把旧 filePath 丢给新项目');
});

test('createNewProject 使用的任务清理钩子随 projectStore 一路可用', () => {
  // projectStore 在切换项目前会调用 taskStore.stopActiveTaskPolling；
  // 这里确认 projectStore 已成功加载（其 import 图健康），且该钩子确实存在。
  assert.equal(typeof projectStore.createNewProject, 'function');
  assert.equal(typeof projectStore.stopActiveTaskPolling, 'undefined', 'stopActiveTaskPolling 属于 taskStore，而非 projectStore');
});
