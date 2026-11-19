import type { Json } from "./types";
import type { ModelPublication } from '../../../shared/modelPublications';

// Supabase `Database` 类型：用 `type` 别名（而非 interface）声明 Row，
// 以使其满足 supabase-js `Record<string, unknown>` 的泛型约束。
// Insert/Update 走 service_role 直写，字段形态由领域层 Zod 与写入函数保证，
// 此处保留宽松的 Record<string, unknown>，读取侧 Row 严格。

type Table<Row> = {
  Row: Row;
  Insert: Record<string, unknown>;
  Update: Record<string, unknown>;
  Relationships: [];
};

export type UserRow = {
  id: string;
  client_id: string;
  sub: string;
  username: string | null;
  email: string | null;
  created_at: string;
  updated_at: string;
};

export type SessionRow = {
  id: string;
  user_id: string;
  access_token_cipher: string;
  refresh_token_cipher: string | null;
  token_type: string;
  expires_at: string;
  created_at: string;
};

export type ProjectRow = {
  id: string;
  user_id: string;
  client_id: string;
  name: string;
  revision: number;
  payload: Json;
  created_at: string;
  updated_at: string;
};

// 项目级集合（nodes/edges/tasks/assets/materials/conversations/...）
export type ProjectCollectionRow = {
  project_id: string;
  id: string;
  position: number;
  payload: Json;
};

export type CanvasHistoryRow = {
  project_id: string;
  stack: string;
  position: number;
  payload: Json;
};

export type EditorSnapshotRow = {
  project_id: string;
  node_id: string;
  revision: number;
  payload: Json;
};

export type EditorRecordRow = {
  project_id: string;
  node_id: string;
  key: string;
  payload: Json;
};

// 用户级集合（skills/recipes/catalog_assets/catalog_materials）
export type UserCollectionRow = {
  user_id: string;
  id: string;
  position: number;
  payload: Json;
};

export type CatalogMetadataRow = {
  user_id: string;
  scope: string;
  payload: Json;
};

export type SettingRow = {
  user_id: string;
  key: string;
  payload: Json;
};

export type RecentProjectRow = {
  user_id: string;
  project_id: string;
  opened_at: number;
  payload: Json;
};

export type RecoveryRecordRow = {
  user_id: string;
  kind: string;
  payload: Json;
};

export type ClipboardRecordRow = {
  user_id: string;
  id: string;
  payload: Json;
};

export type WorkspaceSessionRow = {
  user_id: string;
  window_label: string;
  project_id: string | null;
};

export type ProjectCollectionTable =
  | "nodes"
  | "edges"
  | "tasks"
  | "assets"
  | "materials"
  | "conversations"
  | "production_plans"
  | "agent_batches"
  | "agent_evaluations";

export type UserCollectionTable = "skills" | "recipes" | "catalog_assets" | "catalog_materials";

export type Database = {
  shotloom: {
    Tables: {
      app_admins: Table<{ client_id: string; user_id: string }>;
      model_publications: Table<ModelPublication & { client_id: string }>;
      admin_audit: Table<{ id: number; client_id: string; actor_id: string; action: string; model_id: string | null; details: Json; created_at: string }>;
      agent_sessions: Table<{ user_id: string; id: string; header: Json; inherited_count: number; event_count: number }>;
      agent_events: Table<{ user_id: string; session_id: string; seq: number; payload: Json }>;
      agent_state: Table<{ user_id: string; scope: string; key: string; payload: Json }>;
      users: Table<UserRow>;
      sessions: Omit<Table<SessionRow>, 'Relationships'> & { Relationships: [{
        foreignKeyName: 'sessions_user_id_fkey'; columns: ['user_id']; isOneToOne: false;
        referencedRelation: 'users'; referencedColumns: ['id'];
      }] };
      projects: Table<ProjectRow>;
      nodes: Table<ProjectCollectionRow>;
      edges: Table<ProjectCollectionRow>;
      tasks: Table<ProjectCollectionRow>;
      assets: Table<ProjectCollectionRow>;
      materials: Table<ProjectCollectionRow>;
      conversations: Table<ProjectCollectionRow>;
      production_plans: Table<ProjectCollectionRow>;
      agent_batches: Table<ProjectCollectionRow>;
      agent_evaluations: Table<ProjectCollectionRow>;
      canvas_history: Table<CanvasHistoryRow>;
      editor_snapshots: Table<EditorSnapshotRow>;
      editor_records: Table<EditorRecordRow>;
      skills: Table<UserCollectionRow>;
      recipes: Table<UserCollectionRow>;
      catalog_assets: Table<UserCollectionRow>;
      catalog_materials: Table<UserCollectionRow>;
      catalog_metadatas: Table<CatalogMetadataRow>;
      settings: Table<SettingRow>;
      recent_projects: Table<RecentProjectRow>;
      recovery_records: Table<RecoveryRecordRow>;
      clipboard_records: Table<ClipboardRecordRow>;
      workspace_sessions: Table<WorkspaceSessionRow>;
      library_folders: Table<{ id: string; user_id: string; client_id: string; parent_id: string | null; name: string }>;
    };
    Views: Record<string, never>;
    Functions: {
      support_action: { Args: { p_client_id: string; p_actor_id: string; p_action: string; p_value: Json }; Returns: Json };
      list_admin_users: { Args: { p_client_id: string; p_actor_id: string; p_query: string; p_offset: number; p_limit: number }; Returns: Json };
      set_app_admin: { Args: { p_client_id: string; p_actor_id: string; p_user_id: string; p_is_admin: boolean; p_expected_admin: boolean }; Returns: Json };
      manage_models: { Args: { p_client_id: string; p_actor_id: string; p_action: string; p_value: Json }; Returns: Json };
      load_project_bundle: { Args: { p_user_id: string; p_id: string }; Returns: Json | null };
      import_project_bundle: { Args: { p_user_id: string; p_client_id: string; p_id: string; p_value: Json }; Returns: Json };
      agent_append: { Args: { p_user_id: string; p_id: string; p_expected: number; p_events: Json }; Returns: undefined };
      agent_read_events: { Args: { p_user_id: string; p_id: string; p_offset: number; p_length?: number }; Returns: Json };
      agent_list_sessions: { Args: { p_user_id: string }; Returns: Json };
      agent_list_state: { Args: { p_user_id: string; p_scope: string }; Returns: Json };
      save_editor_snapshot: { Args: { p_project_id: string; p_node_id: string; p_payload: Json }; Returns: undefined };
      list_projects: { Args: { p_user_id: string }; Returns: Json };
      list_library_folders: { Args: { p_user_id: string }; Returns: Json };
      load_project: { Args: { p_user_id: string; p_id: string }; Returns: Json | null };
      load_catalog: { Args: { p_user_id: string; p_kind: string }; Returns: Json | null };
      save_catalog: { Args: { p_user_id: string; p_kind: string; p_value: Json }; Returns: undefined };
      save_project: { Args: { p_user_id: string; p_client_id: string; p_id: string; p_value: Json }; Returns: Json };
      save_settings: { Args: { p_user_id: string; p_value: Json }; Returns: undefined };
    };
  };
};
