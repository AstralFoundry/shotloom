import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { createRendererEnv } from './helpers/rendererSsr.mjs';
import { VIDEO_MOTIONS, VIDEO_PROMPT_TEMPLATES } from '../renderer/src/domain/graph/VideoComposerPresets.ts';

test('视频运镜素材完整，模板保留参考项目的五个视频条目', async () => {
  assert.equal(VIDEO_MOTIONS.length, 33);
  assert.deepEqual(VIDEO_PROMPT_TEMPLATES.map(item => item.id), [
    'multi-angle', 'next-shot', 'story-beats', 'cinematic-light', 'video-prompt',
  ]);
  await Promise.all(VIDEO_MOTIONS.map(({ id }) => access(new URL(`../renderer/public/video-motion-covers/${id}.webp`, import.meta.url))));
});

test('运镜指令按选择顺序进入视频请求，模板作为可编辑正文提交', async (t) => {
  const env = await createRendererEnv();
  t.after(() => env.dispose());
  const { buildGenerationPayload } = await env.load('domain/graph/generationPayload');
  const [first, second] = VIDEO_MOTIONS;
  const prompt = `主体走向门口\n\n${VIDEO_PROMPT_TEMPLATES[0].prompt}`;
  const node = { id: 'video', type: 'videoGeneration', prompt, config: { videoMotionIds: [second.id, first.id, second.id, 'missing'] } };
  assert.equal(buildGenerationPayload(node, null).prompt, [prompt, second.prompt, first.prompt].join('\n\n'));
  assert.equal(buildGenerationPayload({ ...node, config: {} }, null).prompt, prompt);
});
