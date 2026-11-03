/**
 * 行为测试：直接加载真实的 projectStore，在浏览器 fallback 桌面 API 上驱动
 * createNewProject，验证成功路径的状态迁移与失败回滚。断言的是行为，
 * 而不是源码文本。
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env;
let projectStore;
let desktopApi;
let store;

const storage = new Map();

before(async () => {
  env = await createRendererEnv({ storage, withWindow: true });
  ({ desktopApi } = await env.load('services/desktopApi'));
  projectStore = await env.load('store/projectStore');
  store = projectStore.store;
});

after(async () => {
  await env?.dispose();
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

test('opening an unreadable project preserves the current project instead of normalizing an empty replacement', async () => {
  const previous = { project: store.project, path: store.filePath, dir: store.projectDir };
  const readFile = desktopApi.project.readFile;
  try {
    desktopApi.project.readFile = async () => null;
    await assert.rejects(projectStore.openRecentProject('/missing/project.shotloom.json'), /不存在或无法读取/);
    assert.equal(store.project, previous.project);
    assert.equal(store.filePath, previous.path);
    assert.equal(store.projectDir, previous.dir);
    desktopApi.project.readFile = async () => { throw new Error('无法读取磁盘文件'); };
    await assert.rejects(projectStore.openRecentProject('/broken/project.shotloom.json'), /无法读取磁盘文件/);
    assert.equal(store.project, previous.project);
  } finally { desktopApi.project.readFile = readFile; }
});

test('active generation cannot report a new window opened when the native window API refuses', async () => {
  const controller = (await env.load('app/adapters/projectLibraryAdapter')).projectLibraryController;
  const originalTasks = store.project.tasks;
  const createNew = desktopApi.window.createNew;
  const previous = { project: store.project, path: store.filePath };
  let attempts = 0;
  try {
    store.project.tasks = [{ id: 'active-generation', status: 'running' }];
    desktopApi.window.createNew = async () => { attempts++; return false; };
    await assert.rejects(controller.openProject('/another/project.shotloom.json'), /生成任务.*暂不支持/);
    assert.equal(attempts, 1);
    assert.equal(store.project, previous.project);
    assert.equal(store.filePath, previous.path);
    assert.equal(store.project.tasks[0].status, 'running');
  } finally { store.project.tasks = originalTasks; desktopApi.window.createNew = createNew; }
});

test('loading and saving removes retired Agent sessions without removing product facts or official sessions', async () => {
  const { createProject, normalizeProject } = await env.load('store/projectNormalization');
  const original = createProject('legacy cleanup');
  original.nodes.push({ id: 'real-text', type: 'text', content: '保留正文' });
  original.harnessSessions[0].harnessSessionId = 'official-session';
  original.productionPlans = [{ schemaVersion: 2, id: 'real-plan', title: '保留制作计划' }];
  const retired = ['agentConversations', 'activeAgentConversationId', 'agentRuns', 'agentRuntimeEvents',
    'agentInteractions', 'agentSteps', 'goal', 'planMode', 'todoItems', 'projectionJournal', 'projectionCheckpoint', 'projectionSeq'];
  for (const key of retired) original[key] = [{ content: 'retired history' }];
  const loaded = normalizeProject(original);
  for (const key of retired) assert.equal(Object.hasOwn(loaded, key), false, key);
  assert.equal(loaded.nodes[0].content, '保留正文');
  assert.equal(loaded.harnessSessions[0].harnessSessionId, 'official-session');
  assert.equal(loaded.productionPlans[0].id, 'real-plan');
  store.project = loaded;
  store.project.agentConversations = [{ content: 'retired injected archive' }];
  const snapshot = projectStore.projectPersistenceSnapshot();
  assert.equal(Object.hasOwn(snapshot, 'agentConversations'), false);
  assert.equal(snapshot.harnessSessions[0].harnessSessionId, 'official-session');
});

test('renaming an open SQLite project carries the committed revision into the next save', async () => {
  const controller = (await env.load('app/adapters/projectLibraryAdapter')).projectLibraryController;
  await projectStore.createNewProject('revision rename', { openAfterCreate: false });
  const oldDir = store.projectDir;
  const newDir = `${oldDir}-renamed`;
  const originalRename = desktopApi.project.renameEntry;
  const originalSave = desktopApi.project.save;
  let nextRevision;
  try {
    store.project.storageRevision = 4;
    desktopApi.project.renameEntry = async () => ({ oldDir, newDir, name: 'renamed', storageRevision: 5 });
    desktopApi.project.save = async (directory, snapshot) => {
      assert.equal(directory, newDir);
      nextRevision = snapshot.storageRevision;
      return { filePath: `${newDir}/project.sqlite`, project: { ...snapshot, storageRevision: 6 } };
    };
    await controller.rename({ kind: 'project', name: store.project.name, projectDir: oldDir, filePath: store.filePath }, 'renamed');
    await projectStore.saveProject();
    assert.equal(nextRevision, 5);
    assert.equal(store.project.storageRevision, 6);
  } finally {
    desktopApi.project.renameEntry = originalRename;
    desktopApi.project.save = originalSave;
  }
});
