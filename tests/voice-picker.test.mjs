import assert from 'node:assert/strict';
import test from 'node:test';
import {
  systemVoiceLabel,
  systemVoiceLanguages,
  systemVoiceOptionLabels,
  systemVoices,
} from '../renderer/src/config/systemVoices.ts';
import { optionLabel } from '../renderer/src/utils/modelPresentation.ts';
import { createRendererEnv } from './helpers/rendererSsr.mjs';
import { loadModelCatalog } from './helpers/modelCatalog.mjs';
import { readGenerationNodeSource } from './helpers/generationNodeSource.mjs';
import { readLocalizedSource as readSource } from './helpers/sourceContract.mjs';

const panelSource = readGenerationNodeSource();
const dialogSource = readSource('renderer/src/app/components/VoicePickerDialog.tsx');
const dialogStyles = readSource('renderer/src/app/components/VoicePickerDialog.css');

const audioModes = loadModelCatalog().models
  .filter((model) => model.type === 'audioGeneration')
  .flatMap((model) => model.modes || []);
const voiceParams = audioModes
  .flatMap((mode) => (mode.params || []).filter((param) => param.key === 'voice'));

test('音频目录把音色声明为选择器参数而不是自由文本框', () => {
  // 每个文字转语音模式都要挂同一个音色控件；音乐模式没有音色概念。
  assert.equal(
    voiceParams.length,
    audioModes.filter((mode) => mode.id === 'text-to-speech').length,
    '语音模式与音色参数必须一一对应',
  );
  for (const param of voiceParams) {
    assert.equal(param.presentation.control, 'voice');
    assert.equal(param.label, '音色');
    assert.equal(param.default, 'female-shaonv');
    // 清单是可选提示，不是白名单：复刻音色必须仍然能填。
    assert.equal(param.type, 'text');
    assert.equal(param.options, undefined);
  }
});

test('系统音色库保持 MiniMax 公开清单的完整性', () => {
  assert.equal(systemVoices.length, 327);
  assert.equal(new Set(systemVoices.map((voice) => voice.value)).size, systemVoices.length);
  for (const voice of systemVoices) {
    assert.ok(voice.value && voice.label, `音色条目缺少 ID 或名称：${JSON.stringify(voice)}`);
  }
  const declared = new Set(systemVoiceLanguages.map((item) => item.name));
  for (const voice of systemVoices) assert.ok(declared.has(voice.language), `未声明的语言：${voice.language}`);
  assert.equal(systemVoiceLabel('female-shaonv'), '少女音色');
  assert.equal(systemVoiceLabel('my-cloned-voice'), 'my-cloned-voice', '未收录 ID 必须原样返回');
});

test('音色摘要与选择器解析出同一个中文名', () => {
  const param = { key: 'voice', label: '音色', options: [], optionLabels: systemVoiceOptionLabels };
  assert.equal(optionLabel(param, 'female-yujie'), '御姐音色');
  assert.equal(optionLabel({ ...param, optionLabels: undefined }, 'my-cloned-voice'), 'my-cloned-voice');
});

test('音色清单由目录层注入参数，厂商模式不各自复制一份', async () => {
  const env = await createRendererEnv();
  try {
    const { getModelSchema } = await env.load('domain/catalog/ModelCatalog');
    const param = getModelSchema('audioGeneration', 'starrouter-speech-2.8-hd', 'text-to-speech')
      .params.find((item) => item.key === 'voice');
    assert.equal(param.presentation.control, 'voice');
    assert.deepEqual(param.options, [], '音色清单不是白名单，目录参数不携带 options');
    assert.equal(param.optionLabels['female-shaonv'], '少女音色');
    assert.equal(optionLabel(param, 'female-shaonv'), '少女音色');
    assert.equal(optionLabel(param, 'my-cloned-voice'), 'my-cloned-voice');
  } finally {
    await env.dispose();
  }
});

test('音色选择器挂在应用级浮层根节点且不逃逸层级', () => {
  assert.match(dialogSource, /useWorkbenchSurfaceRoot\(\)/);
  assert.match(dialogSource, /return createPortal\(/);
  assert.doesNotMatch(dialogSource, /document\.body/);
  assert.doesNotMatch(dialogStyles, /z-index:/);
});

test('选择器按名称与 ID 搜索，语言筛选项来自音色库', () => {
  assert.match(dialogSource, /voice\.label\.toLowerCase\(\)\.includes\(needle\)/);
  assert.match(dialogSource, /voice\.value\.toLowerCase\(\)\.includes\(needle\)/);
  assert.match(dialogSource, /systemVoiceLanguages\.map/);
  assert.match(dialogSource, /voice\.language === language/);
  assert.match(dialogSource, /未找到匹配音色/);
});

test('未收录的音色 ID 仍可在选择器里直接确认', () => {
  assert.match(dialogSource, /const showCustomId = Boolean\(customId\)/);
  assert.match(dialogSource, /使用音色 ID/);
  assert.match(dialogSource, /onSelect\(customId\)/);
});

test('参数面板只挂一个音色选择器实例', () => {
  assert.match(panelSource, /paramPresentation\(param\)\.control === "voice"/);
  assert.equal((panelSource.match(/<VoicePickerDialog/g) || []).length, 1);
  assert.match(panelSource, /onConfigChange\(voiceParam\.key, voiceId\)/);
});

test('英文音色显示与参数摘要一致且不改变真实音色 ID', async () => {
  const env = await createRendererEnv({ storage: new Map([['shotloom:locale', 'en-US']]) });
  try {
    const voices = await env.load('config/systemVoices');
    assert.deepEqual(voices.systemVoices.map(item => item.value), systemVoices.map(item => item.value));
    assert.deepEqual(voices.systemVoices.map(item => item.language), systemVoices.map(item => item.language));
    assert.equal(voices.systemVoiceLabel('female-shaonv'), 'Young girl');
    assert.equal(voices.systemVoiceLanguageLabel('female-shaonv'), 'Chinese · Mandarin');
    assert.equal(voices.systemVoiceLabel('my-cloned-voice'), 'my-cloned-voice');
    const { getModelSchema } = await env.load('domain/catalog/ModelCatalog');
    const param = getModelSchema('audioGeneration', 'starrouter-speech-2.8-hd', 'text-to-speech')
      .params.find(item => item.key === 'voice');
    assert.equal(param.optionLabels['female-shaonv'], voices.systemVoiceLabel('female-shaonv'));
    assert.equal(param.default, 'female-shaonv');
  } finally { await env.dispose(); }
});
