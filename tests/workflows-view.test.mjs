/**
 * 工作流管理页：全局入口、路由、重命名/复制/导出/删除的接线与文案。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from './helpers/sourceContract.mjs';

const appStore = readSource('renderer/src/app/store/appStore.ts');
const navigation = readSource('renderer/src/app/constants/navigation.ts');
const sideBar = readSource('renderer/src/app/layout/SideBar.tsx');
const workbench = readSource('renderer/src/app/ReactWorkbench.tsx');
const view = readSource('renderer/src/app/views/WorkflowsView.tsx');
const store = readSource('renderer/src/store/workflowTemplateStore.ts');
const zh = JSON.parse(readSource('renderer/src/i18n/locales/zh-CN.json'));
const en = JSON.parse(readSource('renderer/src/i18n/locales/en-US.json'));

test('工作流是应用级路由：不依赖已打开工程，侧栏有入口', () => {
  assert.match(appStore, /\| "workflows"/);
  assert.match(appStore, /PROJECT_FREE_ROUTES[\s\S]*?"workflows"/);
  assert.match(navigation, /id: "workflows"/);
  assert.match(navigation, /t\('navigation\.workflows'\)/);
  assert.match(sideBar, /route === "workflows"/);
  assert.match(workbench, /appRoute === "workflows"[\s\S]*?<WorkflowsView \/>/);
});

test('管理页动作走真实 store 与导出服务', () => {
  assert.match(view, /loadWorkflowTemplates\(\)/);
  assert.match(view, /renameWorkflowTemplate\(renaming\.id/);
  assert.match(view, /duplicateWorkflowTemplate\(template\.id\)/);
  assert.match(view, /deleteWorkflowTemplate\(template\.id\)/);
  assert.match(view, /templateShareableCopy\(template\)/);
  assert.match(view, /modal\.confirm\(\{/);
  // 导出用共享副本，不把私有配方写进文件。
  assert.doesNotMatch(view, /JSON\.stringify\(template\)/);
});

test('store 提供重命名与复制，且复制不复用原 id', () => {
  assert.match(store, /export async function renameWorkflowTemplate/);
  assert.match(store, /export async function duplicateWorkflowTemplate/);
  assert.match(store, /id: `wf-\$\{uid\(\)\}`/);
  assert.match(store, /revision: 1/);
});

test('工作流管理文案中英文齐全且参数一致', () => {
  for (const prefix of ['navigation.workflows', 'workflows.']) {
    const keys = Object.keys(zh).filter((key) => key.startsWith(prefix));
    assert.ok(keys.length >= 2, `${prefix} 文案过少：${keys.length}`);
    for (const key of keys) {
      assert.ok(key in en, `英文缺少 ${key}`);
      const zhParams = [...zh[key].matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]).sort();
      const enParams = [...en[key].matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]).sort();
      assert.deepEqual(enParams, zhParams, `${key} 参数不一致`);
    }
  }
});

test('路由解析：workflows 是应用级路由，不会被回退到项目库', async () => {
  const { APPLICATION_ROUTES, resolveProjectRoute } = await import('../renderer/src/utils/projectNavigation.ts');
  assert.equal(APPLICATION_ROUTES.has('workflows'), true);
  assert.equal(resolveProjectRoute('workflows', {}), 'workflows');
  // 工作区路由仍然要求已打开工程。
  assert.equal(resolveProjectRoute('creation', {}), 'projects');
});
