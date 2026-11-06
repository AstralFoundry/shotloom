/**
 * 工作流界面接线：保存整段快照、导入复制素材、不再有运行/绑定流程。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from './helpers/sourceContract.mjs';

const library = readSource('renderer/src/app/components/WorkflowLibrary.tsx');
const view = readSource('renderer/src/app/views/WorkflowsView.tsx');
const clone = readSource('renderer/src/services/workflowCloneService.ts');
const navigation = readSource('renderer/src/app/constants/navigation.ts');
const appStore = readSource('renderer/src/app/store/appStore.ts');
const projectNavigation = readSource('renderer/src/utils/projectNavigation.ts');
const zh = JSON.parse(readSource('renderer/src/i18n/locales/zh-CN.json'));
const en = JSON.parse(readSource('renderer/src/i18n/locales/en-US.json'));

test('保存走整段快照，不要求运行过，也不再出现槽位绑定/运行实例', () => {
  assert.match(library, /buildWorkflowTemplate\(\{/);
  assert.match(library, /saveWorkflowTemplate\(template\)/);
  assert.match(library, /captureNodePreview\(/);
  assert.doesNotMatch(library, /instantiateWorkflowTemplate|runWorkflowInstance|bindings|missingBindings/);
  assert.doesNotMatch(library, /workflowInstanceProgress/);
});

test('导入 = 复制节点与素材，不触发运行', () => {
  assert.match(library, /cloneWorkflowTemplate\(template\)/);
  assert.match(view, /cloneWorkflowTemplate\(template\)/);
  assert.match(clone, /copyFileIntoProjectAssets\(/);
  assert.match(clone, /registerImportedMaterial\(/);
  assert.doesNotMatch(clone, /runNode|cancelNode/);
});

test('管理页保留流程条与目录操作，并校验已打开项目', () => {
  assert.match(view, /workflowDisplayOrder\(template\.nodes\)/);
  assert.match(view, /preview\?\.dataUrl/);
  assert.match(view, /hasOpenProject\(\)/);
  assert.match(view, /templateShareableCopy\(template\)/);
  assert.match(view, /modal\.confirm\(\{/);
});

test('工作流仍是应用级路由，侧栏入口可见', () => {
  assert.match(appStore, /PROJECT_FREE_ROUTES[\s\S]*?"workflows"/);
  assert.match(projectNavigation, /APPLICATION_ROUTES[\s\S]*?'workflows'/);
  assert.match(navigation, /id: "workflows"/);
});

test('工作流文案中英文齐全且参数一致', () => {
  const keys = Object.keys(zh).filter((key) => key.startsWith('workflow.') || key.startsWith('workflows.') || key.startsWith('navigation.workflows'));
  assert.ok(keys.length >= 30, `工作流文案过少：${keys.length}`);
  for (const key of keys) {
    assert.ok(key in en, `英文缺少 ${key}`);
    const zhParams = [...zh[key].matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]).sort();
    const enParams = [...en[key].matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]).sort();
    assert.deepEqual(enParams, zhParams, `${key} 参数不一致`);
  }
});
