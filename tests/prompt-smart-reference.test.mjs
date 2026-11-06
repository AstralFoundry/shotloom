/**
 * 自然指代转换：只转已连接、序号唯一、未引用过的素材；数字与歧义保持原样。
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env;
let smart;

before(async () => {
  env = await createRendererEnv({ storage: new Map(), withWindow: true });
  smart = await env.load('utils/smartPromptReference');
});

after(async () => {
  await env?.dispose();
});

function targets() {
  return [
    { nodeId: 'a', kind: 'image', number: 1, alias: '图1' },
    { nodeId: 'b', kind: 'image', number: 2, alias: '参考素材' },
    { nodeId: 'c', kind: 'video', number: 1, alias: '动作视频' },
    { nodeId: 'd', kind: 'audio', number: 1, alias: '旁白' },
  ];
}

test('中文序号与「图片/image」写法都能识别', () => {
  const matches = smart.findSmartReferences('图1 的动作接到图2，图片 2 换掉', targets());
  assert.deepEqual(matches.map((match) => [match.text, match.nodeId]), [
    ['图1', 'a'],
    ['图2', 'b'],
    ['图片 2', 'b'],
  ]);
});

test('英文写法与大小写不敏感', () => {
  const matches = smart.findSmartReferences('use IMAGE 2 with video1 and audio 1', targets());
  assert.deepEqual(matches.map((match) => match.nodeId), ['b', 'c', 'd']);
});

test('普通数字与无种类前缀的写法保持原样', () => {
  assert.deepEqual(smart.findSmartReferences('约2秒后切到第3个镜头，速度 1.5', targets()), []);
});

test('越界序号与重复序号不转换', () => {
  assert.deepEqual(smart.findSmartReferences('图9 不存在', targets()), []);
  const duplicated = [...targets(), { nodeId: 'e', kind: 'image', number: 1, alias: '另一张图' }];
  assert.deepEqual(smart.findSmartReferences('图1 指向不明', duplicated), []);
});

test('已引用过的素材不重复转换', () => {
  assert.deepEqual(smart.findSmartReferences('把 @图1 的动作再演一遍', targets()), []);
});

test('重叠命中只保留最长匹配', () => {
  const matches = smart.findSmartReferences('参考图1 是主画面', targets());
  assert.equal(matches.length, 1);
  assert.equal(matches[0].text, '参考图1');
  assert.equal(matches[0].nodeId, 'a');
});

test('一次性替换从后往前进行，文本不串位', () => {
  const prompt = '把图1的动作给图2，参考视频 1 做动作参考';
  const matches = smart.findSmartReferences(prompt, targets());
  const applied = smart.applySmartReferences(prompt, matches);
  assert.equal(applied, '把@图1 的动作给@参考素材 ，@动作视频 做动作参考');
});

test('编辑器入口：按钮走真实转换并复用已有引用插入逻辑', async () => {
  const { readSource } = await import('./helpers/sourceContract.mjs');
  const composer = readSource('renderer/src/app/canvas/GenerationNodeComposer.tsx');
  const styles = readSource('renderer/styles/canvas.css');

  assert.match(composer, /findSmartReferences\(String\(node\.prompt \|\| ""\), smartTargets\)/);
  assert.match(composer, /actions\.insertReferenceMention\(node\.id, match\.nodeId/);
  assert.match(composer, /disabled=\{!smartMatches\.length\}/);
  assert.match(composer, /recordCanvasHistory\(t\("canvas\.composer\.smartReference"\)\)/);
  // 从后往前替换，避免下标漂移。
  assert.match(composer, /sort\(\(left, right\) => right\.start - left\.start\)/);
  assert.match(styles, /\.work-smart-reference \{/);
});
