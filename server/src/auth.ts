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
  upsertUser,
  createSession,
  loadSession,
  updateSessionTokens,
  deleteSession,
  type DecryptedSession,
} from "./lib/supabase";
import { HttpError, unauthorized, badRequest } from "./lib/errors";
import { envelope } from "./lib/respond";
import type { AppEnv } from "./lib/types";
import { nativeCallback, nativeSession, issueNativeTicket, consumeNativeTicket, issueNativeToken } from './lib/nativeAuth';
import { workspacePreloadFiles, workspacePreloadHtml } from './lib/workspacePreload';

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
export function refreshSession(sessionId: string, authenticatedSession?: DecryptedSession): Promise<string> {
  const pending = refreshes.get(sessionId);
  if (pending) return pending;
  const refresh = (async () => {
    const session = authenticatedSession ?? await loadSession(sessionId);
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
  const sessionId = nativeSession(c) || getCookie(c, env.COOKIE_NAME) || nativeRelaySession(c);
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
      accessToken = await refreshSession(sessionId, session);
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
  c.set('user', session.user);
  c.set("accessToken", accessToken);
  c.set("sessionId", session.sessionId);
  await next();
};

export const authApp = new Hono<AppEnv>();

// Supabase owns OAuth state, PKCE, identity verification and Auth cookies.
authApp.get("/login", async c => {
  const redirect = sanitizeRedirect(c.req.query('redirect'));
  const native = c.req.query('native_challenge') !== undefined || c.req.query('native_state') !== undefined
    ? z.object({ challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/), state: z.string().uuid() }).safeParse({ challenge: c.req.query('native_challenge'), state: c.req.query('native_state') }) : undefined;
  if (native && !native.success) throw badRequest('原生登录参数无效');
  const client = authClient(c);
  const { data, error } = await client.auth.signInWithOAuth({
    provider: env.SUPABASE_AUTH_PROVIDER as Provider,
    options: { redirectTo: new URL('/api/auth/callback', env.FRONTEND_URL).toString(), skipBrowserRedirect: true },
  });
  if (error || !data.url) throw new HttpError(502, 'AUTH_UNAVAILABLE', '登录服务暂不可用');
  setCookie(c, 'shotloom_oauth', encrypt(JSON.stringify({ redirect, createdAt: Date.now(), ...(native?.success ? { native: native.data } : {}) })), cookieOptions(600));
  return c.redirect(data.url, 302);
});

authApp.get('/callback', async c => {
  const flow = getCookie(c, 'shotloom_oauth');
  deleteCookie(c, 'shotloom_oauth', { path: '/' });
  let native: { challenge: string; state: string } | undefined;
  const failed = (reason: string) => c.redirect(native ? `${nativeCallback}?state=${native.state}&error=${reason}` : `${env.FRONTEND_URL}/?auth=error&reason=${reason}`, 302);
  const code = c.req.query('code');
  if (!flow) return failed('invalid_state');
  let redirect: string;
  try {
    const payload = JSON.parse(decrypt(flow));
    if (!Number.isFinite(payload.createdAt) || Date.now() - payload.createdAt > 600_000 || payload.createdAt > Date.now()) return failed('invalid_state');
    redirect = sanitizeRedirect(payload.redirect);
    if (payload.native) {
      native = z.object({ challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/), state: z.string().uuid() }).parse(payload.native);
    }
  } catch { return failed('invalid_state'); }
  if (!code || c.req.query('error')) return failed('invalid_state');
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
    if (native) {
      const ticket = issueNativeTicket({ kind: 'login', sessionId, challenge: native.challenge });
      c.header('Referrer-Policy', 'no-referrer');
      return c.redirect(`${nativeCallback}?code=${ticket}&state=${native.state}`, 302);
    }
    issueSessionCookie(c, sessionId);
    return c.redirect(redirect, 302);
  } catch {
    await client.auth.signOut({ scope: 'local' });
    return failed('login_failed');
  }
});

authApp.post('/native/exchange', async c => {
  const body = z.object({ code: z.string().regex(/^[A-Za-z0-9_-]{43}$/), verifier: z.string().min(43).max(128) }).strict().safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw badRequest('登录凭据无效');
  const ticket = consumeNativeTicket(body.data.code, 'login', body.data.verifier);
  const session = await loadSession(ticket.sessionId);
  if (!session) throw unauthorized();
  return c.json(envelope({ token: issueNativeToken(ticket.sessionId), userId: session.userId }));
});

authApp.post('/native/workspace-ticket', requireAuth, async c => {
  const body = z.object({ redirect: z.string().max(2048) }).strict().safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw badRequest('工作区地址无效');
  let target: URL;
  try { target = new URL(body.data.redirect, env.FRONTEND_URL); }
  catch { throw badRequest('工作区地址无效'); }
  if (target.origin !== new URL(env.FRONTEND_URL).origin || target.pathname !== '/' || target.hash) throw badRequest('工作区地址无效');
  const code = issueNativeTicket({ kind: 'workspace', sessionId: c.get('sessionId'), redirect: target.toString() });
  return c.json(envelope({ code }));
});

authApp.post('/native/workspace', async c => {
  const body = await c.req.parseBody();
  if (typeof body.code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.code)) throw badRequest('工作区凭据无效');
  const ticket = consumeNativeTicket(body.code, 'workspace');
  if (ticket.kind !== 'workspace') throw unauthorized();
  const session = await loadSession(ticket.sessionId);
  if (!session) throw unauthorized();
  issueSessionCookie(c, ticket.sessionId);
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Cache-Control', 'no-store');
  if (new URL(ticket.redirect).searchParams.get('native') === 'prewarm') {
    return c.html(workspacePreloadHtml(session.userId, await workspacePreloadFiles()));
  }
  return c.redirect(ticket.redirect, 303);
});

authApp.get("/me", requireAuth, async (c) => {
  return c.json(envelope(c.get('user')));
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
  const nativeId = nativeSession(c);
  const sessionId = nativeId || getCookie(c, env.COOKIE_NAME);
  if (sessionId) {
    (await import('./agent')).closeAgentSession(sessionId);
    const session = await loadSession(sessionId);
    if (session?.refreshToken) await revokeToken(session.refreshToken);
    await deleteSession(sessionId);
  }
  const { error } = nativeId ? { error: null } : await authClient(c).auth.signOut({ scope: 'local' });
  deleteCookie(c, env.COOKIE_NAME, { path: "/" });
  if (error) throw new HttpError(502, 'LOGOUT_FAILED', '退出登录未完成，请重试');
  return c.json(envelope(null, "已登出"));
});
