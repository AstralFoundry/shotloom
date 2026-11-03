import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session';

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  header: text('header', {mode:'json'}).$type<SessionHeader>().notNull(),
  inheritedCount: integer('inherited_count').notNull(),
  eventCount: integer('event_count').notNull().default(0),
});
export const sessionEvents = sqliteTable('session_events', {
  sessionId: text('session_id').notNull().references(() => sessions.id, {onDelete:'cascade'}),
  seq: integer('seq').notNull(),
  payload: text('payload', {mode:'json'}).$type<SessionEvent>().notNull(),
}, table => [primaryKey({columns:[table.sessionId, table.seq]})]);
export const bindings = sqliteTable('session_bindings', {
  sessionId: text('session_id').primaryKey(), payload: text('payload', {mode:'json'}).$type<Record<string, unknown>>().notNull(),
});
export const catalogs = sqliteTable('tool_catalogs', {
  key: text('key').primaryKey(), payload: text('payload', {mode:'json'}).$type<Record<string, unknown>>().notNull(),
});
export const receipts = sqliteTable('tool_receipts', {
  requestId: text('request_id').primaryKey(), status: text('status', {enum:['dispatching','settled']}).notNull(),
  payload: text('payload', {mode:'json'}).$type<unknown>(),
});

// Official storage-domain seam: unit/table identities are data, never SQL identifiers.
export const storageUnits = sqliteTable('storage_units', {
  name: text('name').primaryKey(), descriptor: text('descriptor', {mode:'json'}).$type<import('@deepseek-ai/dsh-storage').KvUnitDescriptor>().notNull(),
  global: text('global_value', {mode:'json'}).$type<unknown>(),
});
export const storageRecords = sqliteTable('storage_records', {
  unit: text('unit').notNull().references(()=>storageUnits.name,{onDelete:'cascade'}),
  table: text('table_name').notNull(), key: text('record_key').notNull(),
  payload: text('payload', {mode:'json'}).$type<unknown>().notNull(),
}, row=>[primaryKey({columns:[row.unit,row.table,row.key]})]);
