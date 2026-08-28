import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { builtInRecipes } from '../renderer/src/services/builtInRecipes.js';
import {
  changedBuiltInFields,
  withBuiltInEntries,
  withoutBuiltInEntries,
} from '../renderer/src/services/builtInCatalogStorage.js';

const skillsRoot = new URL('../renderer/src/agent/content/skills/', import.meta.url);
const expectedIds = [
  'ecommerce-product',
  'general',
  'h3-video-prompt',
  'keyframe-video',
  'script-to-video',
  'short-drama',
  'social-media',
  'talking-head',
  'video-ad',
  'video-production',
];
const expectedNames = {
  'ecommerce-product': '商品视觉工坊',
  general: '基础任务助手',
  'h3-video-prompt': 'MiniMax H3 多段式提示词',
  'keyframe-video': '关键帧动态编排',
  'script-to-video': '剧本生视频（需上传剧本）',
  'short-drama': '连续短剧制作',
  'social-media': '社媒内容运营',
  'talking-head': '主播口播制作',
  'video-ad': '商业广告影片',
  'video-production': '全流程影像制作',
};

function parseSkill(id) {
  const content = readFileSync(new URL(`${id}/SKILL.md`, skillsRoot), 'utf8');
  const manifest = JSON.parse(readFileSync(new URL(`${id}/skill.json`, skillsRoot), 'utf8'));
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  assert.ok(match, `${id} 缺少 frontmatter`);
  const metadata = {};
  let currentListKey = '';
  for (const line of match[1].split(/\r?\n/)) {
    if (currentListKey && /^\s+-\s+.+/.test(line)) {
      const value = line.replace(/^\s+-\s+/, '').trim().replace(/^['"]|['"]$/g, '');
      if (!metadata[currentListKey]) metadata[currentListKey] = [];
      metadata[currentListKey].push(value);
      continue;
    }
    currentListKey = '';
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (value === '' || value === '[]') {
      currentListKey = key;
      metadata[key] = [];
    } else {
      metadata[key] = value;
    }
  }
  return { metadata, manifest, body: content.slice(match[0].length) };
}

test('内置 Skill 使用唯一 Nody 风格领域集合', () => {
  const ids = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      try { return readFileSync(new URL(`${entry.name}/SKILL.md`, skillsRoot), 'utf8').length > 0; } catch { return false; }
    })
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(ids, expectedIds);
});

test('每个内置 Skill 都使用新名称并包含触发、Recipe、工作流和终态评估', () => {
  const recipeIds = new Set(builtInRecipes.map((recipe) => recipe.id));
  for (const id of expectedIds) {
    const { metadata, manifest, body } = parseSkill(id);
    assert.equal(metadata.name, expectedNames[id]);
    assert.notEqual(metadata.name, id);
    assert.ok(metadata.description.length >= 20, `${id} description 过短`);
    // contracts is optional — when present it must be an array
    if (metadata.contracts) assert.ok(Array.isArray(metadata.contracts), `${id} contracts 必须是数组`);
    assert.equal(manifest.id, id);
    assert.ok(manifest.category);
    assert.ok(manifest.triggers.keywords.length > 0);
    assert.ok(manifest.recipeIds.length > 0);
    assert.equal(manifest.recipeIds.every((recipeId) => recipeIds.has(recipeId)), true, `${id} 引用了不存在的 Recipe`);
    assert.match(body, /Recipe|recipeId/);
    assert.match(body, /完成前/);
    assert.doesNotMatch(body, /nano-banana|gemini-3\.5|omni-flash/);
  }
});

test('内置与自定义 Skill 使用同一结构持久化，内置内容允许覆盖', () => {
  const parsed = parseSkill(expectedIds[0]);
  const builtInSkill = {
    id: parsed.manifest.id,
    name: parsed.metadata.name,
    description: parsed.metadata.description,
    instructions: parsed.body,
    enabled: true,
    builtIn: true,
  };
  const editedDescription = '本机修改后的技能说明';
  const storage = withoutBuiltInEntries({
    storageVersion: 1,
    skills: [
      { ...builtInSkill, description: editedDescription, enabled: false },
      { id: 'custom', name: 'Custom', description: 'Custom skill', instructions: 'Do it.', enabled: true },
    ],
  }, 'skills');
  assert.deepEqual(storage.skills.map((skill) => skill.id), [builtInSkill.id, 'custom']);

  const hydrated = withBuiltInEntries(storage, 'skills', [builtInSkill]);
  const editedBuiltIn = hydrated.skills.find((skill) => skill.id === builtInSkill.id);
  assert.equal(editedBuiltIn?.description, editedDescription);
  assert.equal(editedBuiltIn?.enabled, false);
  assert.equal(editedBuiltIn?.builtIn, true);
  assert.equal(hydrated.skills.find((skill) => skill.id === 'custom')?.enabled, true);
});

