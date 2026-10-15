import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentProtocolAccumulator, normalizeAgentProtocolResponse } from '../renderer/src/utils/agentProtocolStream.mjs';
import { modelJsonRequestBody } from '../renderer/src/utils/modelRequestBody.mjs';

test('Responses 流保留文本、call_id、完整工具参数和用量', () => {
  const deltas = [];
  const stream = createAgentProtocolAccumulator('openai-responses', (delta) => deltas.push(delta));
  stream.push({ type: 'response.output_text.delta', delta: '正在处理' });
  stream.push({ type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', call_id: 'call-1', name: 'lookup', arguments: '' } });
  stream.push({ type: 'response.function_call_arguments.delta', output_index: 1, delta: '{"id":' });
  stream.push({ type: 'response.function_call_arguments.done', output_index: 1, call_id: 'call-1', name: 'lookup', arguments: '{"id":1}' });
  stream.push({ type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 8, output_tokens: 12 } } });
  const result = stream.result();
  assert.equal(result.choices[0].message.content, '正在处理');
  assert.deepEqual(deltas, ['正在处理']);
  assert.deepEqual(result.choices[0].message.tool_calls[0], {
    id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{"id":1}' },
  });
  assert.equal(result.usage.completion_tokens, 12);
});

test('Anthropic Messages 流解析工具块与 max_tokens 截断', () => {
  const stream = createAgentProtocolAccumulator('anthropic-messages');
  stream.push({ type: 'message_start', message: { usage: { input_tokens: 10 } } });
  stream.push({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  stream.push({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '核验中' } });
  stream.push({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tool-1', name: 'lookup', input: {} } });
  stream.push({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"id":1}' } });
  stream.push({ type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 3 } });
  const result = stream.result();
  assert.equal(result.__finishReason, 'length');
  assert.equal(result.choices[0].message.content, '核验中');
  assert.equal(result.choices[0].message.tool_calls[0].function.arguments, '{"id":1}');
  assert.equal(result.usage.prompt_tokens, 10);
});

test('非流式 Responses 和 Messages 可回退为统一回执', () => {
  const responses = normalizeAgentProtocolResponse('openai-responses', {
    status: 'completed', output: [{ type: 'function_call', call_id: 'call-2', name: 'lookup', arguments: '{}' }],
  });
  assert.equal(responses.choices[0].message.tool_calls[0].id, 'call-2');
  const messages = normalizeAgentProtocolResponse('anthropic-messages', {
    stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tool-2', name: 'lookup', input: { id: 2 } }],
  });
  assert.equal(messages.choices[0].message.tool_calls[0].function.arguments, '{"id":2}');
});

test('Agent 协议选择字段不会离开渲染进程', () => {
  assert.deepEqual(modelJsonRequestBody({ model: 'example', __agentProtocol: 'anthropic-messages' }), { model: 'example' });
});
