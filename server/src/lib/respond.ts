// 统一响应 envelope（对齐 new-api `{ success, message, data }`）。
export function envelope<T>(data: T, message = "ok"): {
  success: boolean;
  message: string;
  data: T;
} {
  return { success: true, message, data };
}
