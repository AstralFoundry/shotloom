import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import test, { before, after } from 'node:test';
import { readSource } from './helpers/sourceContract.mjs';
import { createRendererEnv } from './helpers/rendererSsr.mjs';
import { changedBuiltInFields, withBuiltInEntries, withoutBuiltInEntries } from '../renderer/src/services/builtInCatalogStorage.ts';

const skillsDir = 'renderer/src/agent/content/skills/';
const skillsRoot = new URL(`../${skillsDir}`, import.meta.url);
const skillFile = (relative) => readSource(`${skillsDir}${relative}`);
let env, skills;
before(async () => {
  env = await createRendererEnv();
  ({ builtInSkills: skills } = await env.load('services/builtInSkills'));
});
after(async () => env?.dispose());

// 内容和 frontmatter 由真实加载器解析，Skill 不再依赖额外 manifest。
function parseSkill(id) {
  const skill = skills.find((item) => item.id === id);
  assert.ok(skill, `未加载 Skill: ${id}`);
  return { metadata: skill, body: skill.instructions };
}

test('随包 Skill 与磁盘目录一一对应，身份、说明和启用状态来自原生 SKILL.md', () => {
  const directories = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(new URL(`${entry.name}/SKILL.md`, skillsRoot)))
    .map((entry) => entry.name).sort();
  assert.deepEqual(skills.map((skill) => skill.id).sort(), directories);
  assert.equal(new Set(skills.map((skill) => skill.id)).size, skills.length);
  for (const id of directories) {
    const { metadata, body } = parseSkill(id);
    assert.ok(metadata.name && metadata.description && body.trim(), `${id} 缺少身份或说明`);
    assert.ok(metadata.category, `${id} 缺少分类`);
    assert.ok(Number.isInteger(metadata.version) && metadata.version > 0, `${id} 缺少有效版本`);
    assert.equal(Object.hasOwn(metadata, 'triggers'), false, `${id} 不应保留关键词路由字段`);
    assert.ok(body.length < 20_000, `${id} 正文超过工具溢出阈值，应拆入 references`);
  }
});

test('Skill 正文引用的随包资料真实存在，包括跨 Skill 引用', () => {
  for (const skill of skills) {
    const cited = new Set([...skill.instructions.matchAll(/(?:[A-Za-z0-9_-]+\/)?references\/[A-Za-z0-9_./-]+\.(?:md|txt|json)/g)].map((match) => match[0]));
    for (const path of cited) {
      const relative = path.startsWith('references/') ? `${skill.id}/${path}` : path;
      assert.ok(existsSync(new URL(relative, skillsRoot)), `${skill.id} 引用了不存在的 ${path}`);
    }
  }
});

test('内置 Skill 不引用其他平台的工具或翻译占位符', () => {
  for (const { id, instructions } of skills) {
    assert.doesNotMatch(instructions, /#ph\d+#|\uFFFD|⟦\d+⟧/, `${id} 含翻译残留`);
    assert.doesNotMatch(instructions, /\bhub_(?:write|read|save_file_to_session|edit|canvas_write_text_node|canvas_write_node|generate_video|ffmpeg|audio_generation|analyse_media)\b/, `${id} 引用了外部平台工具`);
    assert.doesNotMatch(instructions, /`question`/, `${id} 应使用 request_clarification`);
  }
});

test('角色板合同拥有四区域布局，其他 Skill 引用该合同', () => {
  const { body } = parseSkill('character-board');
  assert.match(body, /左侧.*正面.*侧面.*背面/);
  assert.match(body, /右侧.*正脸/);
  assert.match(body, /只保留这四个主要区域/);
  assert.match(body, /明确写出“扩展角色板”并确认/);
  assert.match(parseSkill('script-storyboard').body, /character-board/);
  assert.match(parseSkill('script-to-video').body, /character-board/);
});


test('内置与自定义 Skill 使用同一结构持久化，内置内容允许覆盖', () => {
  const parsed = parseSkill('character-board');
  const builtInSkill = {
    id: parsed.metadata.id,
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

test('目录移除的内置条目在合并时被清理，自定义条目保留', () => {
  const hydrated = withBuiltInEntries({
    storageVersion: 1,
    skills: [
      { id: 'removed', builtIn: true, enabled: true },
      { id: 'kept', builtIn: true, enabled: false },
      { id: 'custom', builtIn: false, enabled: true },
    ],
  }, 'skills', [{ id: 'kept', builtIn: true, enabled: true, version: 2 }]);
  assert.deepEqual(hydrated.skills.map((skill) => skill.id), ['kept', 'custom']);
});

test('内置目录差异忽略启停和运行时字段', () => {
  const original = { id: 'demo', name: 'Demo', instructions: 'Default', builtIn: true, enabled: true };
  assert.deepEqual(changedBuiltInFields({ ...original, enabled: false, updatedAt: 'now' }, [original]), []);
  assert.deepEqual(changedBuiltInFields({ ...original, instructions: 'Edited' }, [original]), ['instructions']);
});

test('视频类 Skill 等待图片完成但不规划内部预处理节点', () => {
  for (const id of ['keyframe-video', 'talking-head', 'video-ad', 'video-production', 'script-to-video']) {
    const { body } = parseSkill(id);
    assert.doesNotMatch(body, /apply_colored_pencil/, `${id} 不应暴露内部彩铅动作`);
    assert.match(body, /内部.*运行时自动完成|视频输入的内部适配由运行时完成/, `${id} 缺少内部适配说明`);
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
