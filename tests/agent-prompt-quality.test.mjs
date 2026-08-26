import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const prompt = (name) => readFileSync(
  new URL(`../renderer/src/agent/content/prompts/${name}.md`, import.meta.url),
  'utf8',
);

test('基础 Agent 提示词包含角色、事实边界、交互、附件、工具和交付契约', () => {
  const body = prompt('system-base');
  for (const section of [
    '# Role', '# Authority and Sources of Truth', '# Interaction Principles',
    '# Creative Direction', '# Intent, Source and Production Stage',
    '# Attachments and Existing Media', '# Canvas and Tool Contract',
    '# Execution Integrity', '# Response Standard',
  ]) assert.match(body, new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(body, /不要先输出“收到”“好的”“我将开始”/);
  assert.match(body, /不得编造节点、附件、产物、任务 ID/);
  assert.match(body, /不要在自然语言回复中打印工具调用 JSON/);
  assert.match(body, /用户本轮提供的附件是最高优先级操作对象/);
  assert.match(body, /区分创意概念、小说或长篇章节、故事大纲、文学剧本/);
  assert.match(body, /目标不能从输入类型机械推导/);
  assert.match(body, /不得把整部小说直接压缩成少量图片或视频提示词/);
  assert.match(body, /canvas_list_nodes.*canvas_get_node/s);
  assert.match(body, /canvas_create_node.*nodeIds/s);
  assert.match(body, /canvas_layout_nodes.*不得期待布局工具从标题、节点类型或关键词猜测/s);
  assert.match(body, /不得调用 `canvas_start_generation`/);
  assert.match(body, /inspect_tasks.*等待上游任务达到终态/s);
  assert.doesNotMatch(body, /不得调用 `start_generation`/);
});

test('运行时由 OpenCode 装配唯一 Agent、Skill、Contract 和子 Agent', () => {
  const runtime = readFileSync(new URL('../renderer/src/agent/runtime/OpenCodeRuntime.ts', import.meta.url), 'utf8');
  assert.match(runtime, /createOpencodeClient/);
  assert.match(runtime, /system-base\.md\?raw/);
  assert.match(runtime, /contractsForAgentType/);
  assert.match(runtime, /subagent_started/);
  assert.doesNotMatch(runtime, /collaborative|autonomous/);
});
