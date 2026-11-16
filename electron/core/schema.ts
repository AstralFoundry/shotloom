import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

// Physical names match existing Tauri databases; payloads retain their JSON text encoding.
export const catalog_metadata = sqliteTable('catalog_metadata', {
  scope: text('scope').notNull().primaryKey(),
  payload: text('payload').notNull(),
});

export const canvas_history = sqliteTable('canvas_history', {
  stack: text('stack').notNull(),
  position: integer('position').notNull(),
  payload: text('payload').notNull(),
}, table => [primaryKey({ columns: [table.stack, table.position] })]);

export const production_plans = sqliteTable('production_plans', {
  id: text('id').notNull().primaryKey(),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  payload: text('payload').notNull(),
});

export const agent_batches = sqliteTable('agent_batches', {
  id: text('id').notNull().primaryKey(),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  payload: text('payload').notNull(),
});

export const agent_evaluations = sqliteTable('agent_evaluations', {
  id: text('id').notNull().primaryKey(),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  payload: text('payload').notNull(),
});

export const projects = sqliteTable('projects', {
  id: integer('id').notNull().primaryKey(),
  name: text('name').notNull(),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
  revision: integer('revision').notNull(),
  payload: text('payload').notNull(),
});

export const project_snapshots = sqliteTable('project_snapshots', {
  id: text('id').notNull().primaryKey(),
  created_at: text('created_at').notNull(),
  reason: text('reason').notNull(),
  content_hash: text('content_hash').notNull(),
  payload_bytes: integer('payload_bytes').notNull(),
  media_refs: text('media_refs').notNull().default('[]'),
  degraded: integer('degraded').notNull(),
  payload: text('payload'),
});

export const nodes = sqliteTable('nodes', {
  id: text('id').notNull().primaryKey(),
  position: integer('position').notNull(),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  payload: text('payload').notNull(),
});

export const edges = sqliteTable('edges', {
  id: text('id').notNull().primaryKey(),
  position: integer('position').notNull(),
  source: text('source').notNull().references(() => nodes.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
  target: text('target').notNull().references(() => nodes.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
  payload: text('payload').notNull(),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').notNull().primaryKey(),
  position: integer('position').notNull(),
  node_id: text('node_id'),
  status: text('status').notNull(),
  payload: text('payload').notNull(),
});

export const assets = sqliteTable('assets', {
  id: text('id').notNull().primaryKey(),
  position: integer('position').notNull(),
  material_id: text('material_id'),
  payload: text('payload').notNull(),
});

export const materials = sqliteTable('materials', {
  id: text('id').notNull().primaryKey(),
  position: integer('position').notNull(),
  file_path: text('file_path'),
  payload: text('payload').notNull(),
});

export const conversations = sqliteTable('conversations', {
  id: text('id').notNull().primaryKey(),
  position: integer('position').notNull(),
  agent_id: text('agent_id').notNull(),
  payload: text('payload').notNull(),
});

export const workspace_sessions = sqliteTable('workspace_sessions', {
  window_label: text('window_label').notNull().primaryKey(),
  project_dir: text('project_dir'),
});

export const editor_snapshots = sqliteTable('editor_snapshots', {
  node_id: text('node_id').notNull().primaryKey(),
  revision: integer('revision').notNull(),
  payload: text('payload').notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').notNull().primaryKey(),
  payload: text('payload').notNull(),
});

export const skills = sqliteTable('skills', {
  id: text('id').notNull().primaryKey(),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  enabled: integer('enabled').notNull(),
  payload: text('payload').notNull(),
});

export const recipes = sqliteTable('recipes', {
  id: text('id').notNull().primaryKey(),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  payload: text('payload').notNull(),
});

export const editor_records = sqliteTable('editor_records', {
  node_id: text('node_id').notNull(),
  key: text('key').notNull(),
  payload: text('payload').notNull(),
}, table => [primaryKey({ columns: [table.node_id, table.key] })]);

export const recent_projects = sqliteTable('recent_projects', {
  file_path: text('file_path').notNull().primaryKey(),
  opened_at: integer('opened_at').notNull(),
  payload: text('payload').notNull(),
});

export const recovery_records = sqliteTable('recovery_records', {
  kind: text('kind').notNull().primaryKey(),
  payload: text('payload').notNull(),
});

export const clipboard_records = sqliteTable('clipboard_records', {
  id: text('id').notNull().primaryKey(),
  payload: text('payload').notNull(),
});

export const collectionTables = { nodes, edges, tasks, assets, materials, conversations, production_plans, agent_batches, agent_evaluations, skills, recipes } as const;
export type CollectionName = keyof typeof collectionTables;
