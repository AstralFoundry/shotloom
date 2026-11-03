import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

// Test real catalog assembly with fixture assets; import.meta.glob normally reads bundled files.
// Asset filenames intentionally remain Chinese when the displayed names become English.
test('三维模型库切换语言保留资源 ID、目录和中文缩略图关联', async () => {
  const previousStorage = globalThis.localStorage;
  try {
    for (const [locale, categoryLabel, modelName] of [
      ['zh-CN', '便利生活', '猫'], ['en-US', 'Everyday essentials', 'Cat'],
    ]) {
      const env = await createRendererEnv({
        storage: new Map([['shotloom:locale', locale]]),
        plugins: [{
          name: 'fixture-model-library-assets', enforce: 'pre',
          transform(code, id) {
            if (!id.endsWith('/editor/modelLibrary/modelLibraryCatalog.ts')) return;
            const source = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true);
            const edits = [];
            function visit(node) {
              if (ts.isCallExpression(node) && node.expression.getText(source) === 'import.meta.glob') {
                const pattern = node.arguments[0].getText(source);
                const entries = pattern.includes('**/*.fbx')
                  ? { '../../../../模型库/便利生活/cat_low.fbx': '/fixture/cat.fbx' }
                  : pattern.includes('便利生活')
                    ? { '../../../../模型库/便利生活/缩略图/猫.png': '/fixture/cat.png' } : {};
                edits.push({ start: node.getStart(source), end: node.end, replacement: JSON.stringify(entries) });
              }
              ts.forEachChild(node, visit);
            }
            visit(source);
            for (const edit of edits.sort((a, b) => b.start - a.start)) {
              code = code.slice(0, edit.start) + edit.replacement + code.slice(edit.end);
            }
            return code;
          },
        }],
      });
      try {
        const catalog = await env.loadVendor('storyai-3d-director-desk/src/editor/modelLibrary/modelLibraryCatalog.ts');
        assert.equal(catalog.MODEL_LIBRARY_CATEGORIES[0].label, categoryLabel);
        assert.equal(catalog.MODEL_LIBRARY_CATEGORIES[0].directoryName, '便利生活');
        assert.deepEqual(catalog.getModelLibraryItems(), [{
          categoryId: 'convenience', fileName: 'cat_low.fbx', id: 'convenience:cat_low.fbx',
          name: modelName, url: '/fixture/cat.fbx', thumbUrl: '/fixture/cat.png',
        }]);
      } finally { await env.dispose(); }
    }
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
});
