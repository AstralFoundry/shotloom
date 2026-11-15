import type { PersistenceBackend } from '../../../harness/host/src/persistenceBackend';
import { admin } from './supabase';
import { supabaseError } from './errors';
import type { Json } from './types';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const json = (value: unknown) => value as Json;
type SessionRow = NonNullable<Awaited<ReturnType<PersistenceBackend['sessions']['find']>>>;

/** Only the authenticated BFF constructs this backend; every query includes its owner. */
export function agentPersistence(userId: string, dataRoot?: string): PersistenceBackend {
  // Runtime directories are disposable and may come from another operating system.
  const header = (id: string, value: SessionRow['header']): SessionRow['header'] => dataRoot
    ? { ...value, cwd: join(dataRoot, 'workspaces', createHash('sha256').update(id).digest('hex')) } : value;
  const state = () => admin.from('agent_state');
  async function get(scope: string, key: string) {
    const { data, error } = await state().select('payload').eq('user_id', userId).eq('scope', scope).eq('key', key).maybeSingle();
    if (error) throw supabaseError(error.message);
    return data?.payload;
  }
  async function put(scope: string, key: string, payload: unknown, onlyNew = false) {
    const { error } = await state().upsert({ user_id: userId, scope, key, payload: json(payload) }, {
      onConflict: 'user_id,scope,key', ignoreDuplicates: onlyNew,
    });
    if (error) throw supabaseError(error.message);
  }
  async function list(scope: string) {
    const { data, error } = await admin.rpc('agent_list_state', { p_user_id: userId, p_scope: scope });
    if (error) throw supabaseError(error.message);
    return data as Array<{ key: string; payload: Json }>;
  }
  const session = (row: { id: string; header: Json; inherited_count: number; event_count: number }): SessionRow => ({
    id: row.id, header: header(row.id, row.header as unknown as SessionRow['header']), inheritedCount: row.inherited_count, eventCount: row.event_count,
  });
  const recordsScope = (unit: string) => `records:${unit}`;
  return {
    sessions: {
      async find(id) {
        const { data, error } = await admin.from('agent_sessions').select('*').eq('user_id', userId).eq('id', id).maybeSingle();
        if (error) throw supabaseError(error.message);
        return data ? session(data) : undefined;
      },
      async list() {
        const { data, error } = await admin.rpc('agent_list_sessions', { p_user_id: userId });
        if (error) throw supabaseError(error.message);
        return (data as unknown as SessionRow[]).map(row => ({ ...row, header: header(row.id, row.header) }));
      },
      async create(header, inheritedCount) {
        const { error } = await admin.from('agent_sessions').insert({
          user_id: userId, id: header.id, header: json(header), inherited_count: inheritedCount, event_count: 0,
        });
        if (error) throw supabaseError(error.message);
      },
      async read(id, offset = 0, length) {
        const { data, error } = await admin.rpc('agent_read_events', {
          p_user_id: userId, p_id: id, p_offset: offset, ...(length === undefined ? {} : { p_length: length }),
        });
        if (error) throw supabaseError(error.message);
        return data as unknown as Awaited<ReturnType<PersistenceBackend['sessions']['read']>>;
      },
      async append(id, events, expected) {
        const { error } = await admin.rpc('agent_append', { p_user_id: userId, p_id: id, p_expected: expected, p_events: json(events) });
        if (error) throw supabaseError(error.message);
      },
    },
    host: {
      async bindings() { return (await get('bindings', 'all') ?? []) as unknown as Record<string, unknown>[]; },
      async saveBindings(rows) { await put('bindings', 'all', rows); },
      async catalogs() { return (await list('catalogs')).map(row => row.payload) as Record<string, unknown>[]; },
      async saveCatalog(key, payload) { await put('catalogs', key, payload); },
      async receipt(requestId) {
        const payload = await get('receipts', requestId);
        return payload === undefined ? undefined : { requestId, ...payload as { status: 'dispatching' | 'settled'; payload: unknown } };
      },
      async claimReceipt(requestId) {
        const { error } = await state().insert({ user_id: userId, scope: 'receipts', key: requestId, payload: { status: 'dispatching', payload: null } });
        if (error?.code === '23505') return false;
        if (error) throw supabaseError(error.message);
        return true;
      },
      async settleReceipt(requestId, payload) { await put('receipts', requestId, { status: 'settled', payload }); },
    },
    domain: {
      async unit(name) {
        const [descriptor, global] = await Promise.all([get('units', name), get('globals', name)]);
        return descriptor === undefined ? undefined : { name, descriptor: descriptor as unknown as NonNullable<Awaited<ReturnType<PersistenceBackend['domain']['unit']>>>['descriptor'], global: global ?? null };
      },
      async create(descriptor) { await put('units', descriptor.name, descriptor, true); },
      async records(unit) {
        return (await list(recordsScope(unit))).map(row => {
          const [table, key] = JSON.parse(row.key) as [string, string];
          return { unit, table, key, payload: row.payload };
        });
      },
      async put(unit, table, key, payload) { await put(recordsScope(unit), JSON.stringify([table, key]), payload); },
      async remove(unit, table, key) {
        const { error } = await state().delete().eq('user_id', userId).eq('scope', recordsScope(unit)).eq('key', JSON.stringify([table, key]));
        if (error) throw supabaseError(error.message);
      },
      async setGlobal(unit, value) { await put('globals', unit, value); },
    },
  };
}
