function errorMessage(value) {
  if (typeof value === 'string') return value;
  return value?.message || value?.error?.message || '';
}

/** 解析 OpenAI 兼容 JSON，以及图片/视频网关常见的 SSE 完成事件。 */
export function parseModelResponseText(text = '') {
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
  const failed = events.find((event) => event?.error || ['error', 'upstream_error'].includes(event?.type));
  if (failed) throw new Error(errorMessage(failed.error) || failed.message || '模型流返回错误');
  const images = events.flatMap((event) => {
    if (Array.isArray(event?.data)) return event.data;
    if (['image_generation.completed', 'image_edit.completed'].includes(event?.type)
      && (event.url || event.image_url || event.b64_json)) {
      return [{ url: event.url || event.image_url, b64_json: event.b64_json, revised_prompt: event.revised_prompt }];
    }
    return [];
  }).filter((item) => item?.url || item?.b64_json);
  if (images.length) {
    const last = events.at(-1) || {};
    return { created: last.created_at || last.created, data: images, ...(last.usage ? { usage: last.usage } : {}) };
  }
  return events.at(-1)?.data || events.at(-1) || null;
}

export function modelResponseError(data, status) {
  const message = errorMessage(data?.error) || errorMessage(data) || data?.message;
  if (/country,?\s*region,?\s*or\s*territory\s*not\s*supported|user\s+location\s+is\s+not\s+supported/i.test(String(message || ''))) {
    return '模型厂商不支持当前国家或地区，请切换其他已配置模型后重试';
  }
  if (message) return message;
  if (status === 429) return '模型请求过于频繁（HTTP 429），请稍后重试';
  if ([502, 503, 504, 524].includes(status)) return `上游模型网关暂时不可用（HTTP ${status}），请稍后重试`;
  return `模型请求失败（HTTP ${status}）`;
}
