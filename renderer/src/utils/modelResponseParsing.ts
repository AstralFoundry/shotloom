import { t } from '../i18n/index.ts';
function errorMessage(value: any): string {
  if (typeof value === 'string') return value;
  return value?.message || value?.error?.message || '';
}

/** 解析 OpenAI 兼容 JSON，以及图片/视频网关常见的 SSE 完成事件。 */
export function parseModelResponseText(text = ''): any {
  if (!String(text).trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    // Continue with SSE parsing.
  }
  const events = String(text).split(/\r?\n/)
    .filter((line) => line.trim().startsWith('data:'))
    .map((line) => line.trim().slice(5).trim())
    .filter((line) => line && line !== '[DONE]')
    .flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  const failed = events.find((event: any) => event?.error || ['error', 'upstream_error'].includes(event?.type));
  if (failed) throw new Error(errorMessage(failed.error) || failed.message || t("model.stream.error"));
  const images = events.flatMap((event: any) => {
    if (Array.isArray(event?.data)) return event.data;
    if (['image_generation.completed', 'image_edit.completed'].includes(event?.type)
      && (event.url || event.image_url || event.b64_json)) {
      return [{ url: event.url || event.image_url, b64_json: event.b64_json, revised_prompt: event.revised_prompt }];
    }
    return [];
  }).filter((item: any) => item?.url || item?.b64_json);
  if (images.length) {
    const last = events.at(-1) || {};
    return { created: last.created_at || last.created, data: images, ...(last.usage ? { usage: last.usage } : {}) };
  }
  return events.at(-1)?.data || events.at(-1) || null;
}

export function modelResponseError(data: any, status: number): string {
  const message = errorMessage(data?.error) || errorMessage(data) || data?.message;
  if (/country,?\s*region,?\s*or\s*territory\s*not\s*supported|user\s+location\s+is\s+not\s+supported/i.test(String(message || ''))) {
    return t("model.response.unsupportedRegion");
  }
  if (message) return message;
  if (status === 429) return t("model.response.rateLimited");
  if ([502, 503, 504, 524].includes(status)) return t("model.response.gatewayUnavailable", { status });
  return t("model.response.httpFailed", { status });
}
