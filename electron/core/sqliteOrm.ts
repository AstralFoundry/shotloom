import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fillPlaceholders, type Query } from 'drizzle-orm';
import { BaseSQLiteDatabase, SQLiteSyncDialect, SQLiteSession, SQLitePreparedQuery, SQLiteTransaction, type SQLiteExecuteMethod, type SQLiteTransactionConfig } from 'drizzle-orm/sqlite-core';
import type { SelectedFieldsOrdered } from 'drizzle-orm/sqlite-core/query-builders/select.types';
import { mapResultRow } from 'drizzle-orm/utils';

// Drizzle's synchronous SQLite adapter for Electron's built-in node:sqlite.
// Domain modules use table models; only this adapter executes generated queries.
type RunResult = ReturnType<ReturnType<DatabaseSync['prepare']>['run']>;
type EmptySchema = Record<string, never>;
export type OrmDatabase = BaseSQLiteDatabase<'sync', RunResult>;
const databases = new WeakMap<DatabaseSync, OrmDatabase>();

class PreparedQuery extends SQLitePreparedQuery<{
  type: 'sync'; run: RunResult; all: unknown[]; get: unknown; values: unknown[][]; execute: unknown;
}> {
  constructor(private connection: DatabaseSync, query: Query, private fields: SelectedFieldsOrdered | undefined,
    method: SQLiteExecuteMethod, private mapper?: (rows: unknown[][]) => unknown) {
    super('sync', method, query);
  }
  private statement(values?: Record<string, unknown>) {
    return { statement: this.connection.prepare(this.query.sql), params: fillPlaceholders(this.query.params, values ?? {}) as SQLInputValue[] };
  }
  run(values?: Record<string, unknown>) {
    const { statement, params } = this.statement(values);
    return statement.run(...params);
  }
  values(values?: Record<string, unknown>): unknown[][] {
    const { statement, params } = this.statement(values);
    statement.setReturnArrays(true);
    return statement.all(...params) as unknown as unknown[][];
  }
  all(values?: Record<string, unknown>): unknown[] {
    if (!this.fields && !this.mapper) {
      const { statement, params } = this.statement(values);
      return statement.all(...params);
    }
    const rows = this.values(values);
    if (this.mapper) return this.mapper(rows) as unknown[];
    return rows.map(row => mapResultRow(this.fields!, row));
  }
  get(values?: Record<string, unknown>): unknown {
    const { statement, params } = this.statement(values);
    if (!this.fields && !this.mapper) return statement.get(...params);
    statement.setReturnArrays(true);
    const row = statement.get(...params) as unknown as unknown[] | undefined;
    if (!row) return undefined;
    return this.mapper ? this.mapper([row]) : mapResultRow(this.fields!, row);
  }
}

class NodeSession extends SQLiteSession<'sync', RunResult, EmptySchema, EmptySchema> {
  constructor(private connection: DatabaseSync, private dialect: SQLiteSyncDialect) { super(dialect); }
  prepareQuery(query: Query, fields: SelectedFieldsOrdered | undefined, method: SQLiteExecuteMethod,
    _arrayMode: boolean, mapper?: (rows: unknown[][]) => unknown) {
    return new PreparedQuery(this.connection, query, fields, method, mapper);
  }
  transaction<T>(work: (tx: NodeTransaction) => T,
    config?: SQLiteTransactionConfig): T {
    const nested = this.connection.isTransaction;
    // Each session has its own synchronous call stack; a fixed savepoint name is safe with SQLite nesting.
    const begin = config?.behavior === 'immediate' ? 'BEGIN IMMEDIATE' : config?.behavior === 'exclusive' ? 'BEGIN EXCLUSIVE' : 'BEGIN';
    this.connection.exec(nested ? 'SAVEPOINT orm_transaction' : begin);
    try {
      const result = work(new NodeTransaction(this, this.dialect));
      this.connection.exec(nested ? 'RELEASE SAVEPOINT orm_transaction' : 'COMMIT');
      return result;
    } catch (error) {
      this.connection.exec(nested ? 'ROLLBACK TO SAVEPOINT orm_transaction' : 'ROLLBACK');
      if (nested) this.connection.exec('RELEASE SAVEPOINT orm_transaction');
      throw error;
    }
  }
}
class NodeTransaction extends SQLiteTransaction<'sync', RunResult, EmptySchema, EmptySchema> {
  constructor(private nodeSession: NodeSession, dialect: SQLiteSyncDialect) { super('sync', dialect, nodeSession, undefined); }
  transaction<T>(work: (tx: NodeTransaction) => T): T {
    return this.nodeSession.transaction(work);
  }
}
export function orm(connection: DatabaseSync): OrmDatabase {
  let database = databases.get(connection);
  if (!database) {
    const dialect = new SQLiteSyncDialect();
    database = new BaseSQLiteDatabase('sync', dialect, new NodeSession(connection, dialect), undefined);
    databases.set(connection, database);
  }
  return database;
}

// Drizzle exports this mapper at runtime but omits it from its public declaration file.
declare module 'drizzle-orm/utils' {
  export function mapResultRow(fields: SelectedFieldsOrdered, row: unknown[]): Record<string, unknown>;
}
