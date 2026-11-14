import { z } from "zod";

// 加载 server/.env（若存在），生产环境依赖已注入的环境变量。
try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {
  // 无 .env 文件时忽略（生产部署由平台注入）
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  GATEWAY_BASE_URL: z.string().url(),
  GATEWAY_CLIENT_ID: z.string().min(1),
  GATEWAY_REDIRECT_URI: z.string().url(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SESSION_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "必须是 64 位 hex（32 字节）"),
  FRONTEND_URL: z.string().url(),
  COOKIE_NAME: z.string().min(1).default("shotloom_session"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // 应用启动即失败，避免带着残缺配置运行。
  console.error("环境变量校验失败：\n" + parsed.error.message);
  throw new Error("环境变量校验失败，请检查 server/.env");
}

export const env = parsed.data;
