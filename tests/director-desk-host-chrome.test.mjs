import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource, sourceExists } from './helpers/sourceContract.mjs';

const chrome = readSource('renderer/src/app/adapters/directorDeskHostChrome.ts');
const chromeStyles = readSource('renderer/src/app/adapters/directorDeskHostChrome.css');
const directorNode = readSource('renderer/src/app/canvas/ThreeDDirectorNode.tsx');
const directorWorkspace = readSource('renderer/src/app/views/DirectorWorkspace.tsx');

test('导演台宿主样式在 iframe 加载后注入且不改 vendor 源码', () => {
  assert.match(chrome, /directorDeskHostChrome\.css\?raw/);
  assert.match(chrome, /DIRECTOR_DESK_HOST_CHROME_STYLE_ID = 'shotloom-director-host-chrome'/);
  assert.match(chrome, /frame\?\.contentDocument/);
  assert.match(chrome, /document\?\.head/);
  assert.match(chrome, /getElementById\(DIRECTOR_DESK_HOST_CHROME_STYLE_ID\)/);
  assert.match(chrome, /style\.textContent !== hostChromeCss/);
  assert.match(chrome, /try \{[\s\S]*?\} catch \{[\s\S]*?return false;/);

  assert.match(
    directorNode,
    /onLoad=\{\(\) => \{\s*installDirectorDeskHostChrome\(detailIframeRef\.current\);\s*sendSession\(\);/,
  );
  assert.match(
    directorWorkspace,
    /onLoad=\{\(\) => \{\s*installDirectorDeskHostChrome\(frameRef\.current\);\s*sendSession\(\);/,
  );
  assert.equal(sourceExists('vendor/shotloom-director-desk/src/app/editor/editor-page.css'), true);
});

test('属性面板控件统一到 28px 且保持面板高度基本不变', () => {
  assert.match(chromeStyles, /#director-inspector \.ant-input \{[^}]*height:\s*28px/);
  assert.match(chromeStyles, /#director-inspector \.ant-input-number \{[^}]*height:\s*28px;[^}]*padding-inline:\s*0/);
  assert.match(chromeStyles, /#director-inspector \.ant-input-number \.ant-input-number-input \{[^}]*height:\s*26px;[^}]*line-height:\s*26px/);
  assert.match(chromeStyles, /#director-inspector \.axis-field \.ant-input-number-input \{[^}]*padding-left:\s*18px;[^}]*padding-right:\s*4px/);
  assert.match(chromeStyles, /#director-inspector \.ant-select-single \{[^}]*height:\s*28px/);
  assert.doesNotMatch(
    chromeStyles.replace(/\/\*[\s\S]*?\*\//g, ''),
    /ant-select-selector|ant-select-selection-item/,
  );
  assert.match(chromeStyles, /:has\(\.ant-color-picker-trigger\) \{[^}]*height:\s*28px[^}]*min-height:\s*0/);
  assert.match(chromeStyles, /#director-inspector \.stack \{[^}]*gap:\s*9px/);
  assert.match(chromeStyles, /#director-inspector \.field-row \{[^}]*gap:\s*5px/);
  assert.match(chromeStyles, /#director-inspector \.slider-field__input \{[^}]*width:\s*80px/);
});

test('宿主样式只作用于导演台属性面板且不写颜色字面量', () => {
  const withoutComments = chromeStyles.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [...withoutComments.matchAll(/(^|\})\s*([^{}]+)\{/g)]
    .map((match) => match[2].trim())
    .filter(Boolean);
  assert.ok(selectors.length >= 8);
  for (const selector of selectors) {
    assert.match(selector, /^#director-inspector\b/, `宿主样式不得越出属性面板：${selector}`);
  }
  assert.doesNotMatch(withoutComments, /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
});
