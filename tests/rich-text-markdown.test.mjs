import assert from 'node:assert/strict';
import test from 'node:test';
import { markdownToRichHtml } from '../renderer/src/utils/richTextMarkdown.mjs';

test('Markdown 转换成真实富文本标题、强调、列表和表格', () => {
  const html = markdownToRichHtml('# 标题\n\n正文 **粗体** 和 _斜体_\n\n- 一\n- 二\n\n| 名称 | 内容 |\n| --- | --- |\n| A | B |');
  assert.match(html, /<h1>标题<\/h1>/);
  assert.match(html, /<strong>粗体<\/strong>/);
  assert.match(html, /<em>斜体<\/em>/);
  assert.match(html, /<ul><li>一<\/li><li>二<\/li><\/ul>/);
  assert.match(html, /<table>[\s\S]*?<th>名称<\/th>[\s\S]*?<td>A<\/td>[\s\S]*?<\/table>/);
});

test('Markdown 富文本入口转义原始 HTML', () => {
  assert.doesNotMatch(markdownToRichHtml('<script>alert(1)</script>'), /<script>/);
});
