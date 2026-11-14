import { env } from "../env";
import { HttpError } from "./errors";

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
}

/** 生成 new-api 授权地址（Authorization Code + PKCE S256）。 */
export function authorizeUrl(state: string, codeChallenge: string): string {
  const url = new URL("/oauth/authorize", env.GATEWAY_BASE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.GATEWAY_CLIENT_ID);
  url.searchParams.set("redirect_uri", env.GATEWAY_REDIRECT_URI);
  url.searchParams.set("scope", "openid profile email");
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
  return fetch(new URL(path, env.GATEWAY_BASE_URL).toString(), { ...init, headers });
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
    code_verifier: codeVerifier,
  });
  const res = await gatewayFetch("/oauth/token", { method: "POST", body });
  const text = await res.text();
  if (!res.ok) {
    throw new HttpError(502, "GATEWAY_TOKEN_ERROR", `new-api token 交换失败：${res.status} ${text}`);
  }
  return parseToken(text);
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: env.GATEWAY_CLIENT_ID,
  });
  const res = await gatewayFetch("/oauth/token", { method: "POST", body });
  const text = await res.text();
  if (!res.ok) {
    throw new HttpError(401, "GATEWAY_REFRESH_ERROR", `new-api 刷新失败：${res.status} ${text}`);
  }
  return parseToken(text);
}

/** best-effort 撤销；失败不影响登出。 */
export async function revokeToken(token: string): Promise<void> {
  try {
    await gatewayFetch("/oauth/revoke", {
      method: "POST",
      body: new URLSearchParams({ token, client_id: env.GATEWAY_CLIENT_ID }),
    });
  } catch {
    // ignore
  }
}

export async function fetchUserInfo(accessToken: string): Promise<GatewayUser> {
  const res = await fetch(new URL("/oauth/userinfo", env.GATEWAY_BASE_URL).toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new HttpError(502, "GATEWAY_USERINFO_ERROR", `new-api userinfo 失败：${res.status} ${text}`);
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
  };
}
