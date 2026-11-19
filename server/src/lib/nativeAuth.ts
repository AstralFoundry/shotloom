import { createHash, randomBytes } from 'node:crypto';
import type { Context } from 'hono';
import { nativeRequestAllowed } from '../../../shared/nativeBridge';
import { encrypt, decrypt } from './crypto';
import { HttpError, unauthorized } from './errors';

export const nativeCallback = 'shotloom-preview://auth/callback';
type Ticket = { sessionId: string; expires: number } & ({ kind: 'login'; challenge: string } | { kind: 'workspace'; redirect: string });
// shortcut: handoffs live in this server process; use shared atomic storage before running multiple API workers.
const tickets = new Map<string, Ticket>();

export function issueNativeTicket(ticket: Omit<Extract<Ticket, { kind: 'login' }>, 'expires'> | Omit<Extract<Ticket, { kind: 'workspace' }>, 'expires'>): string {
  for (const [code, value] of tickets) if (value.expires <= Date.now()) tickets.delete(code);
  if (tickets.size >= 1024) throw new HttpError(503, 'AUTH_BUSY', '登录服务繁忙，请重试');
  const code = randomBytes(32).toString('base64url');
  tickets.set(code, { ...ticket, expires: Date.now() + 60_000 });
  return code;
}

export function consumeNativeTicket(code: string, kind: Ticket['kind'], verifier?: string): Ticket {
  const ticket = tickets.get(code);
  if (!ticket || ticket.kind !== kind || ticket.expires <= Date.now()) throw unauthorized();
  if (ticket.kind === 'login' && (!verifier || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)
    || createHash('sha256').update(verifier).digest('base64url') !== ticket.challenge)) throw unauthorized();
  tickets.delete(code);
  return ticket;
}

export function issueNativeToken(sessionId: string): string {
  return encrypt(JSON.stringify({ purpose: 'native-session', sessionId, expires: Date.now() + 30 * 86400_000 }));
}

export function nativeSession(c: Context): string | undefined {
  if (c.req.header('origin')) return;
  const path = c.req.path.slice('/api'.length) + new URL(c.req.url).search;
  if (!nativeRequestAllowed(c.req.method, path) && !(c.req.method === 'POST' && path === '/auth/native/workspace-ticket')) return;
  const token = c.req.header('authorization')?.match(/^Bearer ([A-Za-z0-9_.-]{1,2048})$/)?.[1];
  if (!token) return;
  try {
    const value = JSON.parse(decrypt(token));
    if (value.purpose === 'native-session' && typeof value.sessionId === 'string' && /^[0-9a-f-]{36}$/i.test(value.sessionId)
      && Number.isFinite(value.expires) && value.expires > Date.now()) return value.sessionId;
  } catch { /* Invalid credentials never fall back to a browser-origin exemption. */ }
}
