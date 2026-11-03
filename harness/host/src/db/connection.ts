import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { migrate } from './migrations.js';
import * as schema from './schema.js';

export interface AgentDatabase { orm: BetterSQLite3Database<typeof schema>; close(): void }
export function openDatabase(path: string): AgentDatabase {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), {recursive:true});
  const connection = new Database(absolute);
  try { migrate(connection); } catch(error) { connection.close(); throw error; }
  return {orm:drizzle(connection,{schema}), close:() => connection.close()};
}

