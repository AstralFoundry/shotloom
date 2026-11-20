import { env } from "../env";
import { HttpError } from "./errors";
import { z } from 'zod';
import { requestSignal, timed } from './requestMetrics';

function upstreamFetch(input: string | URL, init: RequestInit = {}) {
  const parent = init.signal || requestSignal();
  const timeout = AbortSignal.timeout(15000);
  return timed('upstream', () => fetch(input, { ...init, signal: parent ? AbortSignal.any([parent, timeout]) : timeout }));
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

export interface GatewayUser {
  sub: string;
  username?: string;
  email?: string;
  app_quota?: number;
  app_used_quota?: number;
}

/** 生成 new-api 授权地址（Authorization Code + PKCE S256）。 */
export function authorizeUrl(state: string, codeChallenge: string, nonce: string): string {
  const url = new URL("/oauth/authorize", env.GATEWAY_BASE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.GATEWAY_CLIENT_ID);
  url.searchParams.set("redirect_uri", env.GATEWAY_REDIRECT_URI);
  url.searchParams.set("scope", "openid profile email api:read api:write");
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function gatewayFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/x-www-form-urlencoded");
  }
  return upstreamFetch(new URL(path, env.GATEWAY_BASE_URL), { ...init, headers });
}

function parseToken(body: string): TokenResponse {
  const data = JSON.parse(body) as Partial<TokenResponse>;
  if (typeof data.access_token !== "string") {
    throw new HttpError(502, "GATEWAY_TOKEN_ERROR", "new-api 未返回 access_token");
  }
  return {
    access_token: data.access_token,
    token_type: data.token_type ?? "Bearer",
    expires_in: typeof data.expires_in === "number" ? data.expires_in : undefined,
    refresh_token: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
    scope: typeof data.scope === "string" ? data.scope : undefined,
  };
}

export async function exchangeCode(code: string, codeVerifier: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: env.GATEWAY_REDIRECT_URI,
    client_id: env.GATEWAY_CLIENT_ID,
    client_secret: env.GATEWAY_CLIENT_SECRET,
    code_verifier: codeVerifier,
  });
  const res = await gatewayFetch("/oauth/token", { method: "POST", body });
  const text = await res.text();
  if (!res.ok) {
    throw new HttpError(502, "GATEWAY_TOKEN_ERROR", `new-api token 交换失败：${res.status}`);
  }
  return parseToken(text);
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: env.GATEWAY_CLIENT_ID,
    client_secret: env.GATEWAY_CLIENT_SECRET,
  });
  const res = await gatewayFetch("/oauth/token", { method: "POST", body });
  const text = await res.text();
  if (!res.ok) {
    let code = '';
    try { code = String((JSON.parse(text) as { error?: string }).error || ''); } catch { /* non-JSON gateway failure */ }
    throw new HttpError(code === 'invalid_grant' ? 401 : 502, code === 'invalid_grant' ? 'INVALID_GRANT' : 'GATEWAY_REFRESH_ERROR', `new-api 刷新失败：${res.status}`);
  }
  return parseToken(text);
}

/** best-effort 撤销；失败不影响登出。 */
export async function revokeToken(token: string): Promise<void> {
  try {
    await gatewayFetch("/oauth/revoke", {
      method: "POST",
      body: new URLSearchParams({ token, client_id: env.GATEWAY_CLIENT_ID, client_secret: env.GATEWAY_CLIENT_SECRET }),
    });
  } catch {
    // ignore
  }
}

export async function fetchUserInfo(accessToken: string): Promise<GatewayUser> {
  const res = await upstreamFetch(new URL("/oauth/userinfo", env.GATEWAY_BASE_URL), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new HttpError(502, "GATEWAY_USERINFO_ERROR", `new-api userinfo 失败：${res.status}`);
  }
  const data = JSON.parse(text) as Record<string, unknown>;
  const sub = typeof data.sub === "string" ? data.sub : typeof data.sub === "number" ? String(data.sub) : "";
  if (!sub) {
    throw new HttpError(401, "GATEWAY_SUB_MISSING", "new-api 未返回 sub");
  }
  return {
    sub,
    username: typeof data.username === "string" ? data.username : undefined,
    email: typeof data.email === "string" ? data.email : undefined,
    app_quota: typeof data.app_quota === 'number' ? data.app_quota : 0,
    app_used_quota: typeof data.app_used_quota === 'number' ? data.app_used_quota : 0,
  };
}

export async function fetchTopupOptions() {
  const response = await gatewayFetch('/api/status');
  const result = z.object({ success: z.literal(true), data: z.object({
    quota_per_unit: z.number().positive().finite(),
    quota_display_type: z.enum(['USD', 'CNY', 'CUSTOM', 'TOKENS']),
  }) }).safeParse(await response.json().catch(() => null));
  if (!response.ok || !result.success) throw new HttpError(502, 'TOPUP_OPTIONS_FAILED', '充值比例暂不可用，请重试');
  return { quotaPerAmount: result.data.data.quota_display_type === 'TOKENS' ? 1 : result.data.data.quota_per_unit };
}

export async function createTopup(accessToken: string, amount: number): Promise<string> {
  const response = await fetch(new URL('/oauth/topup/checkout', env.GATEWAY_BASE_URL), {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, payment_method: 'waffo_pancake' }),
  });
  const result = await response.json() as { checkout_url?: string; error_description?: string };
  if (!response.ok || !result.checkout_url) throw new HttpError(502, 'CHECKOUT_FAILED', '充值通道暂不可用，请稍后重试');
  const target = new URL(result.checkout_url);
  if (target.protocol !== 'https:' || target.username || target.password) throw new HttpError(502, 'CHECKOUT_FAILED', '充值地址无效');
  return target.toString();
}

const usagePage = z.object({
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  page_size: z.number().int().positive().max(100),
  items: z.array(z.object({
    id: z.number().int(),
    created_at: z.number().int().nonnegative(),
    model_name: z.string(),
    quota: z.number().int(),
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
  })).max(100),
});

export async function fetchUsageLogs(accessToken: string, page: number, pageSize: number) {
  const url = new URL('/oauth/logs', env.GATEWAY_BASE_URL);
  url.searchParams.set('page', String(page));
  url.searchParams.set('page_size', String(pageSize));
  const response = await upstreamFetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new HttpError(502, 'GATEWAY_USAGE_ERROR', '消费记录暂不可用，请稍后重试');
  const result = usagePage.safeParse(await response.json().catch(() => null));
  if (!result.success) throw new HttpError(502, 'GATEWAY_USAGE_ERROR', '消费记录格式异常，请稍后重试');
  return result.data;
}
