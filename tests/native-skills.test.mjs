import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assertNativeSkillId,
  nativeRuntimeSkills,
} from '../renderer/src/agent/runtime/nativeSkills.ts';

test('原生 Skill 只物化启用项并携带用途、完整正文和 Recipe 范围', () => {
  const result = nativeRuntimeSkills([{
    id: 'video-production',
    name: '全流程影像制作',
    description: '根据真实输入制作完整视频工作流。',
    instructions: '先检查来源成熟度，再按真实依赖推进。',
    workflow: '规划后执行。',
    recipeIds: ['video-creative-outline', 'video-clip-generation'],
    enabled: true,
  }, {
    id: 'disabled-skill',
    description: '已关闭。',
    instructions: '不得加载。',
    enabled: false,
  }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'video-production');
  assert.match(result[0].content, /^---\nname: video-production\ndescription:/);
  assert.match(result[0].content, /# 全流程影像制作/);
  assert.match(result[0].content, /先检查来源成熟度/);
  assert.match(result[0].content, /video-creative-outline/);
  assert.match(result[0].content, /video-clip-generation/);
});

test('原生 Skill ID 契约拒绝旧式冒号、下划线和路径字符', () => {
  assert.doesNotThrow(() => assertNativeSkillId('script-to-video'));
  for (const id of ['skill:name', 'skill_name', '../skill', '-skill', 'skill-']) {
    assert.throws(() => assertNativeSkillId(id));
  }
});

test('Copilot 选择 Skill 后直接在输入框写入可见的原生 slash 指令', () => {
  const panel = readFileSync(new URL('../renderer/src/app/copilot/CopilotPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /<Dropdown/);
  assert.match(panel, /items: enabledSkills\.map/);
  assert.match(panel, /setMessage\(current \? `\/\$\{skill\.id\} \$\{current\}` : `\/\$\{skill\.id\} `\)/);
  assert.match(panel, /className=\{`copilot-skill-trigger\$\{selectedSkill \? " is-active" : ""\}`\}/);
  assert.match(panel, /selectedKeys: selectedSkillId \? \[selectedSkillId\] : \[\]/);
  assert.doesNotMatch(panel, /className="copilot-selected-skill"/);
  assert.doesNotMatch(panel, /skill=\{selectedSkillId/);
});
