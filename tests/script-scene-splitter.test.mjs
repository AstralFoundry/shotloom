import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectScriptStructure } from '../renderer/src/utils/scriptSceneSplitter.ts';

test('结构检查只返回显式候选并保留原文位置', () => {
  const sourceText = [
    '第1场 — 老宅 — 夜',
    '阿青：门怎么开了？',
    '母亲：别进去。',
    '第2场 — 院子 — 清晨',
    '阿青：昨晚有人来过。',
  ].join('\n');
  const result = inspectScriptStructure({ episodeId: 'ep-02', sourceText });

  assert.equal(result.page.text, sourceText);
  assert.equal(result.page.complete, true);
  assert.deepEqual(result.headingCandidates.map((item) => item.text), [
    '第1场 — 老宅 — 夜',
    '第2场 — 院子 — 清晨',
  ]);
  assert.deepEqual(result.speakerCandidates.map((item) => item.name), ['阿青', '母亲', '阿青']);
  for (const candidate of [...result.headingCandidates, ...result.speakerCandidates]) {
    const { start, length } = candidate.sourceRange;
    assert.ok(sourceText.slice(start, start + length).includes(candidate.text || candidate.name));
  }
});

test('没有显式标题时不替模型决定场次', () => {
  const sourceText = '一段连续叙事。\n\n另一段连续叙事。';
  const result = inspectScriptStructure({ sourceText });

  assert.deepEqual(result.headingCandidates, []);
  assert.match(result.warnings[0], /Agent 根据完整语义判断/);
  assert.equal('scenes' in result, false);
});

test('长来源可逐页无损重建且不会静默截断', () => {
  const sourceText = '照夜司。'.repeat(30_000);
  const pages = [];
  let cursor = 0;
  do {
    const result = inspectScriptStructure({ sourceText, cursor, pageChars: 35_000 });
    pages.push(result.page.text);
    cursor = result.page.nextCursor ?? sourceText.length;
  } while (cursor < sourceText.length);

  assert.equal(pages.join(''), sourceText);
});
