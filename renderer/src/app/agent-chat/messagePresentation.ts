import { renderMarkdown } from "../../utils/copilotMarkdown.js";
import type { AgentMessage } from "./contracts";

export type PresentedAgentMessage = AgentMessage & { repeatedFailureCount?: number };

const markdownByMessage = new WeakMap<AgentMessage, { content: string; html: string }>();

export function messageMarkdown(message: AgentMessage) {
  const content = message.content || "";
  const cached = markdownByMessage.get(message);
  if (cached?.content === content) return cached.html;
  const html = renderMarkdown(content);
  markdownByMessage.set(message, { content, html });
  return html;
}

function failureIdentity(message: AgentMessage): string {
  if (!message.error) return "";
  return [message.diagnosis?.code || "", message.error.trim().toLowerCase()].join(":");
}

export function compactRepeatedFailures(messages: AgentMessage[]): PresentedAgentMessage[] {
  const result: PresentedAgentMessage[] = [];
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
  message: PresentedAgentMessage,
  next?: PresentedAgentMessage,
): boolean {
  const delivery = String(message.deliveryError || "").trim().toLowerCase();
  const failure = String(next?.error || "").trim().toLowerCase();
  return Boolean(delivery && failure && (failure.includes(delivery) || delivery.includes(failure)));
}
