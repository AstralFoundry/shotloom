/**
 * ProviderRegistry — 内置 Provider 定义。
 *
 * 每个 Provider 声明名称、默认 base URL、认证方式、凭据字段。
 * 模型通过 model-catalog-v2.json 的 provider 字段路由到对应凭据。
 */

import type { CatalogModel } from '../catalog/ModelCatalog';

// ── Types ────────────────────────────────────────────────────────────────────

export type ProviderAuthType = 'api-key' | 'oauth';

export interface ProviderCredential {
  key: string;
  label: string;
  required: boolean;
  secret?: boolean;
  placeholder?: string;
}

export interface ProviderDefinition {
  id: string;
  name: string;
  description: string;
  iconId: string;
  authType: ProviderAuthType;
  defaultBaseUrl: string;
  modelsPath?: string;
  credentials: ProviderCredential[];
}

export interface ProviderConfig {
  displayName?: string;
  /** 用户自行添加的声明式协议厂商。 */
  custom?: boolean;
  apiKey: string;
  baseUrl: string;
  iconId?: string;
  models?: CatalogModel[];
  /** 内置模型仍保留在目录中，这里只记录用户明确停用的条目，便于随时恢复。 */
  disabledModelIds?: string[];
}

// ── Built-in Providers ──────────────────────────────────────────────────────

const KEY_FIELD: ProviderCredential = {
  key: 'apiKey', label: 'API Key', required: true, secret: true,
};

