// jsonb 载荷的统一类型。payload 是唯一事实来源，其余字段仅冗余 id/position。
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

// Hono 上下文变量（requireAuth 中间件注入）。
export type AppEnv = {
  Variables: {
    userId: string;
    accessToken: string;
    sessionId: string;
  };
};
