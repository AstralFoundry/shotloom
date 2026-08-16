import { renderMarkdown } from "../../utils/copilotMarkdown.js";
import type { CopilotMessage } from "./CopilotPanel";

export type PresentedCopilotMessage = CopilotMessage & { repeatedFailureCount?: number };

const markdownByMessage = new WeakMap<CopilotMessage, { content: string; html: string }>();

export function messageMarkdown(message: CopilotMessage) {
  const content = message.content || "";
  const cached = markdownByMessage.get(message);
  if (cached?.content === content) return cached.html;
  const html = renderMarkdown(content);
  markdownByMessage.set(message, { content, html });
  return html;
}

function failureIdentity(message: CopilotMessage): string {
  if (!message.error) return "";
  return [message.diagnosis?.code || "", message.error.trim().toLowerCase()].join(":");
}

export function compactRepeatedFailures(messages: CopilotMessage[]): PresentedCopilotMessage[] {
  const result: PresentedCopilotMessage[] = [];
  for (const message of messages) {
    const identity = failureIdentity(message);
    const previous = result.at(-1);
    if (identity && previous && failureIdentity(previous) === identity) {
      result[result.length - 1] = {
        ...message,
        repeatedFailureCount: Number(previous.repeatedFailureCount || 1) + 1,
      };
      continue;
    }
    result.push(message);
  }
  return result;
}

export function repeatsFollowingFailure(
  message: PresentedCopilotMessage,
  next?: PresentedCopilotMessage,
): boolean {
  const delivery = String(message.deliveryError || "").trim().toLowerCase();
  const failure = String(next?.error || "").trim().toLowerCase();
  return Boolean(delivery && failure && (failure.includes(delivery) || delivery.includes(failure)));
}
