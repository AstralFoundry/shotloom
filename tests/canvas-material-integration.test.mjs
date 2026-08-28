import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const navigation = readFileSync(new URL('../renderer/src/app/constants/navigation.ts', import.meta.url), 'utf8');
const sidebar = readFileSync(new URL('../renderer/src/app/layout/SideBar.tsx', import.meta.url), 'utf8');
const bottomBar = readFileSync(new URL('../renderer/src/app/canvas/BottomModeBar.tsx', import.meta.url), 'utf8');
const creation = readFileSync(new URL('../renderer/src/app/views/CreationView.tsx', import.meta.url), 'utf8');
const workbench = readFileSync(new URL('../renderer/src/app/ReactWorkbench.tsx', import.meta.url), 'utf8');
const libraryAdapter = readFileSync(new URL('../renderer/src/app/adapters/resourceLibraryAdapter.ts', import.meta.url), 'utf8');
const materialGrid = readFileSync(new URL('../renderer/src/app/components/MaterialGrid.tsx', import.meta.url), 'utf8');
const styles = ['project-materials.css', 'creation-view.css']
  .map((name) => readFileSync(new URL(`../renderer/styles/${name}`, import.meta.url), 'utf8'))
  .join('\n');

test('素材入口从左侧导航收敛到画布底部', () => {
  assert.doesNotMatch(navigation, /label: "素材库"/);
  assert.doesNotMatch(navigation, /label: "素材文件"/);
  assert.doesNotMatch(sidebar, /route === "assets"/);
  assert.match(bottomBar, /bottom-material-trigger[\s\S]*?aria-label="打开资产中心"[\s\S]*?<IconSymbol name="folder" \/>/);
  assert.doesNotMatch(bottomBar, /<span>资产<\/span>|<IconSymbol name="image" \/>/);
});

test('画布素材入口统一项目、全局和文件并支持搜索与导入', () => {
  assert.match(creation, /当前项目[\s\S]*?全局资产[\s\S]*?项目文件/);
  assert.match(creation, /canvas-asset-heading[\s\S]*?<IconSymbol name="folder" \/>[\s\S]*?<strong>资产<\/strong>/);
  assert.doesNotMatch(creation, /canvas-asset-heading[\s\S]*?<IconSymbol name="box" \/>/);
  assert.match(creation, /materialKeyword[\s\S]*?搜索名称、类型或标签/);
  assert.match(creation, /图片资产[\s\S]*?视频资产[\s\S]*?音频资产[\s\S]*?文本资产/);
  assert.match(creation, /assetCategories\.map[\s\S]*?category\.label/);
  assert.match(creation, /最新优先[\s\S]*?最早优先[\s\S]*?按名称/);
  assert.match(creation, /Date\.parse[\s\S]*?assetSort === "oldest"/);
  assert.match(creation, /assetFiltersActive[\s\S]*?清除筛选/);
  assert.match(creation, /canvas-material-empty-icon[\s\S]*?这里还没有资产/);
  assert.match(creation, /canvas-asset-popover-layer[\s\S]*?right: copilotVisible \? copilotWidth : 0/);
  assert.match(creation, /if \(picker\)[\s\S]*?setPicker\(false\)/);
  assert.doesNotMatch(creation, /<h3>资产中心<\/h3>/);
  assert.doesNotMatch(creation, /<span>类型<\/span>|<span>分类<\/span>|<span>排序<\/span>/);
  assert.match(creation, /assetView === "list"[\s\S]*?列表视图[\s\S]*?assetView === "grid"[\s\S]*?网格视图/);
  assert.match(creation, /asset-view-\$\{assetView\}/);
  assert.match(creation, /controller\.importMaterials\(\)[\s\S]*?refreshMaterials\("files"\)/);
  assert.match(workbench, /importMaterials: materialsController\.importFiles/);
  assert.match(libraryAdapter, /const visibleAssets = \(store\.project\.assets \|\| \[\]\)/);
  assert.match(creation, /showDeleteAction[\s\S]*?controller\.deleteMaterial\(item, scope\)/);
  assert.match(workbench, /deleteMaterial\(item, scope\)[\s\S]*?deleteProjectAsset[\s\S]*?deleteLocalAsset[\s\S]*?materialsController\.delete/);
});

test('资产浏览器从画布底部展开并支持拖动调整高度', () => {
  assert.match(styles, /\.canvas-material-picker\s*\{[\s\S]*?inset: auto 0 0;[\s\S]*?width: 100%;[\s\S]*?border-top:/);
  assert.doesNotMatch(styles, /\.canvas-material-picker\s*\{[\s\S]*?left: 50%;[\s\S]*?transform: translateX\(-50%\)/);
  assert.match(creation, /assetDrawerHeight[\s\S]*?canvas-asset-drawer-resizer[\s\S]*?startAssetDrawerResize/);
  assert.match(creation, /const minimum = Math\.round\(availableHeight \* 0\.7\)/);
  assert.match(creation, /aria-orientation="horizontal"[\s\S]*?resizeAssetDrawerWithKeyboard/);
  assert.match(styles, /\.canvas-asset-drawer-resizer\s*\{[\s\S]*?cursor: ns-resize/);
  assert.match(styles, /\.canvas-material-picker\s*\{[\s\S]*?min-height: 70%/);
  assert.match(styles, /\.canvas-material-picker-body \.material-node-grid\s*\{[\s\S]*?repeat\(auto-fill, minmax\(184px, 1fr\)\)/);
  assert.match(styles, /asset-view-grid \.material-node-preview\.layout-portrait[\s\S]*?aspect-ratio: 1/);
  assert.match(styles, /asset-view-grid \.material-node-kicker\s*\{\s*display: none/);
  assert.match(styles, /asset-view-list \.material-node\s*\{[\s\S]*?grid-template-columns: 22px minmax\(0, 1fr\)/);
  assert.match(styles, /asset-view-list \.material-node-kicker em[\s\S]*?display: none/);
});

test('点击资产浏览器外部自动收起且网格卡片通过文件夹按钮定位原文件', () => {
  assert.match(creation, /document\.addEventListener\("pointerdown", closeOnOutsidePointer, true\)/);
  assert.match(creation, /assetPickerRef\.current\?\.contains\(target\)/);
  assert.match(creation, /showFileAction[\s\S]*?controller\.showMaterialInFolder\(item\)/);
  assert.match(materialGrid, /title="在文件夹中显示"[\s\S]*?event\.stopPropagation\(\)[\s\S]*?action\("show-file"\)/);
  assert.match(workbench, /showMaterialInFolder: assetsController\.showFile/);
});

test('资产浏览器与展开侧栏并排且跟随侧栏宽度变化', () => {
  assert.match(styles, /sidebar-overlay-shell:is\(\.sidebar-is-pinned, \.sidebar-preview-open\)[\s\S]*?\.canvas-asset-popover-layer/);
  assert.match(styles, /left: calc\([\s\S]*?var\(--workspace-sidebar-width\) - var\(--workspace-sidebar-rail-width\)[\s\S]*?\)/);
  assert.match(styles, /\.canvas-asset-popover-layer\s*\{[\s\S]*?transition: left 220ms/);
  assert.match(styles, /\.canvas-material-picker\s*\{[\s\S]*?border-radius: var\(--workbench-radius\) var\(--workbench-radius\) 0 0/);
});
