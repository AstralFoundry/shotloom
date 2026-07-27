import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createChatCompletionStreamAccumulator,
  mergeChatCompletionStreamFragment,
  parseChatCompletionSseLine,
} from '../renderer/src/utils/chatCompletionStream.mjs';

test('聊天流逐段显示文字并重建完整工具调用', () => {
  const deltas = [];
  const stream = createChatCompletionStreamAccumulator((delta) => deltas.push(delta));
  stream.push(parseChatCompletionSseLine('data: {"choices":[{"delta":{"role":"assistant","content":"正在"}}]}'));
  stream.push(parseChatCompletionSseLine('data: {"choices":[{"delta":{"content":"处理","tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"get_canvas","arguments":"{\\"scope\\":"}}]}}]}'));
  stream.push(parseChatCompletionSseLine('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"all\\"}"}}]}}]}'));

  const result = stream.result();
  assert.deepEqual(deltas, ['正在', '处理']);
  assert.equal(result.choices[0].message.content, '正在处理');
  assert.equal(result.choices[0].message.tool_calls[0].function.name, 'get_canvas');
  assert.equal(result.choices[0].message.tool_calls[0].function.arguments, '{"scope":"all"}');
});

test('聊天流忽略结束标记和非数据行', () => {
  assert.equal(parseChatCompletionSseLine('event: message'), null);
  assert.equal(parseChatCompletionSseLine('data: [DONE]'), null);
});

test('累计式工具参数不会被重复拼接', () => {
  assert.equal(
    mergeChatCompletionStreamFragment('{"actions":[', '{"actions":[{"type":"create_gen_node"}'),
    '{"actions":[{"type":"create_gen_node"}',
  );

  const stream = createChatCompletionStreamAccumulator();
  stream.push({ choices: [{ delta: { tool_calls: [{
    index: 0,
    id: 'call-cumulative',
    type: 'function',
    function: { name: 'mutate_canvas', arguments: '{"actions":[' },
  }] } }] });
  stream.push({ choices: [{ delta: { tool_calls: [{
    index: 0,
    function: {
      name: 'mutate_canvas',
      arguments: '{"actions":[{"type":"create_gen_node"}]',
    },
  }] } }] });
  stream.push({ choices: [{ delta: { tool_calls: [{
    index: 0,
    function: { arguments: '{"actions":[{"type":"create_gen_node"}]}' },
  }] } }] });

  const call = stream.result().choices[0].message.tool_calls[0];
  assert.equal(call.function.name, 'mutate_canvas');
  assert.equal(call.function.arguments, '{"actions":[{"type":"create_gen_node"}]}');
});
