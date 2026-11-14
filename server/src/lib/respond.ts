import type { Json } from "./types";

// 统一响应 envelope（对齐 new-api `{ success, message, data }`）。
export function envelope(data: Json | null, message = "ok"): {
  success: boolean;
  message: string;
  data: Json | null;
} {
  return { success: true, message, data };
}
