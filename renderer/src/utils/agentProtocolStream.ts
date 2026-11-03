import { t } from '../i18n/index.ts';
/** Provider-specific stream progress the loop needs before the turn has finished. */
export interface AgentStreamProgress {
  reasoning?: string;
  tool?: { index: number; id: string; name: string };
}

/**
 * Read the visible reasoning and tool-call start from one protocol event.
 * The loop only needs facts that already arrived; it never guesses a tool from text.
 */
export function readAgentStreamProgress(protocol: string, event: any): AgentStreamProgress {
  if (!event) return {};
  if (protocol === 'openai-responses') {
    if ((event.type === 'response.reasoning_summary_text.delta'
      || event.type === 'response.reasoning_text.delta') && typeof event.delta === 'string' && event.delta) {
      return { reasoning: event.delta };
    }
    if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
      return {
        tool: {
          index: Number.isInteger(event.output_index) ? event.output_index : 0,
          id: String(event.item.call_id || event.item.id || ''),
          name: String(event.item.name || ''),
        },
      };
    }
    return {};
  }
  if (protocol === 'anthropic-messages') {
    if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta'
      && typeof event.delta.thinking === 'string' && event.delta.thinking) {
      return { reasoning: event.delta.thinking };
    }
    if (event.type === 'content_block_start' && event.content_block?.type === 'thinking'
      && typeof event.content_block.thinking === 'string' && event.content_block.thinking) {
      return { reasoning: event.content_block.thinking };
    }
    if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      return {
        tool: {
          index: Number.isInteger(event.index) ? event.index : 0,
          id: String(event.content_block.id || ''),
          name: String(event.content_block.name || ''),
        },
      };
    }
    return {};
  }
  const delta = event.choices?.[0]?.delta;
  const thought = typeof delta?.reasoning_content === 'string'
    ? delta.reasoning_content
    : typeof delta?.reasoning === 'string'
      ? delta.reasoning
      : typeof delta?.reasoning?.content === 'string' ? delta.reasoning.content : '';
  const progress: AgentStreamProgress = thought ? { reasoning: thought } : {};
  const tool = Array.isArray(delta?.tool_calls)
    ? delta.tool_calls.find((call: any) => call?.function?.name)
    : undefined;
  if (tool) {
    progress.tool = {
      index: Number.isInteger(tool.index) ? tool.index : 0,
      id: String(tool.id || ''),
      name: String(tool.function.name || ''),
    };
  }
  return progress;
}

/** Normalize Responses and Messages streams to the loop's Chat-shaped turn. */
export function createAgentProtocolAccumulator(
  protocol: string,
  onTextDelta: (text: string) => void = () => undefined,
  onEvent: (event: any) => void = () => undefined,
) {
  const calls = new Map<any, any>();
  const blocks = new Map<any, any>();
  const responseItems = new Map<any, any>();
  let content = '';
  let reasoning = '';
  let usage: any;
  let finishReason = '';
  let eventCount = 0;

  function callAt(key: any) {
    if (!calls.has(key)) calls.set(key, { id: '', type: 'function', function: { name: '', arguments: '' } });
    return calls.get(key);
  }
  function addText(delta: any) {
    if (typeof delta !== 'string' || !delta) return;
    content += delta;
    onTextDelta(delta);
  }
  function addReasoning(delta: any) {
    if (typeof delta !== 'string' || !delta) return;
    reasoning += delta;
  }
  function push(event: any = {}) {
    if (event.type === 'error' || event.type === 'response.failed') {
      throw new Error(event.error?.message || event.response?.error?.message || t("model.stream.error"));
    }
    onEvent(event);
    eventCount += 1;
    if (protocol === 'openai-responses') {
      const key = event.output_index ?? event.item?.id ?? event.item_id;
      if (event.type === 'response.output_text.delta') addText(event.delta);
      if (event.type === 'response.reasoning_summary_text.delta'
        || event.type === 'response.reasoning_text.delta') addReasoning(event.delta);
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
        if (event.response?.status === 'failed') throw new Error(event.response?.error?.message || t("model.response.failed"));
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
        if (event.content_block?.type === 'thinking') addReasoning(event.content_block.thinking);
        if (event.content_block?.type === 'text') addText(event.content_block.text);
      }
      if (event.type === 'content_block_delta') {
        if (event.delta?.type === 'text_delta') addText(event.delta.text);
        if (event.delta?.type === 'thinking_delta') addReasoning(event.delta.thinking);
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
    const tool_calls = [...calls.values()].map((call: any) => ({
      ...call, function: { ...call.function, arguments: call.function.arguments || '{}' },
    }));
    return { choices: [{ message: {
      role: 'assistant', content, tool_calls,
      ...(reasoning ? { reasoning_content: reasoning } : {}),
    }, finish_reason: finishReason }],
      usage: usage && { prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens,
        input_tokens: usage.input_tokens, output_tokens: usage.output_tokens }, __finishReason: finishReason,
      __responseItems: [...responseItems.values()] };
  }
  return { push, result, get eventCount() { return eventCount; } };
}

/** Reasoning parts carry display text in summaries (Responses) or thinking blocks (Messages). */
function reasoningItemText(item: any): string {
  const parts = Array.isArray(item?.summary) ? item.summary : Array.isArray(item?.content) ? item.content : [];
  return parts.map((part: any) => (part?.type === 'summary_text' || part?.type === 'reasoning_text'
    ? part.text || '' : '')).join('');
}

export function normalizeAgentProtocolResponse(
  protocol: string,
  data: any,
  onTextDelta: (text: string) => void = () => undefined,
) {
  if (protocol === 'openai-responses') {
    const calls = (data.output || []).filter((item: any) => item.type === 'function_call').map((item: any) => ({
      id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments || '{}' },
    }));
    const content = (data.output || []).flatMap((item: any) => item.type === 'message'
      ? (item.content || []).filter((part: any) => part.type === 'output_text').map((part: any) => part.text || '') : []).join('');
    const reasoning = (data.output || [])
      .filter((item: any) => item.type === 'reasoning')
      .map(reasoningItemText)
      .join('');
    if (content) onTextDelta(content);
    return { choices: [{ message: {
      role: 'assistant', content, tool_calls: calls,
      ...(reasoning ? { reasoning_content: reasoning } : {}),
    } }],
      usage: { prompt_tokens: data.usage?.input_tokens, completion_tokens: data.usage?.output_tokens },
      __finishReason: data.status === 'incomplete' ? 'length' : 'stop',
      __responseItems: (data.output || []).filter((item: any) => item.type === 'reasoning') };
  }
  const content = (data.content || []).filter((block: any) => block.type === 'text').map((block: any) => block.text || '').join('');
  const calls = (data.content || []).filter((block: any) => block.type === 'tool_use').map((block: any) => ({
    id: block.id, type: 'function', function: { name: block.name, arguments: JSON.stringify(block.input || {}) },
  }));
  const reasoning = (data.content || [])
    .filter((block: any) => block.type === 'thinking')
    .map((block: any) => block.thinking || '')
    .join('');
  if (content) onTextDelta(content);
  return { choices: [{ message: {
    role: 'assistant', content, tool_calls: calls,
    ...(reasoning ? { reasoning_content: reasoning } : {}),
  } }],
    usage: { prompt_tokens: data.usage?.input_tokens, completion_tokens: data.usage?.output_tokens },
    __finishReason: data.stop_reason === 'max_tokens' ? 'length' : (data.stop_reason || 'stop') };
}
