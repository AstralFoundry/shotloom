function normalizedBaseUrl(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

function openAiCompatibleBaseUrl(baseUrl, endpoint) {
  const normalized = normalizedBaseUrl(baseUrl);
  const path = String(endpoint?.path || '');
  if (!normalized || !path.startsWith('/') || path.startsWith('//')) {
    throw new Error('Agent 文本模型缺少合法的 API Base URL 或 endpoint path');
  }
  if (String(endpoint?.method || '').toUpperCase() !== 'POST' || !path.endsWith('/chat/completions')) {
    throw new Error('Agent 自定义文本模型必须使用 OpenAI-compatible POST /chat/completions 协议');
  }
  const endpointPath = endpoint?.scope === 'root' || normalized.toLowerCase().endsWith('/v1')
    ? path
    : `/v1${path}`;
  const requestUrl = new URL(`${normalized}${endpointPath}`);
  requestUrl.pathname = requestUrl.pathname.slice(0, -'/chat/completions'.length).replace(/\/+$/, '');
  requestUrl.search = '';
  requestUrl.hash = '';
  return requestUrl.toString().replace(/\/+$/, '');
}

export function resolveOpenCodeProvider(providerId, baseUrl, endpoint) {
  if (providerId === 'anthropic') {
    return { npm: '@ai-sdk/anthropic', baseURL: normalizedBaseUrl(baseUrl) };
  }
  if (providerId === 'openai') {
    return { npm: '@ai-sdk/openai', baseURL: normalizedBaseUrl(baseUrl) };
  }
  return {
    npm: '@ai-sdk/openai-compatible',
    baseURL: openAiCompatibleBaseUrl(baseUrl, endpoint),
  };
}

export function agentReasoningFallback(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  const toolConflict = message.includes('Function tools with reasoning_effort are not supported');
  const explicitFallback = message.includes("set reasoning_effort to 'none'");
  return toolConflict && explicitFallback ? 'none' : '';
}