const BUILT_IN_PROVIDERS: ProviderDefinition[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT / GPT Image 官方接口',
    iconId: 'openai',
    authType: 'api-key',
    defaultBaseUrl: 'https://api.openai.com/v1',
    modelsPath: '/models',
    credentials: [
      KEY_FIELD,
      { key: 'baseUrl', label: '接口地址', required: false, placeholder: 'https://api.openai.com/v1' },
    ],
  },
  {
    id: 'starrouter',
    name: 'StarRouter',
    description: 'OpenAI 兼容的多模型中转服务',
    iconId: 'starrouter',
    authType: 'api-key',
    defaultBaseUrl: 'https://starrouter.io/v1',
    modelsPath: '/models',
    credentials: [
      KEY_FIELD,
      { key: 'baseUrl', label: '接口地址', required: false, placeholder: 'https://starrouter.io/v1' },
    ],
  },
  {
    id: 'bytedance',
    name: 'Seedance（火山方舟）',
    description: 'Seedance 官方模型服务；模型 ID 以方舟控制台实际开放项为准',
    iconId: 'volcengine',
    authType: 'api-key',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    modelsPath: '/models',
    credentials: [
      KEY_FIELD,
      { key: 'baseUrl', label: '接口地址', required: false, placeholder: 'https://ark.cn-beijing.volces.com/api/v3' },
    ],
  },
  {
    id: 'kling',
    name: 'Kling AI（可灵）',
    description: '可灵 3.0 系列官方视频生成接口',
    iconId: 'kling',
    authType: 'api-key',
    defaultBaseUrl: 'https://api-singapore.klingai.com',
    credentials: [
      KEY_FIELD,
      { key: 'baseUrl', label: '接口地址', required: false, placeholder: 'https://api-singapore.klingai.com' },
    ],
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    description: 'MiniMax Hailuo 视频生成官方接口',
    iconId: 'minimax',
    authType: 'api-key',
    defaultBaseUrl: 'https://api.minimax.io',
    credentials: [
      KEY_FIELD,
      { key: 'baseUrl', label: '接口地址', required: false, placeholder: 'https://api.minimax.io' },
    ],
  },
  {
    id: 'runninghub',
    name: 'RunningHub',
    description: 'RunningHub 工作流生成服务',
    iconId: 'runninghub',
    authType: 'api-key',
    defaultBaseUrl: 'https://www.runninghub.ai',
    credentials: [
      KEY_FIELD,
      { key: 'baseUrl', label: '接口地址', required: false, placeholder: 'https://www.runninghub.ai' },
    ],
  },
  {
    id: 'google',
    name: 'Google Gemini',
    description: 'Gemini / Imagen / Veo 官方接口',
    iconId: 'gemini',
    authType: 'api-key',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    modelsPath: '/models',
    credentials: [
      KEY_FIELD,
      { key: 'baseUrl', label: '接口地址', required: false, placeholder: 'https://generativelanguage.googleapis.com/v1beta' },
    ],
  },
  {
    id: 'xai',
    name: 'xAI',
    description: 'Grok 模型服务',
    iconId: 'xai',
    authType: 'api-key',
    defaultBaseUrl: 'https://api.x.ai/v1',
    credentials: [
      KEY_FIELD,
      { key: 'baseUrl', label: '接口地址', required: false, placeholder: 'https://api.x.ai/v1' },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek 模型服务',
    iconId: 'deepseek',
    authType: 'api-key',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    credentials: [
      KEY_FIELD,
      { key: 'baseUrl', label: '接口地址', required: false, placeholder: 'https://api.deepseek.com/v1' },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    description: 'Claude 官方 Messages API',
    iconId: 'anthropic',
    authType: 'api-key',
    defaultBaseUrl: 'https://api.anthropic.com',
    modelsPath: '/v1/models',
    credentials: [
      KEY_FIELD,
      { key: 'baseUrl', label: '接口地址', required: false, placeholder: 'https://api.anthropic.com' },
    ],
  },
  {
    id: 'qwen',
    name: '阿里云百炼 Qwen',
    description: 'Qwen 文本与图片官方工作空间接口',
    iconId: 'qwen',
    authType: 'api-key',
    defaultBaseUrl: '',
    credentials: [
      KEY_FIELD,
      { key: 'baseUrl', label: '工作空间地址', required: true, placeholder: 'https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com' },
    ],
  },
  {
    id: 'moonshot',
    name: 'Moonshot Kimi',
    description: 'Kimi 官方 OpenAI 兼容接口',
    iconId: 'moonshot',
    authType: 'api-key',
    defaultBaseUrl: 'https://api.moonshot.ai/v1',
    modelsPath: '/models',
    credentials: [
      KEY_FIELD,
      { key: 'baseUrl', label: '接口地址', required: false, placeholder: 'https://api.moonshot.ai/v1' },
    ],
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    description: 'GLM / GLM-Image / CogVideoX 官方接口',
    iconId: 'zhipu',
    authType: 'api-key',
    defaultBaseUrl: 'https://open.bigmodel.cn/api',
    credentials: [
      KEY_FIELD,
      { key: 'baseUrl', label: '接口地址', required: false, placeholder: 'https://open.bigmodel.cn/api' },
    ],
  },
];

const PROVIDER_MAP = new Map(BUILT_IN_PROVIDERS.map((d) => [d.id, d]));
const PROVIDER_LIST = Object.freeze([...BUILT_IN_PROVIDERS]);

export function getProviderDefinitions(): readonly ProviderDefinition[] {
  return PROVIDER_LIST;
}

export function getProviderDefinition(id: string): ProviderDefinition | undefined {
  return PROVIDER_MAP.get(id);
}

/**
 * 从 Provider 配置解析出实际使用的 baseUrl 和 apiKey。
 */
export function resolveProviderCredentials(
  providerId: string,
  configs: Record<string, ProviderConfig>,
): { baseUrl: string; apiKey: string } {
  const definition = getProviderDefinition(providerId);
  const config = configs[providerId];
  return {
    baseUrl: (config?.baseUrl || definition?.defaultBaseUrl || '').replace(/\/+$/, ''),
    apiKey: config?.apiKey || '',
  };
}

/**
 * 查找配置了有效凭据的所有 provider。
 */
export function getConfiguredProviders(
  configs: Record<string, ProviderConfig>,
): Array<{ id: string; definition: ProviderDefinition; config: ProviderConfig }> {
  return Object.entries(configs)
    .filter(([, config]) => Boolean(config?.apiKey?.trim()))
    .map(([id, config]) => {
      const builtIn = getProviderDefinition(id);
      const definition = builtIn || {
        id,
        name: config.displayName || id,
        description: '自定义声明式协议模型服务',
        iconId: config.iconId || 'custom',
        authType: 'api-key' as const,
        defaultBaseUrl: '',
        credentials: [KEY_FIELD, { key: 'baseUrl', label: '接口地址', required: true }],
      };
      return { id, definition, config };
    });
}
