import assert from 'node:assert/strict';
import test from 'node:test';

import {
  builtInRecipeChanges,
  builtInRecipes,
  withBuiltInRecipes,
  withoutBuiltInRecipes,
} from '../renderer/src/services/builtInRecipes.js';

test('内置 Recipe 使用单一提示词策略结构', () => {
  assert.equal(builtInRecipes.length, 48);
  assert.equal(new Set(builtInRecipes.map((recipe) => recipe.id)).size, builtInRecipes.length);
  for (const recipe of builtInRecipes) {
    assert.match(recipe.id, /^[a-z0-9_-]+$/);
    assert.ok(['image', 'video', 'audio', 'text'].includes(recipe.generationType));
    assert.ok(recipe.operationTypes.length > 0);
    assert.ok(recipe.systemPrompt.length > 0);
    assert.ok(recipe.requiredElements.length > 0);
    assert.equal('prompt' in recipe, false);
    assert.equal('content' in recipe, false);
  }
  for (const removedId of ['image-keyframe', 'video-shot', 'audio-track', 'text-deliverable', 'video-first-last-frame-generation']) {
    assert.equal(builtInRecipes.some((recipe) => recipe.id === removedId), false);
  }
});

test('通用视频 Recipe 区分角色板、动作分镜、帧提取与声音文档', () => {
  const byId = new Map(builtInRecipes.map((recipe) => [recipe.id, recipe]));
  assert.equal(byId.get('video-character-turnaround')?.generationType, 'image');
  assert.equal(byId.get('video-shot-storyboard')?.generationType, 'image');
  assert.match(byId.get('video-frame-extraction')?.systemPrompt || '', /referenceImage|参考图/);
  assert.equal(byId.get('video-audio-production-sheet')?.generationType, 'text');
});

test('长篇来源使用原作分析和影视剧本改编两个独立 Recipe', () => {
  const analysis = builtInRecipes.find((recipe) => recipe.id === 'narrative-source-analysis');
  const screenplay = builtInRecipes.find((recipe) => recipe.id === 'screenplay-adaptation');
  assert.equal(analysis?.generationType, 'text');
  assert.match(analysis?.systemPrompt || '', /区分原文事实、合理推断、缺失信息和改编建议/);
  assert.match(analysis?.systemPrompt || '', /不要提前写分镜、图片或视频提示词/);
  assert.equal(screenplay?.generationType, 'text');
  assert.match(screenplay?.systemPrompt || '', /成片类型、总时长或集数、单集时长/);
  assert.match(screenplay?.systemPrompt || '', /不得冒充原作事实/);
});

test('角色板采用电影开发式总板并保持跨区域身份一致', () => {
  const byId = new Map(builtInRecipes.map((recipe) => [recipe.id, recipe]));
  for (const recipeId of ['video-character-turnaround', 'drama-character-turnaround']) {
    const recipe = byId.get(recipeId);
    const prompt = recipe?.systemPrompt || '';
    assert.equal(recipe?.version, 3);
    assert.match(prompt, /主立像/);
    assert.match(prompt, /正面、3\/4、侧面、背面/);
    assert.match(prompt, /头部角度研究/);
    assert.match(prompt, /核心剧情情绪/);
    assert.match(prompt, /服装.*配件/);
    assert.match(prompt, /充足留白/);
    assert.match(prompt, /不对称/);
    assert.match(prompt, /不要默认.*真人/);
  }
});

test('视频 Recipe 以主关键帧锁定构图并按镜头风险补充参考', () => {
  const recipe = builtInRecipes.find((item) => item.id === 'video-clip-generation');
  assert.equal(recipe?.version, 6);
  assert.match(recipe?.systemPrompt || '', /主关键帧负责构图和起始状态/);
  assert.match(recipe?.systemPrompt || '', /多角色、身份特写、非人主体/);
  assert.match(recipe?.systemPrompt || '', /每张视觉输入.*约束/);
  assert.match(recipe?.systemPrompt || '', /不要固定参考数量/);
  assert.match(recipe?.systemPrompt || '', /真实细腻皮肤纹理/);
  assert.match(recipe?.systemPrompt || '', /自然微表情/);
  assert.match(recipe?.systemPrompt || '', /跳帧、闪烁、果冻感/);
  assert.match(recipe?.systemPrompt || '', /不得把半写实、动画、纸扎或怪物角色真人化/);
});

