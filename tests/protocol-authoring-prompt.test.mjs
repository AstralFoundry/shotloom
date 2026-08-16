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
  assert.ok(examples.length >= 3);
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
  assert.match(prompt, /`referenceImage` 不是 inputSlot/);
  assert.match(prompt, /`inputConstraints\.images\.roles` 只能用 `referenceImage`/);
  assert.match(prompt, /`inputSlots` 只能用/);
  assert.match(prompt, /厂商自己的.*字段名只放在 `requestTemplate`、`requestFields` 或 `contentTemplate`/);

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
  assert.match(prompt, /必须同时填写非负整数 `min` 和 `max`/);
  assert.match(prompt, /使用 `inputVariants`/);
  assert.match(prompt, /至少一种真实结果来源/);
  assert.match(prompt, /局部变量不能直接放进普通 `requestTemplate`/);
  assert.match(prompt, /taskEndpoint.*taskIdPath.*statusPath.*pollStatusMap/s);
  assert.match(prompt, /openai-chat-completions/);
  assert.match(prompt, /requestOptions/);
  assert.match(prompt, /不会出现在 Agent 模型列表/);
  assert.match(prompt, /不能根据模型名称猜/);
  assert.match(prompt, /"control": "hidden"/);
  assert.match(prompt, /输出前检查/);
});

test('协议提示词优先生成可直接使用的创作者界面', () => {
  assert.ok(prompt.split('\n').length < 300);
  assert.match(prompt, /不要把 API 文档里的全部可选字段复制进 `params`/);
  assert.match(prompt, /普通创作者在画布上确实需要调整的少量设置/);
  assert.match(prompt, /固定不变的请求值直接写进 `requestTemplate`/);
  assert.match(prompt, /完全用不到的 API 字段直接省略/);
  assert.match(prompt, /每个 `\{\{params\.xxx\}\}` 必须有同名 param/);
  assert.match(prompt, /参数名称、默认值、选项和数值范围必须全部来自用户材料/);
  assert.doesNotMatch(prompt, /"max": 100000/);
  assert.doesNotMatch(prompt, /"max_tokens": "\{\{params\.maxTokens\}\}"/);
});
