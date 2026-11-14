import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../env";

const ALGO = "aes-256-gcm";

function key(): Buffer {
  return Buffer.from(env.SESSION_ENCRYPTION_KEY, "hex");
}

/**
 * AES-256-GCM 加密，输出 `iv.tag.ciphertext` 三段 base64url，用 `.` 连接。
 * 用于无状态 PKCE state 与落库的 new-api token。
 */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(payload: string): string {
  const [ivPart, tagPart, cipherPart] = payload.split(".");
  if (!ivPart || !tagPart || !cipherPart) {
    throw new Error("加密字段格式无效");
  }
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(cipherPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

// RFC 7636 PKCE（S256）
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