test('内置目录差异忽略启停和运行时字段', () => {
  const original = { id: 'demo', name: 'Demo', instructions: 'Default', builtIn: true, enabled: true };
  assert.deepEqual(changedBuiltInFields({ ...original, enabled: false, updatedAt: 'now' }, [original]), []);
  assert.deepEqual(changedBuiltInFields({ ...original, instructions: 'Edited' }, [original]), ['instructions']);
});

test('h3-video-prompt 使用能力驱动的基础与全参考多段式契约', () => {
  const { manifest, body } = parseSkill('h3-video-prompt');
  assert.equal(manifest.version, 1);
  assert.deepEqual(manifest.recipeIds, ['video-clip-generation']);
  for (const keyword of ['MiniMax H3', 'T2VA', 'I2VA', 'FL2VA', 'L2VA', 'Ref2VA']) {
    assert.ok(manifest.triggers.keywords.includes(keyword), `h3-video-prompt 缺少 ${keyword}`);
  }
  for (const field of [
    'integrated_multimodal_description', 'subject_definitions', 'summary',
    'retention_analysis', 'detailed_description', 'overall_soundscape', 'non_diegetic_music',
  ]) assert.match(body, new RegExp(field), `h3-video-prompt 缺少 ${field}`);
  assert.match(body, /inspect_model_catalog/);
  assert.match(body, /目录真实公开的能力/);
  assert.match(body, /不能根据文件数量、连接顺序或 UI 文案猜测/);
  assert.match(body, /台词、歌词和画面内可见文字保留用户原语言/);
  assert.match(body, /完成前评估/);
});

test('video-production v10 从来源成熟度动态推进并采用合规的人脸策略', () => {
  const { manifest, body } = parseSkill('video-production');
  assert.equal(manifest.version, 10);
  for (const recipeId of [
    'narrative-source-analysis', 'screenplay-adaptation',
    'video-character-design', 'video-character-turnaround', 'video-storyboard-grid',
    'video-shot-storyboard', 'video-action-sequence-board', 'video-frame-extraction', 'video-audio-production-sheet',
  ]) {
    assert.ok(manifest.recipeIds.includes(recipeId), `video-production 缺少 ${recipeId}`);
  }
  assert.match(body, /内部提取跨镜视觉实体并合并别名/);
  assert.match(body, /小说\/长篇章节/);
  assert.match(body, /不把小说直接当分镜/);
  assert.match(body, /纸人.*纸扎人.*纸扎人队列/);
  assert.match(body, /非人角色、怪物、拟人道具、群体角色/);
  assert.match(body, /电影级角色设计板/);
  assert.match(body, /不要把它当成所有视觉约束的通用替代品/);
  assert.match(body, /规划模式下关键帧尚无真实输出/);
  assert.match(body, /不要按固定数量连接/);
  assert.match(body, /超写实真人摄影质感/);
  assert.match(body, /画面闪烁和时序抖动/);
  assert.match(body, /不能被这段模板真人化/);
  assert.match(body, /不得通过模糊、马赛克、遮挡、拆分五官再重建等方式规避人脸审核/);
  assert.match(body, /不为这份判断额外创建表格节点/);
  assert.match(body, /不能冒充角色板/);
  assert.match(body, /不得把独立生成描述为“提取”/);
  assert.match(body, /没有待剪辑时间线|不存在的时间线/);
  assert.match(body, /plan_canvas.*完整.*可执行画布/s);
  assert.match(body, /说明.*代替.*节点/);
  assert.match(body, /六格动作序列/);
  assert.match(body, /默认不做十二格/);
  assert.doesNotMatch(body, /apply_colored_pencil/);
  assert.match(body, /内部适配由运行时自动完成/);
  assert.match(body, /canvas_layout_nodes/);
  assert.match(body, /canvas_start_generation/);
});

