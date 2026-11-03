import assert from 'node:assert/strict';

import test from 'node:test';
import { readGenerationNodeSource } from './helpers/generationNodeSource.mjs';
import { readSource } from './helpers/sourceContract.mjs';

const read = (path) => readSource(path);

const generationNode = readGenerationNodeSource();
const ime = read('renderer/src/app/canvas/imeComposition.ts');

test('中文输入法确认候选词时不会提交助手输入或生成节点', () => {
  assert.match(ime, /event\.isComposing === true \|\| event\.keyCode === 229/);
  // 输入法守卫必须是 keydown 的第一件事，否则 compositionend 前的 Enter 已经发出去了。
  assert.match(generationNode, /!isImeKeyEvent\(e\.nativeEvent\)[\s\S]*?actions\.run\(node\.id\)/);
});


