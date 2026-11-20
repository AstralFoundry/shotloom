import { execFileSync } from 'node:child_process';
import { Agent, Client, fetch as undiciFetch, ProxyAgent } from 'undici';

/**
 * 系统代理：与迁移前的 Rust 网关一致，优先读取环境变量，macOS 再读 scutil。
 * 回环地址永远直连（本地服务、桥接端口不能被代理接管）。
 */

const PROXY_ENV_KEYS = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy'];

const SYSTEM_PROXY_CACHE_MS = 5000;
let cacheExpiresAt = 0;
let cachedEnvironment = '';
let cachedAgentUrl: string | null = null;
let cachedUrl: string | null | undefined;
let cachedAgent: ProxyAgent | null = null;

/** 解析 macOS `scutil --proxy` 输出里的 HTTPS/HTTP 代理。 */
export function parseMacosSystemProxy(output: string): string | null {
  const values = new Map<string, string>();
  for (const line of output.split('\n')) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    values.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  for (const prefix of ['HTTPS', 'HTTP']) {
    if (values.get(`${prefix}Enable`) !== '1') continue;
    const host = values.get(`${prefix}Proxy`);
    const port = values.get(`${prefix}Port`);
    if (!host || !port) continue;
    try {
      const url = new URL(`http://${host}:${port}`);
      return url.toString();
    } catch {
      return null;
    }
  }
  return null;
}

function validProxyUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed : null;
  } catch {
    return null;
  }
}

export function resolvedSystemProxyUrl(): string | null {
  const environment = JSON.stringify(PROXY_ENV_KEYS.map(key => process.env[key] ?? ''));
  if (cachedUrl !== undefined && cachedEnvironment === environment && Date.now() < cacheExpiresAt) return cachedUrl;
  cachedEnvironment = environment;
  cacheExpiresAt = Date.now() + SYSTEM_PROXY_CACHE_MS;
  for (const key of PROXY_ENV_KEYS) {
    const value = process.env[key];
    if (!value) continue;
    const url = validProxyUrl(value);
    if (url) {
      cachedUrl = url;
      return cachedUrl;
    }
  }
  if (process.platform === 'darwin') {
    try {
      const output = execFileSync('/usr/sbin/scutil', ['--proxy'], { encoding: 'utf8' });
      const url = parseMacosSystemProxy(output);
      if (url) {
        cachedUrl = url;
        return cachedUrl;
      }
    } catch {
      /* 没有系统代理配置 */
    }
  }
  cachedUrl = null;
  return null;
}

function isLoopback(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '::1' || host === '0.0.0.0'
    || /^127\./.test(host) || host.endsWith('.localhost');
}

const CONNECT_TIMEOUT_MS = 15_000;
const responseTimeouts = { headersTimeout: 0, bodyTimeout: 0 };
const directAgent = new Agent({ ...responseTimeouts, connectTimeout: CONNECT_TIMEOUT_MS });

/**
 * 与 reqwest 的 `Proxy::custom` 一致：只对非回环目标使用代理。
 * 建连独立限时，连接后的响应等待由网关 AbortSignal 管理。
 */
export async function fetchThroughSystemProxy(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const proxy = resolvedSystemProxyUrl();
  if (proxy !== cachedAgentUrl) {
    void cachedAgent?.close().catch(() => undefined);
    cachedAgent = null;
    cachedAgentUrl = proxy;
  }
  let hostname = '';
  try { hostname = new URL(url).hostname; } catch { hostname = ''; }
  let dispatcher: Agent | ProxyAgent = directAgent;
  if (proxy && hostname && !isLoopback(hostname)) {
    cachedAgent ??= new ProxyAgent({
      uri: proxy,
      ...responseTimeouts,
      proxyTls: { timeout: CONNECT_TIMEOUT_MS },
      requestTls: { timeout: CONNECT_TIMEOUT_MS },
      clientFactory: (origin, options) => new Client(origin, { ...options, headersTimeout: CONNECT_TIMEOUT_MS }),
    });
    dispatcher = cachedAgent;
  }
  return undiciFetch(url, { ...init, dispatcher } as never) as unknown as Promise<Response>;
}

/** 进程退出/代理变更时释放连接池。 */
export function closeProxyAgent(): void {
  void cachedAgent?.close().catch(() => undefined);
  cachedAgent = null;
  cachedUrl = undefined;
  cachedAgentUrl = null;
  cacheExpiresAt = 0;
  cachedEnvironment = '';
}
