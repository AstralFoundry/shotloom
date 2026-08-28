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

test('协议提示词要求建立来源证据链并区分中转与厂商原生协议', () => {
  assert.match(prompt, /先研究，再生成/);
  assert.match(prompt, /模型列表或价格页只能证明模型 ID 可能存在/);
  assert.match(prompt, /模型 ID → 请求端点 → 输入模式 → 参数 → 异步轮询 → 结果/);
  assert.match(prompt, /不要把厂商原生端点直接套给协议不同的中转站/);
  assert.match(prompt, /同一个站点可能分别实现 OpenAI Chat、Responses、Images、Videos、厂商原生任务/);
  assert.match(prompt, /兼容 OpenAI 不等于支持全部 OpenAI 能力/);
  assert.match(prompt, /先只问一个集中、具体的澄清问题/);
});

test('协议提示词不从素材示例或总媒体数猜参考图能力', () => {
  assert.match(prompt, /最大数量必须逐种核实/);
  assert.match(prompt, /不要把“最多 N 个媒体”自行解释成“N 张参考图”/);
  assert.match(prompt, /不要用示例里恰好出现的素材数量当上限/);
  assert.match(prompt, /Chat Completions 与 Responses 的字段不能混用/);
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
