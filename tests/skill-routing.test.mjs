import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { parseSkillRoutingDecision } from '../renderer/src/agent/runtime/skillRoutingDecision.ts';

const skills = [
  { id: 'general', name: 'general' },
  { id: 'short-drama', name: 'short-drama' },
  { id: 'video-production', name: 'video-production' },
];

test('Skill Router 只接受模型返回的结构化选择', () => {
  const decision = parseSkillRoutingDecision(
    '{"skillId":"video-production","continueProductionPlan":true,"reason":"完整视频交付"}',
    skills,
  );
  assert.equal(decision.skill.id, 'video-production');
  assert.equal(decision.continueProductionPlan, true);
  assert.equal(decision.usedFallback, false);
});

test('无效 Router 输出安全回退到 general，不做关键词猜测', () => {
  const decision = parseSkillRoutingDecision('短剧、对白、分镜', skills);
  assert.equal(decision.skill.id, 'general');
  assert.equal(decision.continueProductionPlan, false);
  assert.equal(decision.usedFallback, true);
  assert.equal(existsSync(new URL('../renderer/src/utils/skillRouting.mjs', import.meta.url)), false);
});
