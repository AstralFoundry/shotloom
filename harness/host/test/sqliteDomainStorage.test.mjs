import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import * as SqliteStorage from '../dist/sqliteDomainStorage.js';

test('official workspace/settings storage persists records and globals through SQLite restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shotloom-domain-sqlite-'));
  const descriptor = { name: 'workspace', version: 1, tables: ['projects'], hasGlobal: true };
  let ctx;
  const start = async () => {
    ctx = new Context();
    await ctx.plugin(Storage);
    await ctx.plugin(SqliteStorage, { path: join(root, 'agent.sqlite') });
    return ctx.storage.backend.get('sqlite');
  };
  try {
    let backend = await start();
    let unit = await backend.kv.open(descriptor);
    assert.deepEqual(await unit.loadAll(), { tables: { projects: Object.create(null) }, global: null });
    await unit.putRecord('projects', 'one', { name: 'first' });
    await unit.putRecord('projects', 'one', { name: 'updated' });
    await unit.putRecord('projects', 'removed', { name: 'discarded' });
    await unit.deleteRecord('projects', 'removed');
    await unit.setGlobal({ currentProject: 'one' });
    await assert.rejects(backend.kv.open(descriptor), /already open/);
    await assert.rejects(unit.putRecord('undeclared', 'bad', {}), /Unknown table/);
    await ctx.fiber.dispose();
    await assert.rejects(unit.loadAll(), error => error.code === 'closed');

    backend = await start();
    await assert.rejects(backend.kv.open({ ...descriptor, version: 2 }), error => error.code === 'version-mismatch');
    await assert.rejects(backend.kv.open({ ...descriptor, tables: ['different'] }), error => error.code === 'malformed-medium');
    unit = await backend.kv.open(descriptor);
    const snapshot = await unit.loadAll();
    assert.deepEqual({ ...snapshot.tables.projects }, { one: { name: 'updated' } });
    assert.deepEqual(snapshot.global, { currentProject: 'one' });
    await unit.close();
    await assert.rejects(unit.deleteRecord('projects', 'one'), error => error.code === 'closed');
    const perRecord = await backend.kv.open({ name: 'records', version: 1, tables: ['items'], hasGlobal: false, layout: 'per-record' });
    await assert.rejects(perRecord.putRecord('items', '../unsafe', {}), error => error.code === 'malformed-medium');
    await assert.rejects(perRecord.setGlobal({}), error => error.code === 'malformed-medium');
    await perRecord.putRecord('items', 'valid-key', { ok: true });
    await Promise.all([backend.close(), backend.close()]);
    await assert.rejects(perRecord.loadAll(), error => error.code === 'closed');
    await assert.rejects(backend.kv.open(descriptor), error => error.code === 'closed');
    await ctx.fiber.dispose();
    assert.deepEqual((await readdir(root)).filter(name => /\.jsonl?$/.test(name)), []);
  } finally {
    await ctx?.fiber.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
