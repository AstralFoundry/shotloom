-- Shotloom 云化迁移：领域数据模型（Postgres）
-- 将 src-tauri/src/models/* 的 SeaORM 实体迁移为 Supabase Postgres，新增用户租户维度。
--
-- 关键约定（与 Rust 模型对齐）：
--   * payload(jsonb) 是唯一事实来源；id 是客户端提供的稳定字符串，仅租户内唯一。
--   * 集合行只冗余 id + position（去重与排序），其余字段一律留在 payload 内。
--   * 项目级集合对应 project_crud.rs collections! 宏：
--       nodes / edges / tasks / assets / materials / conversations(harnessSessions)
--       production_plans / agent_batches / agent_evaluations
--   * 全局素材库（catalog 的 assets/materials）与项目级 assets/materials 是两套数据，
--     分别用 catalog_assets / catalog_materials 承载，避免与项目级同名表冲突。
-- 策略：独立 schema `shotloom`，BFF 以 service_role 访问；RLS 默认拒绝 anon/authenticated。

create schema if not exists shotloom;

-- ---------------------------------------------------------------------------
-- 身份与会话
-- ---------------------------------------------------------------------------
create table if not exists shotloom.users (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  sub text not null unique,
  username text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists shotloom.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references shotloom.users(id) on delete cascade,
  access_token_cipher text not null,
  refresh_token_cipher text,
  token_type text not null default 'Bearer',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists sessions_user_idx on shotloom.sessions(user_id);

-- ---------------------------------------------------------------------------
-- 项目
-- ---------------------------------------------------------------------------
create table if not exists shotloom.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references shotloom.users(id) on delete cascade,
  name text not null default '',
  revision bigint not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_user_idx on shotloom.projects(user_id);

-- ---------------------------------------------------------------------------
-- 项目级集合（画布图数据）
-- ---------------------------------------------------------------------------
create table if not exists shotloom.nodes (
  project_id uuid not null references shotloom.projects(id) on delete cascade,
  id text not null,
  position int not null default 0,
  payload jsonb not null default '{}'::jsonb,
  primary key (project_id, id)
);

create table if not exists shotloom.edges (
  project_id uuid not null references shotloom.projects(id) on delete cascade,
  id text not null,
  position int not null default 0,
  payload jsonb not null default '{}'::jsonb,
  primary key (project_id, id)
);

create table if not exists shotloom.tasks (
  project_id uuid not null references shotloom.projects(id) on delete cascade,
  id text not null,
  position int not null default 0,
  payload jsonb not null default '{}'::jsonb,
  primary key (project_id, id)
);

create table if not exists shotloom.assets (
  project_id uuid not null references shotloom.projects(id) on delete cascade,
  id text not null,
  position int not null default 0,
  payload jsonb not null default '{}'::jsonb,
  primary key (project_id, id)
);

create table if not exists shotloom.materials (
  project_id uuid not null references shotloom.projects(id) on delete cascade,
  id text not null,
  position int not null default 0,
  payload jsonb not null default '{}'::jsonb,
  primary key (project_id, id)
);

create table if not exists shotloom.conversations (
  project_id uuid not null references shotloom.projects(id) on delete cascade,
  id text not null,
  position int not null default 0,
  payload jsonb not null default '{}'::jsonb,
  primary key (project_id, id)
);

create table if not exists shotloom.production_plans (
  project_id uuid not null references shotloom.projects(id) on delete cascade,
  id text not null,
  position int not null default 0,
  payload jsonb not null default '{}'::jsonb,
  primary key (project_id, id)
);

create table if not exists shotloom.agent_batches (
  project_id uuid not null references shotloom.projects(id) on delete cascade,
  id text not null,
  position int not null default 0,
  payload jsonb not null default '{}'::jsonb,
  primary key (project_id, id)
);

create table if not exists shotloom.agent_evaluations (
  project_id uuid not null references shotloom.projects(id) on delete cascade,
  id text not null,
  position int not null default 0,
  payload jsonb not null default '{}'::jsonb,
  primary key (project_id, id)
);

-- 画布撤销/重做双栈
create table if not exists shotloom.canvas_history (
  project_id uuid not null references shotloom.projects(id) on delete cascade,
  stack text not null,
  position int not null,
  payload jsonb not null default '{}'::jsonb,
  primary key (project_id, stack, position)
);

-- 编辑器快照与记录
create table if not exists shotloom.editor_snapshots (
  project_id uuid not null references shotloom.projects(id) on delete cascade,
  node_id text not null,
  revision bigint not null default 1,
  payload jsonb not null default '{}'::jsonb,
  primary key (project_id, node_id)
);

create table if not exists shotloom.editor_records (
  project_id uuid not null references shotloom.projects(id) on delete cascade,
  node_id text not null,
  key text not null,
  payload jsonb not null default '{}'::jsonb,
  primary key (project_id, node_id, key)
);

-- ---------------------------------------------------------------------------
-- 全局素材库（catalog：skills / recipes / assets / materials）+ 元数据
-- ---------------------------------------------------------------------------
create table if not exists shotloom.skills (
  user_id uuid not null references shotloom.users(id) on delete cascade,
  id text not null,
  position int not null default 0,
  payload jsonb not null default '{}'::jsonb,
  primary key (user_id, id)
);

create table if not exists shotloom.recipes (
  user_id uuid not null references shotloom.users(id) on delete cascade,
  id text not null,
  position int not null default 0,
  payload jsonb not null default '{}'::jsonb,
  primary key (user_id, id)
);

create table if not exists shotloom.catalog_assets (
  user_id uuid not null references shotloom.users(id) on delete cascade,
  id text not null,
  position int not null default 0,
  payload jsonb not null default '{}'::jsonb,
  primary key (user_id, id)
);

create table if not exists shotloom.catalog_materials (
  user_id uuid not null references shotloom.users(id) on delete cascade,
  id text not null,
  position int not null default 0,
  payload jsonb not null default '{}'::jsonb,
  primary key (user_id, id)
);

create table if not exists shotloom.catalog_metadatas (
  user_id uuid not null references shotloom.users(id) on delete cascade,
  scope text not null,
  payload jsonb not null default '{}'::jsonb,
  primary key (user_id, scope)
);

-- ---------------------------------------------------------------------------
-- 全局（按用户归属）设置
-- ---------------------------------------------------------------------------
create table if not exists shotloom.settings (
  user_id uuid not null references shotloom.users(id) on delete cascade,
  key text not null,
  payload jsonb not null default '{}'::jsonb,
  primary key (user_id, key)
);

create table if not exists shotloom.recent_projects (
  user_id uuid not null references shotloom.users(id) on delete cascade,
  project_id uuid not null references shotloom.projects(id) on delete cascade,
  opened_at bigint not null default 0,
  payload jsonb not null default '{}'::jsonb,
  primary key (user_id, project_id)
);

create table if not exists shotloom.recovery_records (
  user_id uuid not null references shotloom.users(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  primary key (user_id, kind)
);

create table if not exists shotloom.clipboard_records (
  user_id uuid not null references shotloom.users(id) on delete cascade,
  id text not null,
  payload jsonb not null default '{}'::jsonb,
  primary key (user_id, id)
);

create table if not exists shotloom.workspace_sessions (
  user_id uuid not null references shotloom.users(id) on delete cascade,
  window_label text not null,
  project_id uuid,
  primary key (user_id, window_label)
);

-- ---------------------------------------------------------------------------
-- RLS：默认拒绝 anon/authenticated（service_role 绕过）。BFF 为强制点。
-- 未来若允许客户端直连，可在此按 auth.uid() 放开策略。
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'shotloom' loop
    execute format('alter table shotloom.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Storage 私有桶：媒体与素材。DB 只存 storage_path，读取走签名 URL。
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('shotloom-media', 'shotloom-media', false, 524288000, null),
  ('shotloom-assets', 'shotloom-assets', false, 524288000, null)
on conflict (id) do nothing;
