import { Hono } from "hono";
import type { MiddlewareHandler, Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { env } from "./env";
import { encrypt, decrypt, generatePkce } from "./lib/crypto";
import {
  authorizeUrl,
  exchangeCode,
  refreshAccessToken,
  revokeToken,
  fetchUserInfo,
} from "./lib/gateway";
import {
  admin,
  upsertUser,
  createSession,
  loadSession,
  updateSessionTokens,
  deleteSession,
} from "./lib/supabase";
import { unauthorized, supabaseError } from "./lib/errors";
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
function issueSessionCookie(c: Context<AppEnv>, sessionId: string, expiresAt: number): void {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  setCookie(c, env.COOKIE_NAME, sessionId, cookieOptions(maxAge));
}

// 无状态 PKCE：verifier 与目标跳转地址一并 AES-GCM 加密进 state，回调时还原。
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const sessionId = getCookie(c, env.COOKIE_NAME);
  if (!sessionId) throw unauthorized();

  let session = await loadSession(sessionId);
  if (!session) throw unauthorized();

  // 临近过期（<60s）时用 refresh_token 轮换；失败即清除会话。
  if (session.expiresAt - Date.now() < 60_000) {
    if (!session.refreshToken) throw unauthorized();
    try {
      const tokens = await refreshAccessToken(session.refreshToken);
      const expiresAt = Date.now() + (tokens.expires_in ?? 3600) * 1000;
      await updateSessionTokens(sessionId, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? session.refreshToken,
        tokenType: tokens.token_type,
        expiresAt,
      });
      session = { ...session, accessToken: tokens.access_token, expiresAt };
    } catch {
      await deleteSession(sessionId);
      throw unauthorized();
    }
  }

  c.set("userId", session.userId);
  c.set("accessToken", session.accessToken);
  c.set("sessionId", session.sessionId);
  await next();
};

export const authApp = new Hono<AppEnv>();

// 登录入口：浏览器直接 `location.assign('/api/auth/login')`。
authApp.get("/login", (c) => {
  const redirect = sanitizeRedirect(c.req.query("redirect"));
  const { verifier, challenge } = generatePkce();
  const state = encrypt(JSON.stringify({ verifier, redirect }));
  return c.redirect(authorizeUrl(state, challenge), 302);
});

// OAuth 回调：校验 state、换 token、取 userinfo、建立会话。
authApp.get("/callback", async (c) => {
  const error = c.req.query("error");
  if (error) {
    return c.redirect(`${env.FRONTEND_URL}/?auth=error&reason=${encodeURIComponent(error)}`, 302);
  }

  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) {
    return c.redirect(`${env.FRONTEND_URL}/?auth=error&reason=missing_params`, 302);
  }

  let payload: { verifier?: string; redirect?: string };
  try {
    payload = JSON.parse(decrypt(state)) as { verifier?: string; redirect?: string };
  } catch {
    return c.redirect(`${env.FRONTEND_URL}/?auth=error&reason=invalid_state`, 302);
  }
  if (!payload.verifier) {
    return c.redirect(`${env.FRONTEND_URL}/?auth=error&reason=invalid_state`, 302);
  }

  const redirect = sanitizeRedirect(payload.redirect);
  try {
    const tokens = await exchangeCode(code, payload.verifier);
    const user = await fetchUserInfo(tokens.access_token);
    const userRow = await upsertUser(user.sub, { username: user.username, email: user.email });
    const expiresAt = Date.now() + (tokens.expires_in ?? 3600) * 1000;
    const sessionId = await createSession(userRow.id, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenType: tokens.token_type,
      expiresAt,
    });
    issueSessionCookie(c, sessionId, expiresAt);
    return c.redirect(redirect, 302);
  } catch (e) {
    const reason = e instanceof Error ? e.message : "unknown";
    return c.redirect(`${env.FRONTEND_URL}/?auth=error&reason=${encodeURIComponent(reason)}`, 302);
  }
});

authApp.get("/me", requireAuth, async (c) => {
  const userId = c.get("userId");
  const { data, error } = await admin.from("users").select("*").eq("id", userId).single();
  if (error) throw supabaseError(error.message);
  return c.json(envelope({ id: data.id, sub: data.sub, username: data.username, email: data.email }));
});

authApp.post("/logout", async (c) => {
  const sessionId = getCookie(c, env.COOKIE_NAME);
  if (sessionId) {
    const session = await loadSession(sessionId);
    if (session?.refreshToken) await revokeToken(session.refreshToken);
    await deleteSession(sessionId);
  }
  deleteCookie(c, env.COOKIE_NAME, { path: "/" });
  return c.json(envelope(null, "已登出"));
});
