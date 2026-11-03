/**
 * ProviderConfig — 用户在一个厂商上唯一能配置的数据。
 *
 * 厂商身份、模型定义和协议都由 domain/provider/adapters 的代码声明，设置里只保存
 * API Key 与可选的接口地址覆盖；保存时按适配器规范化，因此 baseUrl 始终是实际生效值，
 * Rust 网关不需要知道任何厂商地址。
 */

import { getProviderAdapters, resolveProviderBaseUrl } from './adapters';

export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
}

export type ProviderConfigs = Record<string, ProviderConfig>;

/**
 * 丢弃未知厂商和已废弃的自定义字段，只保留内置厂商的 Key 与实际生效地址。
 */
export function normalizeProviderConfigs(configs: Record<string, any> = {}): ProviderConfigs {
  return Object.fromEntries(getProviderAdapters().map((adapter) => {
    const config = configs?.[adapter.id] || {};
    return [adapter.id, {
      apiKey: String(config.apiKey || '').trim(),
      baseUrl: resolveProviderBaseUrl(adapter, config),
    }];
  }));
}
