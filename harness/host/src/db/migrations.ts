import type Database from 'better-sqlite3';

/** SQL is confined to schema migrations and SQLite connection maintenance. */
export function migrate(connection: Database.Database) {
  connection.pragma('journal_mode = WAL');
  connection.pragma('foreign_keys = ON');
  connection.pragma('synchronous = FULL');
  connection.pragma('busy_timeout = 10000');
  const version = connection.pragma('user_version', {simple:true});
  if(version !== 0 && version !== 1 && version !== 2) throw new Error(`Unsupported agent database version: ${version}`);
  if(version === 2) return;
  connection.transaction(() => {
    if(version === 0) connection.exec(`
      CREATE TABLE sessions (id TEXT PRIMARY KEY NOT NULL, header TEXT NOT NULL, inherited_count INTEGER NOT NULL, event_count INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE session_events (session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, seq INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(session_id, seq));
      CREATE TABLE session_bindings (session_id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE tool_catalogs (key TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE tool_receipts (request_id TEXT PRIMARY KEY NOT NULL, status TEXT NOT NULL, payload TEXT);

    `);
    connection.exec(`
      CREATE TABLE storage_units (name TEXT PRIMARY KEY NOT NULL, descriptor TEXT NOT NULL, global_value TEXT);
      CREATE TABLE storage_records (unit TEXT NOT NULL REFERENCES storage_units(name) ON DELETE CASCADE, table_name TEXT NOT NULL, record_key TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(unit, table_name, record_key));
      PRAGMA user_version = 2;
    `);
  })();
}
