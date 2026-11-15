import { createServerClient, serializeCookieHeader } from '@supabase/ssr';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { User } from '@supabase/supabase-js';
import { env } from '../env';
import { unauthorized } from './errors';

export function authClient(c: Context) {
  return createServerClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: { name: 'shotloom-supabase-auth', httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax', path: '/' },
    cookies: {
      getAll: () => Object.entries(getCookie(c)).map(([name, value]) => ({ name, value })),
      setAll: cookies => { for (const { name, value, options } of cookies) c.header('Set-Cookie', serializeCookieHeader(name, value, options), { append: true }); },
    },
  });
}

// Auth-managed identities are trusted; user_metadata is user editable.
export function gatewaySubject(user: Pick<User, 'identities'>, provider: string, clientId: string): string {
  const identities = user.identities?.filter(identity => identity.provider === provider) ?? [];
  if (identities.length !== 1) throw unauthorized();
  const claims = identities[0]!.identity_data;
  if (!claims || typeof claims.sub !== 'string' || !/^[1-9][0-9]*$/.test(claims.sub)
    || !Array.isArray(claims.aud) || claims.aud.length !== 1 || claims.aud[0] !== clientId) throw unauthorized();
  return claims.sub;
}
