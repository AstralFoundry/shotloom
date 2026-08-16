import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const prompt = readFileSync(
  new URL('../renderer/src/config/protocol-authoring-prompt.md', import.meta.url),
  'utf8',
);

function visit(value, callback) {
  if (!value || typeof value !== 'object') return;
  callback(value);
  for (const item of Array.isArray(value) ? value : Object.values(value)) visit(item, callback);
}

test('协议生成提示词中的所有 JSON 示例都可直接解析', () => {
  const examples = [...prompt.matchAll(/```json\s*([\s\S]*?)```/g)].map((match) => match[1]);
  assert.ok(examples.length >= 10);
  for (const example of examples) assert.doesNotThrow(() => JSON.parse(example));
});

test('协议示例中的每个画布参数都明确声明展示方式', () => {
  for (const match of prompt.matchAll(/```json\s*([\s\S]*?)```/g)) {
    const example = JSON.parse(match[1]);
    visit(example, (value) => {
      if (!Array.isArray(value.params)) return;
      for (const param of value.params) {
        assert.equal(typeof param.presentation, 'object', `${param.key} 缺少 presentation`);
        assert.notEqual(param.presentation, null, `${param.key} 的 presentation 为空`);
      }
    });
  }
});

test('协议提示词明确分离媒体角色、业务槽位和厂商字段', () => {
  assert.match(prompt, /`referenceImage` 不是 `inputSlot`/);
  assert.match(prompt, /`inputConstraints\.\*\.roles` 表示媒体角色/);
  assert.match(prompt, /`inputSlots` 表示画布业务位置/);
  assert.match(prompt, /`requestFields` 和 `contentTemplate`.*厂商请求/);

  for (const match of prompt.matchAll(/```json\s*([\s\S]*?)```/g)) {
    const example = JSON.parse(match[1]);
    visit(example, (value) => {
      if (Array.isArray(value.inputSlots)) {
        assert.equal(value.inputSlots.includes('referenceImage'), false);
      }
    });
  }
});

test('协议提示词覆盖运行时必需边界和局部模板变量作用域', () => {
  assert.match(prompt, /必须同时给出非负整数 `min` 和 `max`/);
  assert.match(prompt, /使用 `inputVariants`/);
  assert.match(prompt, /每个 mode 至少有一种结果来源/);
  assert.match(prompt, /只在 `contentTemplate` 的单项模板中存在/);
  assert.match(prompt, /taskEndpoint.*taskIdPath.*statusPath.*pollStatusMap/s);
  assert.match(prompt, /openai-chat-completions/);
  assert.match(prompt, /requestOptions/);
  assert.match(prompt, /不会出现在 Agent 模型列表/);
  assert.match(prompt, /不得由模型名称猜测/);
  assert.match(prompt, /不了解 API 的普通创作者/);
  assert.match(prompt, /1–5 个参数/);
  assert.match(prompt, /不能把厂商 API 参数表原样铺到画布/);
  assert.match(prompt, /"control": "hidden"/);
  assert.match(prompt, /最终自检/);
});
