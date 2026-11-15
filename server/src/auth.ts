import { Hono } from "hono";
import type { Provider } from '@supabase/supabase-js';
import { z } from 'zod';
import type { MiddlewareHandler, Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { env } from "./env";
import { encrypt, decrypt } from "./lib/crypto";
import { authClient, gatewaySubject } from './lib/authClient';
import {
  refreshAccessToken,
  revokeToken,
  fetchUserInfo,
  createTopup,
  fetchTopupOptions,
  fetchUsageLogs,
} from "./lib/gateway";
import {
  admin,
  upsertUser,
  createSession,
  loadSession,
  updateSessionTokens,
  deleteSession,
} from "./lib/supabase";
import { HttpError, unauthorized, supabaseError, badRequest } from "./lib/errors";
import { envelope } from "./lib/respond";
import type { AppEnv } from "./lib/types";

// 会话 Cookie 名与站点前缀统一从环境读取。
function cookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    sameSite: "Lax" as const,
    secure: env.NODE_ENV === "production",
    path: "/",
    ...(maxAge !== undefined ? { maxAge } : {}),
  };
}

// 防开放重定向：仅允许与 FRONTEND_URL 同源的绝对地址或相对路径。
function sanitizeRedirect(redirect: string | undefined): string {
  const frontendOrigin = new URL(env.FRONTEND_URL).origin;
  if (!redirect) return env.FRONTEND_URL;
  try {
    const url = new URL(redirect, env.FRONTEND_URL);
    return url.origin === frontendOrigin ? url.toString() : env.FRONTEND_URL;
  } catch {
    return env.FRONTEND_URL;
  }
}

// 登录后把 new-api token 写入 HttpOnly 会话 Cookie。
function issueSessionCookie(c: Context<AppEnv>, sessionId: string): void {
  setCookie(c, env.COOKIE_NAME, sessionId, cookieOptions(30 * 86400));
}

// Refresh rotation must be shared by concurrent requests in this server process.
const refreshes = new Map<string, Promise<string>>();
export function refreshSession(sessionId: string): Promise<string> {
  const pending = refreshes.get(sessionId);
  if (pending) return pending;
  const refresh = (async () => {
    const session = await loadSession(sessionId);
    if (!session?.refreshToken) throw unauthorized();
    const tokens = await refreshAccessToken(session.refreshToken);
    await updateSessionTokens(sessionId, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? session.refreshToken,
      tokenType: tokens.token_type,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    });
    return tokens.access_token;
  })().finally(() => refreshes.delete(sessionId));
  refreshes.set(sessionId, refresh);
  return refresh;
}

// Native Harness receives this opaque session only through the private IPC pipe.
export function nativeRelaySession(c: Context<AppEnv>): string | undefined {
  if (c.req.header('origin') || !c.req.path.startsWith('/api/relay/')) return;
  return c.req.header('authorization')?.match(/^Bearer ([0-9a-f-]{36})$/i)?.[1];
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const sessionId = getCookie(c, env.COOKIE_NAME) || nativeRelaySession(c);
  if (!sessionId) throw unauthorized();

  const session = await loadSession(sessionId);
  if (!session) throw unauthorized();
  const expectedUser = c.req.header('x-shotloom-user');
  if (expectedUser && expectedUser !== session.userId) {
    throw new HttpError(409, 'ACCOUNT_CHANGED', '账号已切换，请重新登录原账号后继续保存');
  }

  let accessToken = session.accessToken;
  if (session.expiresAt - Date.now() < 60_000) {
    if (!session.refreshToken) throw unauthorized();
    try {
      accessToken = await refreshSession(sessionId);
    } catch (error) {
      if (error instanceof HttpError && error.code === 'INVALID_GRANT') {
        await deleteSession(sessionId);
        deleteCookie(c, env.COOKIE_NAME, { path: '/' });
        throw unauthorized();
      }
      throw error;
    }
  }

  c.set("userId", session.userId);
  c.set("accessToken", accessToken);
  c.set("sessionId", session.sessionId);
  await next();
};

export const authApp = new Hono<AppEnv>();

