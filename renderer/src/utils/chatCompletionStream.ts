import { t } from '../i18n/index.ts';
/**
 * OpenAI-compatible providers differ here: some stream true deltas while
 * others resend the complete value accumulated so far. Accept both without
 * duplicating a cumulative tool-call payload.
 */
export function mergeChatCompletionStreamFragment(current = '', incoming = '') {
  const previous = String(current || '');
  const fragment = String(incoming || '');
  if (!fragment) return previous;
  if (!previous) return fragment;
  if (fragment.length > previous.length && fragment.startsWith(previous)) return fragment;
  if (fragment === previous && fragment.length >= 8) return previous;
  if (fragment.length >= 8 && previous.endsWith(fragment)) return previous;
  return previous + fragment;
}

function appendToolCall(message: any, chunk: any = {}, fallbackIndex = 0) {
  const index = Number.isInteger(chunk.index) ? chunk.index : fallbackIndex;
  message.tool_calls ||= [];
  const current = message.tool_calls[index] ||= {
    id: '',
    type: 'function',
    function: { name: '', arguments: '' },
  };
  if (chunk.id) current.id = chunk.id;
  if (chunk.type) current.type = chunk.type;
  if (chunk.function?.name) {
    current.function.name = mergeChatCompletionStreamFragment(current.function.name, chunk.function.name);
  }
  if (chunk.function?.arguments) {
    current.function.arguments = mergeChatCompletionStreamFragment(
      current.function.arguments,
      chunk.function.arguments,
    );
  }
}

/** Extract complete action objects from a streamed JSON `actions` array. */
export class IncrementalActionsParser {
  buffer = '';
  cursor = 0;
  arrayStarted = false;
  objectStart = -1;
  depth = 0;
  inString = false;
  escaped = false;

  push(fragment = '') {
    if (!fragment) return [];
    this.buffer += fragment;
    const output: unknown[] = [];
    if (!this.arrayStarted) {
      const match = /"actions"\s*:\s*\[/.exec(this.buffer);
      if (!match) return output;
      this.arrayStarted = true;
      this.cursor = match.index + match[0].length;
    }
    for (; this.cursor < this.buffer.length; this.cursor += 1) {
      const char = this.buffer[this.cursor];
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (char === '\\') this.escaped = true;
        else if (char === '"') this.inString = false;
        continue;
      }
      if (char === '"') { this.inString = true; continue; }
      if (char === '{') {
        if (this.depth === 0) this.objectStart = this.cursor;
        this.depth += 1;
      } else if (char === '}' && this.depth > 0) {
        this.depth -= 1;
        if (this.depth === 0 && this.objectStart >= 0) {
          try { output.push(JSON.parse(this.buffer.slice(this.objectStart, this.cursor + 1))); } catch { /* final parser reports it */ }
          this.objectStart = -1;
        }
      }
    }
    return output;
  }
}

/** Chat-compatible providers name the reasoning stream differently; keep the display text one field. */
function reasoningText(value: any): string {
  if (typeof value === 'string') return value;
  return typeof value?.content === 'string' ? value.content : '';
}

export function createChatCompletionStreamAccumulator(
  onTextDelta: (text: string) => void = () => undefined,
  onEvent: (event: any) => void = () => undefined,
) {
  const message: any = { role: 'assistant', content: '', tool_calls: [] };
  let reasoning = '';
  let usage: any;
  let eventCount = 0;

  return {
    push(event: any = {}) {
      if (event?.error) throw new Error(event.error?.message || event.error || t("model.stream.error"));
      onEvent(event);
      eventCount += 1;
      if (event.usage) usage = event.usage;
      const choice = event?.choices?.[0];
      const delta = choice?.delta;
      if (delta) {
        const thought = reasoningText(delta.reasoning_content) || reasoningText(delta.reasoning);
        if (thought) reasoning += thought;
        if (typeof delta.content === 'string' && delta.content) {
          message.content += delta.content;
          onTextDelta(delta.content);
        }
        (delta.tool_calls || []).forEach((toolCall: any, index: number) => appendToolCall(message, toolCall, index));
      } else if (choice?.message && !message.content && !message.tool_calls.length) {
        const complete = choice.message;
        message.role = complete.role || 'assistant';
        message.content = typeof complete.content === 'string' ? complete.content : '';
        message.tool_calls = Array.isArray(complete.tool_calls) ? complete.tool_calls : [];
        reasoning = reasoningText(complete.reasoning_content) || reasoningText(complete.reasoning) || reasoning;
        if (message.content) onTextDelta(message.content);
      }
    },
    result() {
      const normalized = {
        ...message,
        ...(reasoning ? { reasoning_content: reasoning } : {}),
        ...(message.tool_calls.length ? {} : { tool_calls: undefined }),
      };
      return {
        choices: [{ message: normalized }],
        ...(usage ? { usage } : {}),
      };
    },
    get eventCount() { return eventCount; },
  };
}

export function parseChatCompletionSseLine(line = ''): any {
  const trimmed = String(line).trim();
  if (!trimmed.startsWith('data:')) return null;
  const data = trimmed.slice(5).trim();
  if (!data || data === '[DONE]') return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}
