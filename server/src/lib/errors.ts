export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function badRequest(message: string): HttpError {
  return new HttpError(400, "BAD_REQUEST", message);
}

export function unauthorized(message = "登录已失效，请重新登录"): HttpError {
  return new HttpError(401, "UNAUTHORIZED", message);
}

export function notFound(message = "资源不存在"): HttpError {
  return new HttpError(404, "NOT_FOUND", message);
}

export function conflict(message: string): HttpError {
  return new HttpError(409, "CONFLICT", message);
}

export function supabaseError(message: string): HttpError {
  return new HttpError(500, "SUPABASE_ERROR", message);
}
