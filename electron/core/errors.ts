/**
 * 与 src-tauri/src/localized_error.rs 同一份错误信封。跨 IPC 的失败一律用它表达，
 * 渲染进程只翻译这个结构，不猜测上游文案。
 */
export function localizedError(key: string, params: Record<string, unknown>, fallback: string): string {
  return JSON.stringify({ type: 'shotloom:localized-error', key, params, fallback });
}

export function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(error);
}
