/**
 * ProviderConfig — 用户在一个厂商上唯一能配置的数据。
 *
 * 厂商身份、模型定义和协议都由统一插件注册表声明，设置里只保存
 * API Key、接口地址覆盖与 Agent 缓存保留偏好；保存时按适配器规范化，
 * baseUrl 始终是实际生效值。
 */

import { getProviderAdapters, resolveProviderBaseUrl } from './adapters';

export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  /** Omitted means the official Harness adapter's default. */
  cacheRetention?: 'short' | 'long';
}

export type ProviderConfigs = Record<string, ProviderConfig>;

/**
 * 保留未安装或已停用厂商的凭据，已安装厂商补齐默认地址。
 */
export function normalizeProviderConfigs(configs: Record<string, any> = {}): ProviderConfigs {
  // Keep disconnected/disabled plugin credentials; loading or disabling a package must never erase them.
  const retained = Object.fromEntries(Object.entries(configs).filter(([, value]) => value && typeof value === 'object').map(([id, config]) => [id, {
    apiKey: String(config.apiKey || '').trim(), baseUrl: String(config.baseUrl || '').trim(),
    ...(config.cacheRetention === 'short' || config.cacheRetention === 'long' ? { cacheRetention: config.cacheRetention as 'short' | 'long' } : {}),
  }]));
  for (const adapter of getProviderAdapters()) {
    const config = configs?.[adapter.id] || {};
    retained[adapter.id] = { ...retained[adapter.id], apiKey: String(config.apiKey || '').trim(), baseUrl: resolveProviderBaseUrl(adapter, config) };
  }
  return retained;
}
