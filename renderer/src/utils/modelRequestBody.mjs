const CONTROL_FIELDS = new Set([
  '__endpointPath', '__endpointScope', '__endpointMethod',
  '__multipart', '__inputImages', '__imageField', '__maskResource', '__maskField',
  '__signal', '__timeoutMs', '__providerId',
  '__headers', '__auth',
]);

const MULTIPART_RESOURCE_FIELDS = new Set(['images', 'input_images', 'reference_images']);

export function multipartArrayFieldName(fieldName = 'image', itemCount = 1) {
  const normalized = String(fieldName || 'image');
  if (itemCount <= 1 || normalized.endsWith('[]')) return normalized;
  return `${normalized}[]`;
}

export function modelRequestEntries(body = {}, { multipart = false } = {}) {
  return Object.entries(body || {}).filter(([key, value]) => {
    if (CONTROL_FIELDS.has(key)) return false;
    if (multipart && MULTIPART_RESOURCE_FIELDS.has(key)) return false;
    return value !== undefined;
  });
}

export function modelJsonRequestBody(body = {}) {
  return Object.fromEntries(modelRequestEntries(body));
}

// Default base URLs for providers (mirrors domain/provider/ProviderRegistry.ts)
const DEFAULT_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  bytedance: 'https://ark.cn-beijing.volces.com/api/v3',
  kling: 'https://api-singapore.klingai.com',
  minimax: 'https://api.minimax.io',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  xai: 'https://api.x.ai/v1',
  anthropic: 'https://api.anthropic.com',
  deepseek: 'https://api.deepseek.com/v1',
  qwen: '',
  moonshot: 'https://api.moonshot.ai/v1',
  zhipu: 'https://open.bigmodel.cn/api',
};

/**
 * 根据 provider 和用户配置的凭据解析实际 baseUrl 和 apiKey。
 * 每个 Provider 可以独立配置 Key 和地址。
 */
export function resolveProviderApiConfig(providerConfigs = {}, providerId = '') {
  const cfg = providerConfigs[providerId] || {};
  return {
    baseUrl: (cfg.baseUrl || DEFAULT_BASE_URLS[providerId] || '').replace(/\/+$/, ''),
    apiKey: (cfg.apiKey || '').trim(),
  };
}

export function modelApiUrl(providerConfigs, path, scope = 'v1', providerId = '') {
  const config = resolveProviderApiConfig(providerConfigs, providerId);
  if (!config.baseUrl) throw new Error(`请先在设置中配置 ${providerId || 'API'} 地址和 Key`);
  const normalizedPath = String(path || '').startsWith('/') ? String(path) : `/${path}`;
  if (scope === 'root' || /\/v1$/i.test(config.baseUrl)) return `${config.baseUrl}${normalizedPath}`;
  return `${config.baseUrl}/v1${normalizedPath}`;
}
