/**
 * adapters — 内置厂商的唯一登记处。
 *
 * 没有在这里登记的厂商就不存在：界面无法添加，运行时也无法执行，与 Agent 工具白名单
 * 同样是 fail-closed。支持新厂商 = 新建一个适配器文件并在此登记一行。
 */

import type { ProviderAdapter } from '../ProviderAdapter';
import { openaiAdapter } from './openai';
import { starrouterAdapter } from './starrouter';
import { bytedanceAdapter } from './bytedance';
import { klingAdapter } from './kling';
import { minimaxAdapter } from './minimax';
import { runningHubAdapter } from './runninghub';
import { googleAdapter } from './google';
import { xaiAdapter } from './xai';
import { deepseekAdapter } from './deepseek';
import { anthropicAdapter } from './anthropic';
import { qwenAdapter } from './qwen';
import { moonshotAdapter } from './moonshot';
import { zhipuAdapter } from './zhipu';

const ADAPTERS: readonly ProviderAdapter[] = Object.freeze([
  openaiAdapter,
  starrouterAdapter,
  bytedanceAdapter,
  klingAdapter,
  minimaxAdapter,
  runningHubAdapter,
  googleAdapter,
  xaiAdapter,
  deepseekAdapter,
  anthropicAdapter,
  qwenAdapter,
  moonshotAdapter,
  zhipuAdapter,
]);

const ADAPTERS_BY_ID = new Map(ADAPTERS.map((adapter) => [adapter.id, adapter]));

export function getProviderAdapters(): readonly ProviderAdapter[] {
  return ADAPTERS;
}

export function findProviderAdapter(id: string): ProviderAdapter | undefined {
  return ADAPTERS_BY_ID.get(id);
}

export function getProviderAdapter(id: string): ProviderAdapter {
  const adapter = ADAPTERS_BY_ID.get(id);
  if (!adapter) {
    throw new Error(`${id || '未知'} 没有内置厂商适配器；支持新厂商要在 domain/provider/adapters 新增文件并登记`);
  }
  return adapter;
}

/**
 * 厂商实际使用的接口地址：用户覆盖优先，否则是适配器声明的内置地址。
 * 设置保存时按同一规则写回，Rust 网关因此不需要知道任何厂商地址。
 */
export function resolveProviderBaseUrl(
  adapter: ProviderAdapter,
  config: { baseUrl?: string } = {},
): string {
  const value = String(config.baseUrl || '').trim() || adapter.baseUrl.trim();
  return value.replace(/\/+$/, '');
}
