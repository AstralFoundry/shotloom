import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assertSkillId,
  buildSkillDocuments,
} from '../renderer/src/agent/loop/skillDocuments.ts';

test('Skill 说明只装配启用项并携带用途、完整正文且无需模板范围', () => {
  const result = buildSkillDocuments([{
    id: 'video-production',
    name: '全流程影像制作',
    description: '根据真实输入制作完整视频工作流。',
    instructions: '先检查来源成熟度，再按真实依赖推进。',
    workflow: '规划后执行。',
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
  assert.match(result[0].content, /## Workflow/);
  assert.doesNotMatch(result[0].content, /Recipe Scope|只可使用/);
});

test('缺少用途或正文的 Skill 不会静默进入模型上下文', () => {
  assert.throws(() => buildSkillDocuments([{ id: 'video-production', name: '影像制作' }]),
    /缺少用途说明或完整指令/);
  assert.throws(() => buildSkillDocuments([
    { id: 'video-editing', description: '剪辑。', instructions: '按需求剪辑。' },
    { id: 'video-editing', description: '剪辑。', instructions: '按需求剪辑。' },
  ]), /Skill ID 重复/);
});

test('Skill ID 契约拒绝旧式冒号、下划线和路径字符', () => {
  assert.doesNotThrow(() => assertSkillId('script-to-video'));
  for (const id of ['skill:name', 'skill_name', '../skill', '-skill', 'skill-']) {
    assert.throws(() => assertSkillId(id));
  }
});

test('助手选择 Skill 后直接在输入框写入可见的 slash 指令', () => {
  const composer = readFileSync(new URL('../renderer/src/app/agent-chat/Composer.tsx', import.meta.url), 'utf8');
  // Skill 前缀是用户可见、可编辑的文本，不是隐藏的附件字段。
  assert.match(composer, /setText\(stripped \? `\/\$\{item\.id\} \$\{stripped\}` : `\/\$\{item\.id\} `\)/);
  assert.match(composer, /const prefix = skillId \? `\/\$\{skillId\}` : ""/);
  assert.match(composer, /const \[skillId, setSkillId\] = useState<string \| null>\(null\)/);
  assert.match(composer, /skill\.enabled !== false/);
  assert.doesNotMatch(composer, /selectedSkillId|<Dropdown/);
});