// Supabase owns OAuth state, PKCE, identity verification and Auth cookies.
authApp.get("/login", async c => {
  const redirect = sanitizeRedirect(c.req.query('redirect'));
  const client = authClient(c);
  const { data, error } = await client.auth.signInWithOAuth({
    provider: env.SUPABASE_AUTH_PROVIDER as Provider,
    options: { redirectTo: new URL('/api/auth/callback', env.FRONTEND_URL).toString(), skipBrowserRedirect: true },
  });
  if (error || !data.url) throw new HttpError(502, 'AUTH_UNAVAILABLE', '登录服务暂不可用');
  setCookie(c, 'shotloom_oauth', encrypt(JSON.stringify({ redirect, createdAt: Date.now() })), cookieOptions(600));
  return c.redirect(data.url, 302);
});

authApp.get('/callback', async c => {
  const flow = getCookie(c, 'shotloom_oauth');
  deleteCookie(c, 'shotloom_oauth', { path: '/' });
  const failed = (reason: string) => c.redirect(`${env.FRONTEND_URL}/?auth=error&reason=${reason}`, 302);
  const code = c.req.query('code');
  if (!code || !flow || c.req.query('error')) return failed('invalid_state');
  let redirect: string;
  try {
    const payload = JSON.parse(decrypt(flow));
    if (!Number.isFinite(payload.createdAt) || Date.now() - payload.createdAt > 600_000 || payload.createdAt > Date.now()) return failed('invalid_state');
    redirect = sanitizeRedirect(payload.redirect);
  } catch { return failed('invalid_state'); }
  const client = authClient(c);
  try {
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (error || !data.session?.provider_token) throw unauthorized();
    const verified = await client.auth.getUser();
    if (verified.error || !verified.data.user) throw unauthorized();
    const subject = gatewaySubject(verified.data.user, env.SUPABASE_AUTH_PROVIDER, env.GATEWAY_CLIENT_ID);
    const user = await fetchUserInfo(data.session.provider_token);
    if (user.sub !== subject) throw unauthorized();
    // Preserve existing project ownership and App quota when adding Supabase Auth.
    const userRow = await upsertUser(subject, { username: user.username, email: user.email });
    const sessionId = await createSession(userRow.id, {
      accessToken: data.session.provider_token,
      refreshToken: data.session.provider_refresh_token ?? undefined,
      tokenType: 'Bearer',
      expiresAt: Date.now() + 3600_000,
    });
    issueSessionCookie(c, sessionId);
    return c.redirect(redirect, 302);
  } catch {
    await client.auth.signOut({ scope: 'local' });
    return failed('login_failed');
  }
});

authApp.get("/me", requireAuth, async (c) => {
  const userId = c.get("userId");
  const { data, error } = await admin.from("users").select("*").eq("id", userId).single();
  if (error) throw supabaseError(error.message);
  return c.json(envelope({ id: data.id, sub: data.sub, username: data.username, email: data.email }));
});

authApp.get('/account', requireAuth, async c => c.json(envelope(await fetchUserInfo(c.get('accessToken')))));

authApp.get('/usage', requireAuth, async c => {
  const query = z.object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(10),
  }).strict().safeParse(c.req.query());
  if (!query.success) throw badRequest('消费记录分页参数无效');
  return c.json(envelope(await fetchUsageLogs(c.get('accessToken'), query.data.page, query.data.page_size)));
});

authApp.get('/topup/options', requireAuth, async c => c.json(envelope(await fetchTopupOptions())));

authApp.post('/topup', requireAuth, async c => {
  const body = z.object({ amount: z.number().int().min(1).max(1_000_000) }).strict().safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw badRequest('充值金额必须是 1 到 1000000 之间的整数');
  return c.json(envelope({ checkoutUrl: await createTopup(c.get('accessToken'), body.data.amount) }));
});

authApp.post("/logout", async (c) => {
  const sessionId = getCookie(c, env.COOKIE_NAME);
  if (sessionId) {
    (await import('./agent')).closeAgentSession(sessionId);
    const session = await loadSession(sessionId);
    if (session?.refreshToken) await revokeToken(session.refreshToken);
    await deleteSession(sessionId);
  }
  const { error } = await authClient(c).auth.signOut({ scope: 'local' });
  deleteCookie(c, env.COOKIE_NAME, { path: "/" });
  if (error) throw new HttpError(502, 'LOGOUT_FAILED', '退出登录未完成，请重试');
  return c.json(envelope(null, "已登出"));
});
