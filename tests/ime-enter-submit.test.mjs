import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('中文输入法确认候选词时不会触发 Copilot 或生成节点发送', () => {
  const ime = read('renderer/src/app/canvas/imeComposition.ts');
  const copilot = read('renderer/src/app/copilot/CopilotPanel.tsx');
  const generationNode = read('renderer/src/app/canvas/GenerationNode.tsx');
  const keydown = copilot.slice(
    copilot.indexOf('function keydown'),
    copilot.indexOf('function clear'),
  );

  assert.match(ime, /event\.isComposing === true \|\| event\.keyCode === 229/);
  assert.match(keydown, /isImeKeyEvent\(event\.nativeEvent\)/);
  assert.match(generationNode, /!isImeKeyEvent\(e\.nativeEvent\)[\s\S]*?actions\.run\(node\.id\)/);
});

test('Copilot 回车只交给 Sender 提交一次', () => {
  const copilot = read('renderer/src/app/copilot/CopilotPanel.tsx');
  const keydown = copilot.slice(
    copilot.indexOf('function keydown'),
    copilot.indexOf('function clear'),
  );

  assert.match(copilot, /submitType="enter"[\s\S]*?onSubmit=\{send\}/);
  assert.match(keydown, /mentionOpen && event\.key === "Enter"[\s\S]*?insertMention/);
  assert.doesNotMatch(keydown, /\bsend\(\)/);
});
