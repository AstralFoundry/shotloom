import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

const env = await createRendererEnv();
after(() => env.dispose());

test('分镜脚本解析接受模型数组、shots 包装与中文业务字段', async () => {
  const { parseStoryboardScriptResult } = await env.load('domain/graph/StoryboardScript');
  const rows = parseStoryboardScriptResult(JSON.stringify({
    shots: [
      { shotNumber: 2, durationSeconds: 6, 画面: '雨夜街头', 景别: '全景', 台词: '别回头', 图片提示词: '雨夜', 视频提示词: '雨落' },
      { shotNumber: 1, durationSeconds: 3, plot: '推门', imagePrompt: '门', videoPrompt: '推门' },
    ],
  }));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.shotNumber), [1, 2]);
  assert.equal(rows[0].plot, '雨夜街头');
  assert.equal(rows[1].plot, '推门');
  assert.equal(rows[0].dialogue, '别回头');
  assert.equal(rows[0].durationSeconds, 6);
});

test('分镜脚本解析容忍代码块与夹杂解释，拒绝无效载荷', async () => {
  const { parseStoryboardScriptResult } = await env.load('domain/graph/StoryboardScript');
  const fenced = '```json\n[{"plot":"A","durationSeconds":4}]\n```';
  assert.equal(parseStoryboardScriptResult(fenced)?.[0]?.plot, 'A');
  assert.equal(parseStoryboardScriptResult('这是分镜：[{"plot":"B"}] 请查收')?.[0]?.plot, 'B');
  assert.equal(parseStoryboardScriptResult('not json'), null);
  assert.equal(parseStoryboardScriptResult('{"shots":[]}'), null);
});

test('编辑镜头只覆盖可编辑字段，保留行 ID、产出节点与状态', async () => {
  const { createStoryboardShot, patchStoryboardShot } = await env.load('domain/graph/StoryboardScript');
  const shot = {
    ...createStoryboardShot(1, { plot: '原画面', durationSeconds: 4 }),
    id: 'shot-a', imageNodeId: 'image-a', videoNodeId: 'video-a', status: 'completed', error: '',
  };
  const patched = patchStoryboardShot(shot, { plot: '  新画面  ', durationSeconds: '5.5', imagePrompt: '图' });
  assert.equal(patched.id, 'shot-a');
  assert.equal(patched.imageNodeId, 'image-a');
  assert.equal(patched.videoNodeId, 'video-a');
  assert.equal(patched.status, 'completed');
  assert.equal(patched.plot, '新画面');
  assert.equal(patched.durationSeconds, 5.5);
  assert.equal(patched.imagePrompt, '图');
});

test('镜头行保留去重后的关联参考图，编辑其它字段不会清空关联', async () => {
  const { normalizeStoryboardShots, patchStoryboardShot } = await env.load('domain/graph/StoryboardScript');
  const rows = normalizeStoryboardShots([{ plot: 'A', referenceNodeIds: ['img-1', 'img-1', 'img-2'] }]);
  assert.deepEqual(rows[0].referenceNodeIds, ['img-1', 'img-2']);
  const patched = patchStoryboardShot(rows[0], { dialogue: '台词' });
  assert.deepEqual(patched.referenceNodeIds, ['img-1', 'img-2']);
});

test('单镜提示词优先专用提示词，缺失时退回画面、景别、台词', async () => {
  const { createStoryboardShot, storyboardShotPrompt } = await env.load('domain/graph/StoryboardScript');
  const shot = createStoryboardShot(1, {
    plot: '人物回头', shotSize: '近景', camera: '手持', dialogue: '走',
    imagePrompt: '', videoPrompt: '',
  });
  assert.match(storyboardShotPrompt(shot, 'image'), /人物回头/);
  assert.match(storyboardShotPrompt(shot, 'image'), /景别：近景/);
  assert.match(storyboardShotPrompt(shot, 'video'), /台词：走/);
  const withPrompt = { ...shot, imagePrompt: '专用图', videoPrompt: '专用视频' };
  assert.equal(storyboardShotPrompt(withPrompt, 'image'), '专用图');
  assert.equal(storyboardShotPrompt(withPrompt, 'video'), '专用视频');
});

test('镜头数量上限与重新编号只作用于真实行', async () => {
  const { normalizeStoryboardShots, MAX_STORYBOARD_SHOTS } = await env.load('domain/graph/StoryboardScript');
  const rows = Array.from({ length: MAX_STORYBOARD_SHOTS + 5 }, (_, index) => ({ plot: `镜头${index}` }));
  const normalized = normalizeStoryboardShots(rows);
  assert.equal(normalized.length, MAX_STORYBOARD_SHOTS);
  assert.deepEqual(normalized.slice(0, 3).map((row) => row.shotNumber), [1, 2, 3]);
});

test('自动拆分与单镜时长自动写进模型合同，而不是编造固定镜头数', async () => {
  const { storyboardScriptInstruction } = await env.load('domain/graph/StoryboardScript');
  const instruction = storyboardScriptInstruction('auto', '', 'auto');
  assert.match(instruction, /根据内容决定镜头数量/);
  assert.match(instruction, /单镜时长由内容决定/);
  assert.doesNotMatch(instruction, /输出恰好/);
  const fixed = storyboardScriptInstruction(6, '', 10);
  assert.match(fixed, /输出恰好 6 个镜头/);
  assert.match(fixed, /每个镜头时长以 10 秒为基准/);
});

test('文本生成请求把分镜脚本视图编译成逐镜 JSON 合同', async () => {
  const { buildGenerationPayload } = await env.load('domain/graph/generationPayload');
  const { defaultGenerationModel } = await env.load('config/defaultGenerationModels');
  const node = {
    id: 'storyboard-1',
    type: 'textGeneration',
    title: '分镜脚本',
    canvasView: 'storyboard-script',
    model: defaultGenerationModel('textGeneration'),
    prompt: '女孩在雨夜走进便利店',
    config: { textSubtask: 'storyboard-script' },
    storyboardShotCount: 5,
    storyboardShots: [{ id: 'a' }, { id: 'b' }],
  };
  const payload = buildGenerationPayload(node, { nodes: [node], edges: [], materials: [], tasks: [] });
  assert.equal(payload.textSubtask, 'storyboard-script');
  assert.match(payload.prompt, /输出恰好 5 个镜头/);
  assert.match(payload.prompt, /"shots"/);
  assert.match(payload.prompt, /女孩在雨夜走进便利店/);
});
