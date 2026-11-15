import { admin } from "./supabase";
import { env } from "../env";
import { badRequest, conflict, notFound, supabaseError } from "./errors";
import type { Json, JsonObject } from "./types";
import type {
  EditorSnapshotRow,
  EditorRecordRow,
  RecentProjectRow,
  RecoveryRecordRow,
} from "./database";

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------
function asString(v: Json | null | undefined): string | null {
  return typeof v === "string" ? v : null;
}
function asObject(v: Json | null | undefined): JsonObject | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as JsonObject) : null;
}

export async function loadProject(userId: string, projectId: string): Promise<Json | null> {
  const { data, error } = await admin.rpc("load_project", { p_user_id: userId, p_id: projectId });
  if (error) throw supabaseError(error.message);
  return data;
}

export async function loadProjectBundle(userId: string, projectId: string): Promise<Json> {
  const { data, error } = await admin.rpc('load_project_bundle', { p_user_id: userId, p_id: projectId });
  if (error) throw supabaseError(error.message);
  if (!data) throw notFound('工程不存在或无权访问');
  return data;
}

export async function importProjectBundle(userId: string, projectId: string, value: Json): Promise<Json> {
  const { data, error } = await admin.rpc('import_project_bundle', { p_user_id: userId, p_client_id: env.GATEWAY_CLIENT_ID, p_id: projectId, p_value: value });
  if (error?.code === 'PT409') throw conflict('导入必须使用新的工程 id');
  if (error?.code === '42501') throw notFound('工程不存在或无权访问');
  if (error?.code === '22023' || error?.code === '23505' || error?.code === '23502') throw badRequest('项目包记录格式无效或存在重复 id');
  if (error) throw supabaseError(error.message);
  return data;
}

export async function saveProject(userId: string, projectId: string, value: Json): Promise<Json> {
  const { data, error } = await admin.rpc("save_project", {
    p_user_id: userId, p_client_id: env.GATEWAY_CLIENT_ID, p_id: projectId, p_value: value,
  });
  if (error?.code === "PT409" || error?.code === "23505") throw conflict("工程已被修改或记录 id 重复，请重新加载后保存");
  if (error?.code === "42501") throw notFound("工程不存在或无权访问");
  if (error?.code === "22023") throw badRequest(error.message);
  if (error) throw supabaseError(error.message);
  return data;
}

export async function listProjects(userId: string): Promise<Json[]> {
  const { data, error } = await admin.rpc("list_projects", { p_user_id: userId });
  if (error) throw supabaseError(error.message);
  return Array.isArray(data) ? data : [];
}

export async function deleteProject(userId: string, projectId: string): Promise<void> {
  const { data: exists, error: readErr } = await admin
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (readErr) throw supabaseError(readErr.message);
  if (!exists) throw notFound("工程不存在或无权访问");
  // 子表（nodes/edges/.../recent_projects）均已声明 on delete cascade。
  const { error } = await admin
    .from("projects")
    .delete()
    .eq("id", projectId)
    .eq("user_id", userId);
  if (error) throw supabaseError(error.message);
}

// ---------------------------------------------------------------------------
// 租户校验：service_role 绕过 RLS，BFF 必须显式确认 project 归属当前用户。
// ---------------------------------------------------------------------------
export async function assertProjectOwnership(userId: string, projectId: string): Promise<void> {
  const { data, error } = await admin
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw supabaseError(error.message);
  if (!data) throw notFound("工程不存在或无权访问");
}

// ---------------------------------------------------------------------------
// 编辑器快照与记录
// ---------------------------------------------------------------------------
export async function loadSnapshot(projectId: string, nodeId: string): Promise<Json | null> {
  const { data, error } = await admin
    .from("editor_snapshots")
    .select("*")
    .eq("project_id", projectId)
    .eq("node_id", nodeId)
    .maybeSingle();
  if (error) throw supabaseError(error.message);
  return data?.payload ?? null;
}

export async function saveSnapshot(projectId: string, nodeId: string, payload: Json): Promise<void> {
  const { error } = await admin.rpc("save_editor_snapshot", {
    p_project_id: projectId, p_node_id: nodeId, p_payload: payload,
  });
  if (error) throw supabaseError(error.message);
}

export async function editorRecord(projectId: string, nodeId: string, key: string): Promise<Json | null> {
  const { data, error } = await admin
    .from("editor_records")
    .select("*")
    .eq("project_id", projectId)
    .eq("node_id", nodeId)
    .eq("key", key)
    .maybeSingle();
  if (error) throw supabaseError(error.message);
  return data?.payload ?? null;
}

export async function setEditorRecord(
  projectId: string,
  nodeId: string,
  key: string,
  payload: Json | null,
): Promise<void> {
  if (payload === null) {
    const { error } = await admin
      .from("editor_records")
      .delete()
      .eq("project_id", projectId)
      .eq("node_id", nodeId)
      .eq("key", key);
    if (error) throw supabaseError(error.message);
    return;
  }
  const { error } = await admin
    .from("editor_records")
    .upsert({ project_id: projectId, node_id: nodeId, key, payload }, { onConflict: "project_id,node_id,key" });
  if (error) throw supabaseError(error.message);
}

