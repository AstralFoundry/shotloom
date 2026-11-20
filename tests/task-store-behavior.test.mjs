/**
 * 行为测试：直接加载真实的 taskStore / projectStore 并在其上调用公开 API，
 * 断言真实状态迁移。与仓库里大量「读源码文本 + 正则」的测试相对，
 * 这里验证的是行为本身——重构源码不应让这些断言失败，但改坏逻辑必须。
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env;
let taskStore;
let store;

const storage = new Map();

before(async () => {
  env = await createRendererEnv({ storage, withWindow: true });
  taskStore = await env.load('store/taskStore');
  ({ store } = await env.load('store/projectStore'));
});

after(async () => {
  await env?.dispose();
});

function seedProject({ nodeStatus = 'running', taskStatus = 'running', runner = 'remote', remoteTaskId = '' } = {}) {
  store.project = {
    ...store.project,
    id: 'project-under-test',
    nodes: [{ id: 'node-1', type: 'videoGeneration', title: '镜头', status: nodeStatus, progress: 30 }],
    tasks: [{
      id: 'task-1',
      nodeId: 'node-1',
      status: taskStatus,
      runner,
      remoteTaskId,
      progress: 30,
      requestPayload: {},
    }],
  };
}

test('hasActiveGenerationTasks 依据真实的任务状态返回，而不是恒定值', () => {
  seedProject({ taskStatus: 'running' });
  assert.equal(taskStore.hasActiveGenerationTasks(), true);

  seedProject({ taskStatus: 'queued' });
  assert.equal(taskStore.hasActiveGenerationTasks(), true);

  seedProject({ taskStatus: 'completed' });
  assert.equal(taskStore.hasActiveGenerationTasks(), false);

  seedProject({ taskStatus: 'failed' });
  assert.equal(taskStore.hasActiveGenerationTasks(), false);
});

test('cancelTask 把进行中的任务与节点同时置为 cancelled 并清空活动状态', () => {
  seedProject({ taskStatus: 'running', nodeStatus: 'running' });
  assert.equal(taskStore.cancelTask('task-1'), true);
  assert.equal(store.project.tasks[0].status, 'cancelled');
  assert.equal(store.project.nodes[0].status, 'cancelled');
  assert.equal(taskStore.hasActiveGenerationTasks(), false);
});

test('cancelTask 对不存在或已终结的任务返回 false 且不修改状态', () => {
  seedProject({ taskStatus: 'completed', nodeStatus: 'completed' });
  assert.equal(taskStore.cancelTask('task-1'), false);
  assert.equal(taskStore.cancelTask('missing-task'), false);
  assert.equal(store.project.tasks[0].status, 'completed');
});

test('cancelNode 取消该节点上唯一进行中的任务', () => {
  seedProject({ taskStatus: 'running', nodeStatus: 'running' });
  assert.equal(taskStore.cancelNode('node-1'), true);
  assert.equal(store.project.tasks[0].status, 'cancelled');
  assert.equal(taskStore.cancelNode('node-1'), false, '已取消的节点没有可取消任务');
});

test('runNode 对缺失节点返回 null（不抛异常）', () => {
  assert.equal(taskStore.runNode(null), null);
});

test('stopActiveTaskPolling 清理进行中任务的本地定时器（切换项目前调用）', () => {
  seedProject({ taskStatus: 'running', nodeStatus: 'running' });
  // 不应抛异常，且不改变任务/节点状态（远端任务由远端轮询续跑决定）。
  assert.doesNotThrow(() => taskStore.stopActiveTaskPolling());
});

test('background polling backs off, foreground resumes immediately and cancellation removes listeners', async () => {
  const {getProviderAdapter} = await env.load('domain/provider/adapters/index');
  const adapter=getProviderAdapter('openai'), poll=adapter.poll, interval=window.setInterval, documentBefore=globalThis.document, clock=Date.now;
  let now=clock(), tick, reads=0;
  const listeners=new Set();
  globalThis.document={hidden:false,addEventListener(_name,fn){listeners.add(fn);},removeEventListener(_name,fn){listeners.delete(fn);}};
  Date.now=()=>now;
  window.setInterval=fn=>{tick=fn;return 1;};
  adapter.poll=async()=>{reads++;return {status:'running',progress:40};};
  try {
    seedProject({remoteTaskId:'existing-task'});
    Object.assign(store.project.tasks[0],{createdAt:new Date(now).toISOString(),timeoutMs:120000,requestPayload:{modelContract:{isAsync:true,provider:'openai',taskEndpoint:{path:'/tasks/{id}'}}}});
    assert.equal(taskStore.resumeRemoteTasks(),1);
    await new Promise(resolve=>setImmediate(resolve)); assert.equal(reads,1);
    document.hidden=true;now+=1500;await tick();assert.equal(reads,1);
    now+=30000;await tick();assert.equal(reads,2);
    document.hidden=false;for(const fn of listeners)fn();await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,3);
    taskStore.cancelTask('task-1');assert.equal(listeners.size,0);
  } finally {taskStore.stopActiveTaskPolling();adapter.poll=poll;window.setInterval=interval;Date.now=clock;if(documentBefore===undefined)delete globalThis.document;else globalThis.document=documentBefore;}
});