test('short-drama v8 支持小说改编并从当前内容成熟度继续', () => {
  const { manifest, body } = parseSkill('short-drama');
  assert.equal(manifest.version, 8);
  assert.ok(manifest.recipeIds.includes('narrative-source-analysis'));
  assert.ok(manifest.recipeIds.includes('screenplay-adaptation'));
  assert.ok(manifest.triggers.keywords.includes('小说改编'));
  assert.match(body, /来源成熟度和用户目标/);
  assert.match(body, /不要直接从小说跳到图片或视频/);
  assert.match(body, /完整分镜脚本.*直接进入视觉锚点或生成阶段/);
  assert.match(body, /多角色对话、身份特写、非人角色/);
  assert.match(body, /不固定为一张|不要规定固定参考数量/);
});

test('script-to-video v2 使用两轮 Prompt Draft 确认和细粒度画布工具契约', () => {
  const { manifest, body } = parseSkill('script-to-video');
  assert.equal(manifest.version, 2);
  for (const recipeId of [
    'script-element-reference', 'script-seedance-shot',
    'drama-shot-planning', 'video-audio-production-sheet',
  ]) assert.ok(manifest.recipeIds.includes(recipeId), `script-to-video 缺少 ${recipeId}`);
  assert.match(body, /没有可读取的剧本正文[\s\S]*?request_clarification/);
  assert.match(body, /Final_Video_Spec\.md/);
  assert.match(body, /元素图 Prompt Draft 与强制确认/);
  assert.match(body, /镜头视频 Prompt Draft 与强制确认/);
  assert.match(body, /没有明确确认，严禁创建、配置或启动对应的图片生成节点/);
  assert.match(body, /没有明确确认，严禁创建、配置或启动对应视频节点/);
  assert.match(body, /摄像机 → 主体 → 空间 → 音频/);
  assert.match(body, /不要用“0–3 秒、3–6 秒”/);
  assert.match(body, /no music/);
  assert.match(body, /no subtitles/);
  assert.match(body, /只有所选模式真实提供清晰度参数时才请求 2K/);
  assert.match(body, /当前 Shotloom Agent 没有可自动操作剪辑时间线的画布工具/);
  for (const toolId of [
    'canvas_list_nodes', 'canvas_get_node', 'canvas_create_node', 'canvas_update_node',
    'canvas_connect_nodes', 'canvas_layout_nodes', 'canvas_start_generation', 'inspect_tasks',
  ]) assert.match(body, new RegExp(toolId), `script-to-video 缺少 ${toolId}`);
  assert.match(body, /布局工具不会从标题、节点类型或文案猜测故事结构/);
  assert.match(body, /已经返回成功 `nodeIds`、`edgeIds` 或 `taskIds` 的操作不得整批重放/);
  assert.doesNotMatch(body, /resource_prepare_and_analyze|text_editor|storyboard_designer|media_generator|video_assembler|reply_to_user/);
});

test('视频类 Skill 根据镜头风险选择直接参考而不是固定一根线', () => {
  const expectedVersions = {
    'video-production': 10,
    'script-to-video': 2,
    'short-drama': 8,
    'talking-head': 4,
    'video-ad': 4,
    'keyframe-video': 3,
  };
  for (const [id, version] of Object.entries(expectedVersions)) {
    const { manifest, body } = parseSkill(id);
    assert.equal(manifest.version, version);
    assert.match(body, /风险|身份|产品/);
    assert.match(body, /提示词.*参考|输入职责|约束职责/);
    assert.doesNotMatch(body, /视频节点优先只接这张主关键帧/);
  }
});

test('视频类 Skill 等待图片完成但不规划内部预处理节点', () => {
  for (const id of ['keyframe-video', 'talking-head', 'video-ad', 'video-production', 'script-to-video']) {
    const { body } = parseSkill(id);
    assert.doesNotMatch(body, /apply_colored_pencil/, `${id} 不应暴露内部彩铅动作`);
    assert.match(body, /内部.*运行时自动完成|内部输入适配由运行时自动完成/, `${id} 缺少内部适配说明`);
    assert.match(body, /等待|完成/, `${id} 缺少上游图片终态约束`);
  }
});

test('过期内置目录升级内容并保留启用状态', () => {
  const hydrated = withBuiltInEntries({
    storageVersion: 1,
    skills: [{ id: 'demo', version: 1, builtIn: true, enabled: false, instructions: '旧内容' }],
  }, 'skills', [{ id: 'demo', version: 2, builtIn: true, enabled: true, instructions: '新内容' }]);
  assert.equal(hydrated.skills[0].version, 2);
  assert.equal(hydrated.skills[0].instructions, '新内容');
  assert.equal(hydrated.skills[0].enabled, false);
});