test('短剧视频 Recipe 对真人质感模板做风格条件判断', () => {
  const recipe = builtInRecipes.find((item) => item.id === 'drama-shot-video-generation');
  assert.equal(recipe?.version, 5);
  assert.match(recipe?.systemPrompt || '', /提示词逐项说明每张输入负责约束什么/);
  assert.match(recipe?.systemPrompt || '', /真实皮肤与自然表演/);
  assert.match(recipe?.systemPrompt || '', /漫剧、动画及风格化角色继承原风格/);
});

test('所有视频 Recipe 生成完整分秒导演稿而不是简短质量词', () => {
  const videoRecipes = builtInRecipes.filter((recipe) => recipe.generationType === 'video');
  assert.ok(videoRecipes.length >= 4);
  for (const recipe of videoRecipes) {
    const prompt = recipe.systemPrompt || '';
    assert.match(prompt, /全局镜头合同/, `${recipe.id} 缺少全局镜头合同`);
    assert.match(prompt, /覆盖完整总时长且不重叠、不留空档的时间码/, `${recipe.id} 缺少时间轴规则`);
    assert.match(prompt, /3–7 秒至少拆为 2 个动作节拍/, `${recipe.id} 缺少动态分段规则`);
    assert.match(prompt, /动作必须具体且有因果/, `${recipe.id} 缺少动作因果`);
    assert.match(prompt, /说话者、逐字台词、开始结束时间/, `${recipe.id} 缺少台词同步`);
    assert.match(prompt, /最后单列“负面约束”/, `${recipe.id} 缺少负面约束`);
  }
});

test('关键帧、短剧和口播视频 Recipe 补充各自的时间轴执行细节', () => {
  const byId = new Map(builtInRecipes.map((recipe) => [recipe.id, recipe]));
  assert.match(byId.get('video-clip-generation')?.systemPrompt || '', /视线、呼吸、口型、手部和身体微动作/);
  assert.match(byId.get('video-clip-generation')?.systemPrompt || '', /焦点何时转移/);
  assert.match(byId.get('drama-shot-video-generation')?.systemPrompt || '', /视线、姿态、运动方向和道具状态/);
  assert.match(byId.get('talking-head-clip-generation')?.systemPrompt || '', /按实际语速校验逐字台词/);
  assert.match(byId.get('talking-head-clip-generation')?.systemPrompt || '', /不能在最后一帧突然截断/);
});

test('复杂动作使用六格连续序列而不是默认十二格覆盖图', () => {
  const recipe = builtInRecipes.find((item) => item.id === 'video-action-sequence-board');
  assert.equal(recipe?.generationType, 'image');
  assert.match(recipe?.systemPrompt || '', /2 列×3 行六格/);
  assert.match(recipe?.systemPrompt || '', /起始状态/);
  assert.match(recipe?.systemPrompt || '', /接触点/);
  assert.match(recipe?.systemPrompt || '', /运动轴线/);
  assert.match(recipe?.systemPrompt || '', /不生成长句注释/);
  assert.match(recipe?.systemPrompt || '', /十二格堆叠/);
});

test('内置 Recipe 只把内容覆盖标记为已修改', () => {
  assert.deepEqual(builtInRecipeChanges(builtInRecipes[0]), []);
  assert.deepEqual(builtInRecipeChanges({ ...builtInRecipes[0], enabled: false }), []);
  assert.deepEqual(builtInRecipeChanges({ ...builtInRecipes[0], name: '自定义名称' }), ['name']);
});

test('内置与自定义 Recipe 使用同一结构持久化，内置内容允许覆盖', () => {
  const editedName = '本机修改后的通用图片 Recipe';
  const storage = withoutBuiltInRecipes({
    storageVersion: 1,
    recipes: [
      { ...builtInRecipes[0], name: editedName, enabled: false },
      { id: 'custom', name: 'Custom', generationType: 'text', operationTypes: ['text'], systemPrompt: 'Write.', enabled: true },
    ],
  });
  assert.deepEqual(storage.recipes.map((recipe) => recipe.id), [builtInRecipes[0].id, 'custom']);

  const hydrated = withBuiltInRecipes(storage);
  const editedBuiltIn = hydrated.recipes.find((recipe) => recipe.id === builtInRecipes[0].id);
  assert.equal(editedBuiltIn?.name, editedName);
  assert.equal(editedBuiltIn?.enabled, false);
  assert.equal(editedBuiltIn?.builtIn, true);
  assert.equal(hydrated.recipes.find((recipe) => recipe.id === 'custom')?.enabled, true);
});
