import { createClient } from "@supabase/supabase-js";
import { env } from "../env";
import { encrypt, decrypt } from "./crypto";
import { supabaseError } from "./errors";
import type { Database, UserRow, SessionRow } from "./database";

// service_role 客户端：BFF 是唯一持有该密钥的服务，绕过 RLS，自行强制租户隔离。
// db.schema 指向独立 shotloom schema，.from() 默认落到 shotloom.*。
export const admin = createClient<Database, "shotloom">(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "shotloom" },
  },
);

export type { UserRow, SessionRow };

export interface DecryptedSession {
  sessionId: string;
  userId: string;
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
  const existing = await admin.from("users").select("*").eq("sub", sub).maybeSingle();
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

export async function loadSession(sessionId: string): Promise<DecryptedSession | null> {
  const { data, error } = await admin.from("sessions").select("*").eq("id", sessionId).maybeSingle();
  if (error) throw supabaseError(error.message);
  if (!data) return null;
  return {
    sessionId: data.id,
    userId: data.user_id,
    accessToken: decrypt(data.access_token_cipher),
    refreshToken: data.refresh_token_cipher ? decrypt(data.refresh_token_cipher) : null,
    expiresAt: new Date(data.expires_at).getTime(),
  };
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
  if (error) throw supabaseError(error.message);
}

export async function deleteSession(sessionId: string): Promise<void> {
  const { error } = await admin.from("sessions").delete().eq("id", sessionId);
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

// 租户前缀：所有对象键强制以 u_<userId>/ 开头，杜绝跨用户访问。
export function scopedKey(userId: string, key: string): string {
  const normalized = key.replace(/^\/+/, "");
  return `u_${userId}/${normalized}`;
}

export async function uploadFile(
  bucket: string,
  key: string,
  file: Blob,
  contentType: string,
): Promise<string> {
  const { error } = await admin.storage
    .from(bucket)
    .upload(key, file, { contentType, upsert: true });
  if (error) throw supabaseError(error.message);
  return key;
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
