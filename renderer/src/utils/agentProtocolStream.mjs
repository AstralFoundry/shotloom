/** Normalize Responses and Messages streams to the loop's Chat-shaped turn. */
export function createAgentProtocolAccumulator(protocol, onTextDelta = () => undefined) {
  const calls = new Map();
  const blocks = new Map();
  const responseItems = new Map();
  let content = '';
  let usage;
  let finishReason = '';
  let eventCount = 0;

  function callAt(key) {
    if (!calls.has(key)) calls.set(key, { id: '', type: 'function', function: { name: '', arguments: '' } });
    return calls.get(key);
  }
  function addText(delta) {
    if (typeof delta !== 'string' || !delta) return;
    content += delta;
    onTextDelta(delta);
  }
  function push(event = {}) {
    if (event.type === 'error' || event.type === 'response.failed') {
      throw new Error(event.error?.message || event.response?.error?.message || '模型流返回错误');
    }
    eventCount += 1;
    if (protocol === 'openai-responses') {
      const key = event.output_index ?? event.item?.id ?? event.item_id;
      if (event.type === 'response.output_text.delta') addText(event.delta);
      if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
        const call = callAt(key);
        call.id = event.item.call_id || '';
        call.function.name = event.item.name || '';
        call.function.arguments = event.item.arguments || '';
      }
      if (event.type === 'response.function_call_arguments.delta') callAt(key).function.arguments += event.delta || '';
      if (event.type === 'response.function_call_arguments.done') {
        const call = callAt(key);
        call.id = event.call_id || call.id;
        call.function.name = event.name || call.function.name;
        call.function.arguments = event.arguments || call.function.arguments;
      }
      if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
        const call = callAt(key);
        call.id = event.item.call_id || call.id;
        call.function.name = event.item.name || call.function.name;
        call.function.arguments = event.item.arguments || call.function.arguments;
      }
      if (event.type === 'response.output_item.done' && event.item?.type === 'reasoning') {
        responseItems.set(event.item.id || event.output_index, event.item);
      }
      if (event.type === 'response.completed' || event.type === 'response.incomplete') {
        usage = event.response?.usage;
        for (const [index, item] of (event.response?.output || []).entries()) {
          if (item.type === 'reasoning') responseItems.set(item.id || responseItems.size, item);
          if (item.type === 'function_call') {
            const call = callAt(index);
            call.id = item.call_id || call.id;
            call.function.name = item.name || call.function.name;
            call.function.arguments = item.arguments || call.function.arguments;
          }
          if (!content && item.type === 'message') {
            for (const part of item.content || []) if (part.type === 'output_text') addText(part.text);
          }
        }
        finishReason = event.type === 'response.incomplete' ? 'length' : 'stop';
        if (event.response?.status === 'incomplete') finishReason = 'length';
        if (event.response?.status === 'failed') throw new Error(event.response?.error?.message || '模型响应失败');
      }
    } else {
      if (event.type === 'message_start') usage = event.message?.usage;
      if (event.type === 'content_block_start') {
        blocks.set(event.index, event.content_block?.type);
        if (event.content_block?.type === 'tool_use') {
          const call = callAt(event.index);
          call.id = event.content_block.id || '';
          call.function.name = event.content_block.name || '';
          call.function.arguments = event.content_block.input && Object.keys(event.content_block.input).length
            ? JSON.stringify(event.content_block.input) : '';
        }
        if (event.content_block?.type === 'text') addText(event.content_block.text);
      }
      if (event.type === 'content_block_delta') {
        if (event.delta?.type === 'text_delta') addText(event.delta.text);
        if (event.delta?.type === 'input_json_delta' && blocks.get(event.index) === 'tool_use') {
          callAt(event.index).function.arguments += event.delta.partial_json || '';
        }
      }
      if (event.type === 'message_delta') {
        finishReason = event.delta?.stop_reason === 'max_tokens' ? 'length' : (event.delta?.stop_reason || finishReason);
        usage = { ...usage, ...event.usage };
      }
    }
  }
  function result() {
    const tool_calls = [...calls.values()].map((call) => ({
      ...call, function: { ...call.function, arguments: call.function.arguments || '{}' },
    }));
    return { choices: [{ message: { role: 'assistant', content, tool_calls }, finish_reason: finishReason }],
      usage: usage && { prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens,
        input_tokens: usage.input_tokens, output_tokens: usage.output_tokens }, __finishReason: finishReason,
      __responseItems: [...responseItems.values()] };
  }
  return { push, result, get eventCount() { return eventCount; } };
}

export function normalizeAgentProtocolResponse(protocol, data, onTextDelta = () => undefined) {
  if (protocol === 'openai-responses') {
    const calls = (data.output || []).filter((item) => item.type === 'function_call').map((item) => ({
      id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments || '{}' },
    }));
    const content = (data.output || []).flatMap((item) => item.type === 'message'
      ? (item.content || []).filter((part) => part.type === 'output_text').map((part) => part.text || '') : []).join('');
    if (content) onTextDelta(content);
    return { choices: [{ message: { role: 'assistant', content, tool_calls: calls } }],
      usage: { prompt_tokens: data.usage?.input_tokens, completion_tokens: data.usage?.output_tokens },
      __finishReason: data.status === 'incomplete' ? 'length' : 'stop',
      __responseItems: (data.output || []).filter((item) => item.type === 'reasoning') };
  }
  const content = (data.content || []).filter((block) => block.type === 'text').map((block) => block.text || '').join('');
  const calls = (data.content || []).filter((block) => block.type === 'tool_use').map((block) => ({
    id: block.id, type: 'function', function: { name: block.name, arguments: JSON.stringify(block.input || {}) },
  }));
  if (content) onTextDelta(content);
  return { choices: [{ message: { role: 'assistant', content, tool_calls: calls } }],
    usage: { prompt_tokens: data.usage?.input_tokens, completion_tokens: data.usage?.output_tokens },
    __finishReason: data.stop_reason === 'max_tokens' ? 'length' : (data.stop_reason || 'stop') };
}
