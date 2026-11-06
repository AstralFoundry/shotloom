/**
 * 提示词优化器：指令构造与结构化解析；纯文本退化成"未结构化"而不是静默误判。
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env;
let optimizer;
let service;
let settingsStore;

before(async () => {
  env = await createRendererEnv({ storage: new Map(), withWindow: true });
  optimizer = await env.load('domain/prompt/optimizer');
  service = await env.load('services/promptOptimizerService');
  ({ settingsStore } = await env.load('store/settingsStore'));
});

after(async () => {
  await env?.dispose();
});

test('指令包含优化方式、目标模型与参考素材，参考最多 8 条', () => {
  const references = Array.from({ length: 12 }, (_, index) => ({ kind: 'image', name: `图${index + 1}` }));
  const { system, user } = optimizer.buildOptimizerInstruction({
    mode: 'style',
    prompt: '雨夜街道',
    references,
    targetModel: 'gpt-image-2.6',
    generationType: 'image',
  });

  assert.match(system, /JSON/);
  assert.match(user, /强化色彩/);
  assert.match(user, /目标生成模型：gpt-image-2\.6/);
  assert.match(user, /雨夜街道/);
  assert.equal((user.match(/^- /gm) || []).length, 8, '参考素材最多 8 条');
});

test('空提示词也能构造指令，不抛错', () => {
  const { user } = optimizer.buildOptimizerInstruction({ mode: 'expand', prompt: '' });
  assert.match(user, /（空）/);
});

test('解析结构化 JSON：正向、规避、说明、假设、备选', () => {
  const result = optimizer.parseOptimizerResult(JSON.stringify({
    prompt: '雨夜街道，霓虹倒映，35mm 低机位',
    avoid: ['人物正脸', '文字'],
    notes: '补充了镜头与光线',
    assumptions: ['主角为男性'],
    alternatives: ['俯拍版本'],
  }));

  assert.equal(result.structured, true);
  assert.equal(result.prompt, '雨夜街道，霓虹倒映，35mm 低机位');
  assert.deepEqual(result.avoid, ['人物正脸', '文字']);
  assert.deepEqual(result.notes, ['补充了镜头与光线']);
  assert.deepEqual(result.assumptions, ['主角为男性']);
  assert.deepEqual(result.alternatives, ['俯拍版本']);
});

test('兼容围栏 JSON 与字符串数组', () => {
  const text = '```json\n{"prompt":"场景描述","avoid":"负片\\n模糊","notes":"ok"}\n```';
  const result = optimizer.parseOptimizerResult(text);
  assert.equal(result.structured, true);
  assert.equal(result.prompt, '场景描述');
  assert.deepEqual(result.avoid, ['负片', '模糊']);
  assert.deepEqual(result.notes, ['ok']);
});

test('纯文本输出退化为未结构化提示词，交给界面提示', () => {
  const result = optimizer.parseOptimizerResult('把主体放在左下角，逆光。');
  assert.equal(result.structured, false);
  assert.equal(result.prompt, '把主体放在左下角，逆光。');
  assert.deepEqual(result.avoid, []);
});

test('空输出得到空提示词而不是抛错', () => {
  assert.deepEqual(optimizer.parseOptimizerResult('   '), {
    prompt: '', avoid: [], notes: [], assumptions: [], alternatives: [], structured: false,
  });
});

test('服务在没有可用文本模型时明确失败，不静默返回原文', async () => {
  const saved = settingsStore.agentPreferredTextModel;
  settingsStore.agentPreferredTextModel = '';
  try {
    await assert.rejects(
      () => service.optimizePrompt({ prompt: '雨夜', mode: 'expand', model: '' }),
      (error) => String(error.message).includes('promptOptimizer.noModel'),
    );
  } finally {
    settingsStore.agentPreferredTextModel = saved;
  }
});

test('模型不在目录内时明确失败，而不是发出不完整请求', async () => {
  await assert.rejects(
    () => service.optimizePrompt({ prompt: '雨夜', mode: 'expand', model: 'not-in-catalog' }),
    (error) => String(error.message).includes('promptOptimizer'),
  );
});

test('编辑器入口：优化结果只有「采用」才回填，并记录一步撤销', async () => {
  const { readSource } = await import('./helpers/sourceContract.mjs');
  const composer = readSource('renderer/src/app/canvas/GenerationNodeComposer.tsx');
  const zh = JSON.parse(readSource('renderer/src/i18n/locales/zh-CN.json'));
  const en = JSON.parse(readSource('renderer/src/i18n/locales/en-US.json'));

  assert.match(composer, /optimizePrompt\(\{/);
  assert.match(composer, /recordCanvasHistory\(t\("canvas\.optimizer\.title"\)\)/);
  assert.match(composer, /actions\.update\(node\.id, \{ prompt: optimizer\.draft \}\)/);
  assert.match(composer, /optimizerAbort\.current\?\.abort\(\)/);
  assert.match(composer, /disabled=\{optimizer\.busy \|\| !optimizer\.draft\.trim\(\)\}/);

  const keys = Object.keys(zh).filter((key) => key.startsWith('canvas.optimizer.'));
  assert.ok(keys.length >= 12, `优化器文案过少：${keys.length}`);
  for (const key of keys) assert.ok(key in en, `英文缺少 ${key}`);
});

test('打开或切换方式都不发请求，必须点「开始优化」才发送', async () => {
  const { readSource } = await import('./helpers/sourceContract.mjs');
  const composer = readSource('renderer/src/app/canvas/GenerationNodeComposer.tsx');

  // 打开弹窗只准备草稿，不触发请求。
  const openBody = composer.match(/function openOptimizer\(\)[\s\S]*?\n  \}/)?.[0] || '';
  assert.ok(openBody, '找不到 openOptimizer');
  assert.doesNotMatch(openBody, /runOptimizer\(/);

  // 切换优化方式只改状态。
  assert.match(composer, /onChange=\{\(value\) => setOptimizer\(\(current\) => \(\{ \.\.\.current, mode: value as OptimizerMode \}\)\)\}/);
  assert.doesNotMatch(composer, /onChange=\{\(value\) => void runOptimizer/);

  // 显式的开始按钮才发送请求。
  assert.match(composer, /canvas\.optimizer\.start/);
  assert.match(composer, /onClick=\{\(\) => void runOptimizer\(optimizer\.mode\)\}/);
});