// ---------------------------------------------------------------------------
// 设置（全局，按用户归属）
// ---------------------------------------------------------------------------
export async function loadSettings(userId: string): Promise<JsonObject> {
  const { data, error } = await admin.from("settings").select("*").eq("user_id", userId);
  if (error) throw supabaseError(error.message);
  const value: JsonObject = {};
  for (const row of data ?? []) value[row.key] = row.payload;
  return value;
}

export async function saveSettings(userId: string, value: Json): Promise<void> {
  const { error } = await admin.rpc("save_settings", { p_user_id: userId, p_value: value });
  if (error) throw supabaseError(error.message);
}

export async function getSettingField(userId: string, key: string): Promise<Json | null> {
  const { data, error } = await admin
    .from("settings")
    .select("payload")
    .eq("user_id", userId)
    .eq("key", key)
    .maybeSingle();
  if (error) throw supabaseError(error.message);
  return data?.payload ?? null;
}

export async function setSettingField(userId: string, key: string, payload: Json): Promise<void> {
  const { error } = await admin
    .from("settings")
    .upsert({ user_id: userId, key, payload }, { onConflict: "user_id,key" });
  if (error) throw supabaseError(error.message);
}

// ---------------------------------------------------------------------------
// 目录（catalog：skills / recipes / assets / materials）
// ---------------------------------------------------------------------------
export async function loadCatalog(userId: string, kind: string, fallback: Json): Promise<Json> {
  const { data, error } = await admin.rpc("load_catalog", { p_user_id: userId, p_kind: kind });
  if (error?.code === "22023") throw badRequest(error.message);
  if (error) throw supabaseError(error.message);
  return data ?? fallback;
}

export async function saveCatalog(userId: string, kind: string, value: Json): Promise<void> {
  const { error } = await admin.rpc("save_catalog", { p_user_id: userId, p_kind: kind, p_value: value });
  if (error?.code === "22023" || error?.code === "23505") throw badRequest("Catalog requires valid unique record ids");
  if (error) throw supabaseError(error.message);
}

export async function listRecent(userId: string): Promise<Json[]> {
  const { data, error } = await admin
    .from("recent_projects")
    .select("*")
    .eq("user_id", userId)
    .order("opened_at", { ascending: false })
    .limit(20);
  if (error) throw supabaseError(error.message);
  return (data ?? []).map((r) => r.payload);
}

export async function addRecent(userId: string, payload: Json): Promise<Json[]> {
  const projectId = asString(asObject(payload)?.["projectId"]);
  if (!projectId) throw badRequest("最近项目缺少 projectId");
  await assertProjectOwnership(userId, projectId);
  const { error } = await admin
    .from("recent_projects")
    .upsert(
      { user_id: userId, project_id: projectId, opened_at: Date.now(), payload },
      { onConflict: "user_id,project_id" },
    );
  if (error) throw supabaseError(error.message);
  return listRecent(userId);
}

export async function removeRecent(userId: string, projectId: string): Promise<Json[]> {
  const { error } = await admin
    .from("recent_projects")
    .delete()
    .eq("user_id", userId)
    .eq("project_id", projectId);
  if (error) throw supabaseError(error.message);
  return listRecent(userId);
}

// ---------------------------------------------------------------------------
// 恢复记录、剪贴板、工作区会话
// ---------------------------------------------------------------------------
export async function loadRecovery(userId: string, kind: string): Promise<Json | null> {
  const { data, error } = await admin
    .from("recovery_records")
    .select("payload")
    .eq("user_id", userId)
    .eq("kind", kind)
    .maybeSingle();
  if (error) throw supabaseError(error.message);
  return data?.payload ?? null;
}

export async function saveRecovery(userId: string, kind: string, payload: Json): Promise<void> {
  const { error } = await admin
    .from("recovery_records")
    .upsert({ user_id: userId, kind, payload }, { onConflict: "user_id,kind" });
  if (error) throw supabaseError(error.message);
}

export async function loadClipboard(userId: string, id: string): Promise<Json | null> {
  const { data, error } = await admin
    .from("clipboard_records")
    .select("payload")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw supabaseError(error.message);
  return data?.payload ?? null;
}

export async function saveClipboard(userId: string, id: string, payload: Json): Promise<void> {
  const { error } = await admin
    .from("clipboard_records")
    .upsert({ user_id: userId, id, payload }, { onConflict: "user_id,id" });
  if (error) throw supabaseError(error.message);
}

export async function workspaceProject(userId: string, label: string): Promise<string | null> {
  const { data, error } = await admin
    .from("workspace_sessions")
    .select("project_id")
    .eq("user_id", userId)
    .eq("window_label", label)
    .maybeSingle();
  if (error) throw supabaseError(error.message);
  return data?.project_id ?? null;
}

export async function bindWorkspaceProject(
  userId: string,
  label: string,
  projectId: string | null,
): Promise<void> {
  if (projectId) await assertProjectOwnership(userId, projectId);
  const { error } = await admin
    .from("workspace_sessions")
    .upsert({ user_id: userId, window_label: label, project_id: projectId }, { onConflict: "user_id,window_label" });
  if (error) throw supabaseError(error.message);
}
