import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env;

before(async () => {
  env = await createRendererEnv({ storage: new Map(), withWindow: true });
});
after(async () => { await env?.dispose(); });

// 界面真正挂载的根模块：从这里开始才按产品顺序走完 store、app/store、agent 与 services 的整张模块图。
// 领域测试各自只加载一两个模块，看不见求值期的全局依赖（例如 `window.localStorage`）
// 和一个模块初始化失败留下的半成品状态。
// 循环引用的绑定读取顺序不由这里保证（SSR 与浏览器顺序不同），由 `check:layers` 静态拦。
test('从界面根模块求值整个模块图，入口依赖都要能初始化', async () => {
  const workbench = await env.load('app/ReactWorkbench.tsx');
  assert.equal(typeof workbench.ReactWorkbench, 'function');

  const { store } = await env.load('store/projectStore');
  const { selectedNode } = await env.load('store/nodeStore');
  assert.ok(Array.isArray(store.project.nodes), '项目状态在求值后可读');
  // 派生值必须在调用时才去读 projectStore，求值期就取值的写法在这里就会暴露成初始化顺序问题。
  assert.equal(selectedNode.value, null);
});
