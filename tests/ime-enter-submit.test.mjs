import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const composer = read('renderer/src/app/agent-chat/Composer.tsx');
const generationNode = read('renderer/src/app/canvas/GenerationNode.tsx');
const ime = read('renderer/src/app/canvas/imeComposition.ts');

const keydown = composer.slice(
  composer.indexOf('function onKeyDown'),
  composer.indexOf('const disabled ='),
);

test('中文输入法确认候选词时不会提交助手输入或生成节点', () => {
  assert.match(ime, /event\.isComposing === true \|\| event\.keyCode === 229/);
  // 输入法守卫必须是 keydown 的第一件事，否则 compositionend 前的 Enter 已经发出去了。
  assert.match(keydown, /isImeKeyEvent\(event\.nativeEvent\)[\s\S]*?ArrowDown/);
  assert.match(generationNode, /!isImeKeyEvent\(e\.nativeEvent\)[\s\S]*?actions\.run\(node\.id\)/);
});

test('Enter 先交给 @ 菜单，其次才提交；只有一条提交路径', () => {
  assert.match(keydown, /mentionOptions\[mention\.index\][\s\S]*?insertMention\(mentionOptions\[mention\.index\]\)/);
  assert.match(keydown, /event\.key === "Enter" && !event\.shiftKey[\s\S]*?submit\(\)/);
  assert.doesNotMatch(keydown, /controller\.send\(/);
  assert.match(composer, /function submit\(\)[\s\S]*?controller\.send\(\{/);
});
