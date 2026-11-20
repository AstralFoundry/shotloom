import { createClient } from "@supabase/supabase-js";
import { timed, requestSignal, sharedRead } from './requestMetrics';
import { env } from "../env";
import { encrypt, decrypt } from "./crypto";
import { badRequest, supabaseError } from "./errors";
import type { Database, UserRow, SessionRow } from "./database";

// service_role 客户端：BFF 是唯一持有该密钥的服务，绕过 RLS，自行强制租户隔离。
// db.schema 指向独立 shotloom schema，.from() 默认落到 shotloom.*。
export const admin = createClient<Database, "shotloom">(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    global: { fetch: (input, init) => {
      const budget = requestSignal();
      return timed('db', () => fetch(input, { ...init, ...(budget ? { signal: init?.signal ? AbortSignal.any([budget, init.signal]) : budget } : {}) }));
    } },
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "shotloom" },
  },
);

export type { UserRow, SessionRow };

export interface DecryptedSession {
  sessionId: string;
  userId: string;
  user: Pick<UserRow, 'id' | 'sub' | 'username' | 'email'>;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// 用户
// ---------------------------------------------------------------------------
export async function upsertUser(
  sub: string,
  info: { username?: string; email?: string },
): Promise<UserRow> {
  const existing = await admin.from("users").select("*").eq("client_id", env.GATEWAY_CLIENT_ID).eq("sub", sub).maybeSingle();
  if (existing.error) throw supabaseError(existing.error.message);

  if (existing.data) {
    const user = existing.data;
    if (user.username !== (info.username ?? null) || user.email !== (info.email ?? null)) {
      const { data, error } = await admin
        .from("users")
        .update({ username: info.username ?? null, email: info.email ?? null })
        .eq("id", user.id)
        .select()
        .single();
      if (error) throw supabaseError(error.message);
      return data;
    }
    return user;
  }

  const { data, error } = await admin
    .from("users")
    .insert({
      client_id: env.GATEWAY_CLIENT_ID,
      sub,
      username: info.username ?? null,
      email: info.email ?? null,
    })
    .select()
    .single();
  if (error) throw supabaseError(error.message);
  return data;
}

// ---------------------------------------------------------------------------
// 会话（token 加密落库，仅 service_role 可读）
// ---------------------------------------------------------------------------
export async function createSession(
  userId: string,
  tokens: { accessToken: string; refreshToken?: string; tokenType: string; expiresAt: number },
): Promise<string> {
  const { data, error } = await admin
    .from("sessions")
    .insert({
      user_id: userId,
      access_token_cipher: encrypt(tokens.accessToken),
      refresh_token_cipher: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
      token_type: tokens.tokenType,
      expires_at: new Date(tokens.expiresAt).toISOString(),
    })
    .select("id")
    .single();
  if (error) throw supabaseError(error.message);
  return data.id;
}

// Share overlapping reads only; the next request must still observe revocation.
const sessionReads = new Map<string, Promise<DecryptedSession | null>>();
export async function loadSession(sessionId: string): Promise<DecryptedSession | null> {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
  const pending = sessionReads.get(sessionId);
  if (pending) return pending;
  const read: Promise<DecryptedSession | null> = sharedRead(() => Promise.resolve(admin.from("sessions")
    .select('*,owner:users!inner(id,sub,username,email)')
    .eq('id', sessionId).eq('owner.client_id', env.GATEWAY_CLIENT_ID).maybeSingle())).then(({ data, error }) => {
    if (sessionReads.get(sessionId) !== read) return loadSession(sessionId);
    if (error) throw supabaseError(error.message);
    if (!data) return null;
    if (!data.owner || Date.now() - Date.parse(data.created_at) >= 30 * 86400_000) return null;
    return {
      sessionId: data.id,
      userId: data.user_id,
      user: data.owner,
      accessToken: decrypt(data.access_token_cipher),
      refreshToken: data.refresh_token_cipher ? decrypt(data.refresh_token_cipher) : null,
      expiresAt: new Date(data.expires_at).getTime(),
    };
  }).finally(() => { if (sessionReads.get(sessionId) === read) sessionReads.delete(sessionId); });
  sessionReads.set(sessionId, read);
  return read;
}

export async function updateSessionTokens(
  sessionId: string,
  tokens: { accessToken: string; refreshToken?: string; tokenType: string; expiresAt: number },
): Promise<void> {
  const { error } = await admin
    .from("sessions")
    .update({
      access_token_cipher: encrypt(tokens.accessToken),
      refresh_token_cipher: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
      token_type: tokens.tokenType,
      expires_at: new Date(tokens.expiresAt).toISOString(),
    })
    .eq("id", sessionId);
  sessionReads.delete(sessionId);
  if (error) throw supabaseError(error.message);
}

export async function deleteSession(sessionId: string): Promise<void> {
  const { error } = await admin.from("sessions").delete().eq("id", sessionId);
  sessionReads.delete(sessionId);
  if (error) throw supabaseError(error.message);
}

// ---------------------------------------------------------------------------
// 对象存储
// ---------------------------------------------------------------------------
export const STORAGE_BUCKETS = {
  media: "shotloom-media",
  assets: "shotloom-assets",
} as const;

export type StorageBucket = keyof typeof STORAGE_BUCKETS;

export function resolveBucket(bucket: string): string {
  const resolved = STORAGE_BUCKETS[bucket as StorageBucket];
  if (!resolved) throw supabaseError(`未知存储桶：${bucket}`);
  return resolved;
}

// 租户前缀：所有对象键强制以 <clientId>/<userId>/ 开头，杜绝跨用户访问。
export function scopedKey(userId: string, key: string): string {
  if (!key || key.length > 512 || key.split('/').some(part => !part || part === '.' || part === '..')
    || /[\\\x00-\x1f?#%]/.test(key)) throw badRequest("对象路径无效");
  return `${env.GATEWAY_CLIENT_ID}/${userId}/${key}`;
}

export async function createSignedUrl(bucket: string, key: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(key, expiresIn);
  if (error) throw supabaseError(error.message);
  return data.signedUrl;
}

// 客户端直传 Storage 的上传签名 URL（避免大文件经 BFF 中转）。
export async function createSignedUploadUrl(bucket: string, key: string): Promise<string> {
  const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(key);
  if (error) throw supabaseError(error.message);
  return data.signedUrl;
}
