function normalizedBaseUrl(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

function openAiCompatibleBaseUrl(baseUrl, endpoint) {
  const normalized = normalizedBaseUrl(baseUrl);
  const path = String(endpoint?.path || '');
  if (!normalized || !path.startsWith('/') || path.startsWith('//')) {
    throw new Error('Agent 文本模型缺少合法的 API Base URL 或 endpoint path');
  }
  if (String(endpoint?.method || '').toUpperCase() !== 'POST') {
    throw new Error('Agent 文本模型协议必须使用 POST endpoint');
  }
  if (!path.endsWith('/chat/completions') && !path.endsWith('/responses')) {
    throw new Error('Agent 文本模型 endpoint 与声明的 OpenAI 协议不匹配');
  }
  const endpointPath = endpoint?.scope === 'root' || normalized.toLowerCase().endsWith('/v1')
    ? path
    : `/v1${path}`;
  const requestUrl = new URL(`${normalized}${endpointPath}`);
  const suffix = path.endsWith('/chat/completions') ? '/chat/completions' : '/responses';
  requestUrl.pathname = requestUrl.pathname.slice(0, -suffix.length).replace(/\/+$/, '');
  requestUrl.search = '';
  requestUrl.hash = '';
  return requestUrl.toString().replace(/\/+$/, '');
}

export function resolveOpenCodeProvider(providerId, baseUrl, endpoint, transport = 'provider-default') {
  if (transport === 'openai-chat-completions') {
    if (!String(endpoint?.path || '').endsWith('/chat/completions')) {
      throw new Error('Agent Chat Completions 协议与 endpoint path 不匹配');
    }
    return { npm: '@ai-sdk/openai-compatible', baseURL: openAiCompatibleBaseUrl(baseUrl, endpoint) };
  }
  if (transport === 'openai-responses') {
    if (!String(endpoint?.path || '').endsWith('/responses')) {
      throw new Error('Agent Responses 协议与 endpoint path 不匹配');
    }
    return { npm: '@ai-sdk/openai', baseURL: openAiCompatibleBaseUrl(baseUrl, endpoint) };
  }
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
