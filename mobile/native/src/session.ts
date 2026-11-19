import { digestStringAsync, CryptoDigestAlgorithm, CryptoEncoding, getRandomBytesAsync, randomUUID } from 'expo-crypto';
import { getItemAsync, setItemAsync, deleteItemAsync } from 'expo-secure-store';
import { openAuthSessionAsync } from 'expo-web-browser';
import { nativeFetch } from './api';
import { t } from './i18n';

export type NativeSession = { token: string; userId: string };
const callback = 'shotloom-preview://auth/callback';
const key = async (origin: string) => `shotloom.session.${await digestStringAsync(CryptoDigestAlgorithm.SHA256, origin)}`;

export async function restoreSession(origin: string): Promise<NativeSession | null> {
  const stored = await getItemAsync(await key(origin));
  if (!stored) return null;
  const value = JSON.parse(stored);
  if (typeof value.token !== 'string' || typeof value.userId !== 'string') throw new Error(t('cloud.login.failed'));
  return value;
}

export async function clearSession(origin: string): Promise<void> { await deleteItemAsync(await key(origin)); }

export async function login(origin: string, expectedUser?: string): Promise<NativeSession | null> {
  const verifier = Array.from(await getRandomBytesAsync(32), byte => byte.toString(16).padStart(2, '0')).join('');
  const challenge = (await digestStringAsync(CryptoDigestAlgorithm.SHA256, verifier, { encoding: CryptoEncoding.BASE64 })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const state = randomUUID();
  const query = new URLSearchParams({ native_challenge: challenge, native_state: state });
  const result = await openAuthSessionAsync(`${origin}/api/auth/login?${query}`, callback);
  if (result.type !== 'success') return null;
  const url = new URL(result.url);
  if (`${url.protocol}//${url.host}${url.pathname}` !== callback || url.searchParams.get('state') !== state
    || url.searchParams.has('error') || !url.searchParams.get('code')) throw new Error(t('cloud.login.failed'));
  const session = await nativeFetch<NativeSession>(origin, '/auth/native/exchange', 'POST', { code: url.searchParams.get('code'), verifier });
  if (typeof session.token !== 'string' || typeof session.userId !== 'string') throw new Error(t('cloud.login.failed'));
  if (expectedUser && session.userId !== expectedUser) {
    await nativeFetch(origin, '/auth/logout', 'POST', undefined, session.token);
    throw new Error(t('cloud.login.accountChanged'));
  }
  await setItemAsync(await key(origin), JSON.stringify(session));
  return session;
}

export async function workspaceSource(origin: string, token: string, redirect: string) {
  const { code } = await nativeFetch<{ code: string }>(origin, '/auth/native/workspace-ticket', 'POST', { redirect }, token);
  return { uri: `${origin}/api/auth/native/workspace`, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code }).toString() };
}
