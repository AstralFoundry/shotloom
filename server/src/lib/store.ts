import { admin } from "./supabase";
import { badRequest, conflict, notFound, supabaseError } from "./errors";
import type { Json, JsonObject } from "./types";
import type {
  ProjectCollectionRow,
  CanvasHistoryRow,
  EditorSnapshotRow,
  EditorRecordRow,
  SettingRow,
  UserCollectionRow,
  RecentProjectRow,
  RecoveryRecordRow,
  ProjectCollectionTable,
  UserCollectionTable,
} from "./database";

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------
function asString(v: Json | null | undefined): string | null {
  return typeof v === "string" ? v : null;
}
function asArray(v: Json | null | undefined): Json[] {
  return Array.isArray(v) ? v : [];
}
function asObject(v: Json | null | undefined): JsonObject | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as JsonObject) : null;
}
function jsonEqual(a: Json, b: Json): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// 项目级集合：表名 → 画布 JSON 键（与 project_crud.rs collections! 宏对齐）
const PROJECT_COLLECTIONS: ReadonlyArray<{ table: ProjectCollectionTable; key: string }> = [
  { table: "nodes", key: "nodes" },
  { table: "edges", key: "edges" },
  { table: "tasks", key: "tasks" },
  { table: "assets", key: "assets" },
  { table: "materials", key: "materials" },
  { table: "conversations", key: "harnessSessions" },
  { table: "production_plans", key: "productionPlans" },
  { table: "agent_batches", key: "agentBatches" },
  { table: "agent_evaluations", key: "agentEvaluations" },
];

const COLLECTION_KEYS = new Set<string>([
  ...PROJECT_COLLECTIONS.map((c) => c.key),
  "canvasHistory",
  "canvasRedoStack",
  "storageRevision",
]);

// ---------------------------------------------------------------------------
// 项目（画布图数据）
// ---------------------------------------------------------------------------
async function loadCollection(projectId: string, table: ProjectCollectionTable): Promise<ProjectCollectionRow[]> {
  const { data, error } = await admin
    .from(table)
    .select("*")
    .eq("project_id", projectId)
    .order("position");
  if (error) throw supabaseError(error.message);
  return data ?? [];
}

async function saveCollection(projectId: string, table: ProjectCollectionTable, rows: Json[]): Promise<void> {
  const current = await loadCollection(projectId, table);
  const byId = new Map(current.map((r) => [r.id, r]));
  const retained = new Set<string>();

  for (let position = 0; position < rows.length; position++) {
    const payload = rows[position]!;
    const id = asString(asObject(payload)?.["id"]);
    if (!id) throw badRequest(`${table} 记录缺少稳定 id`);
    if (retained.has(id)) throw conflict(`${table} 存在重复 id：${id}`);
    retained.add(id);

    const old = byId.get(id);
    if (old && (!jsonEqual(old.payload, payload) || old.position !== position)) {
      const { error } = await admin
        .from(table)
        .update({ payload, position })
        .eq("project_id", projectId)
        .eq("id", id);
      if (error) throw supabaseError(error.message);
    } else if (!old) {
      const { error } = await admin
        .from(table)
        .insert({ project_id: projectId, id, position, payload });
      if (error) throw supabaseError(error.message);
    }
  }

  for (const id of byId.keys()) {
    if (!retained.has(id)) {
      const { error } = await admin
        .from(table)
        .delete()
        .eq("project_id", projectId)
        .eq("id", id);
      if (error) throw supabaseError(error.message);
    }
  }
}

async function loadHistory(projectId: string, stack: string): Promise<CanvasHistoryRow[]> {
  const { data, error } = await admin
    .from("canvas_history")
    .select("*")
    .eq("project_id", projectId)
    .eq("stack", stack)
    .order("position");
  if (error) throw supabaseError(error.message);
  return data ?? [];
}

async function saveHistory(projectId: string, stack: string, entries: Json | undefined): Promise<void> {
  const rows = asArray(entries);
  const existing = await loadHistory(projectId, stack);
  for (let position = 0; position < rows.length; position++) {
    const payload = rows[position]!;
    const old = existing.find((r) => r.position === position);
    if (old) {
      if (!jsonEqual(old.payload, payload)) {
        const { error } = await admin
          .from("canvas_history")
          .update({ payload })
          .eq("project_id", projectId)
          .eq("stack", stack)
          .eq("position", position);
        if (error) throw supabaseError(error.message);
      }
    } else {
      const { error } = await admin
        .from("canvas_history")
        .insert({ project_id: projectId, stack, position, payload });
      if (error) throw supabaseError(error.message);
    }
  }
  const { error } = await admin
    .from("canvas_history")
    .delete()
    .eq("project_id", projectId)
    .eq("stack", stack)
    .gte("position", rows.length);
  if (error) throw supabaseError(error.message);
}

export async function loadProject(userId: string, projectId: string): Promise<Json | null> {
  const { data: project, error } = await admin
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw supabaseError(error.message);
  if (!project) return null;

  const value: JsonObject = asObject(project.payload) ?? {};
  value["storageRevision"] = Number(project.revision);
  for (const { table, key } of PROJECT_COLLECTIONS) {
    value[key] = (await loadCollection(projectId, table)).map((r) => r.payload);
  }
  value["canvasHistory"] = (await loadHistory(projectId, "undo")).map((r) => r.payload);
  value["canvasRedoStack"] = (await loadHistory(projectId, "redo")).map((r) => r.payload);
  return value;
}

export async function saveProject(userId: string, projectId: string, value: Json): Promise<Json> {
  const obj = asObject(value);
  if (!obj) throw badRequest("项目数据必须是对象");

  const { data: current, error: readErr } = await admin
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (readErr) throw supabaseError(readErr.message);

  const revision = current ? Number(current.revision) : 0;
  const expected = obj["storageRevision"];
  if (typeof expected === "number" && expected !== revision) {
    throw conflict("工程已被另一窗口修改，请重新打开后再保存");
  }

  for (const { table, key } of PROJECT_COLLECTIONS) {
    await saveCollection(projectId, table, asArray(obj[key]));
  }
  await saveHistory(projectId, "undo", obj["canvasHistory"]);
  await saveHistory(projectId, "redo", obj["canvasRedoStack"]);

  const metadata: JsonObject = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!COLLECTION_KEYS.has(k)) metadata[k] = v;
  }

  const name = asString(obj["name"]) ?? "";
  const newRevision = revision + 1;
  if (current) {
    const { error } = await admin
      .from("projects")
      .update({ name, revision: newRevision, payload: metadata })
      .eq("id", projectId)
      .eq("user_id", userId);
    if (error) throw supabaseError(error.message);
  } else {
    const { error } = await admin
      .from("projects")
      .insert({ id: projectId, user_id: userId, name, revision: newRevision, payload: metadata });
    if (error) throw supabaseError(error.message);
  }

  const result: JsonObject = { ...obj };
  result["storageRevision"] = newRevision;
  return result;
}

export async function listProjects(userId: string): Promise<Json[]> {
  const { data, error } = await admin
    .from("projects")
    .select("id, name, revision, updated_at, payload")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw supabaseError(error.message);
  return (data ?? []).map((r) => {
    const meta = asObject(r.payload) ?? {};
    return {
      ...meta,
      id: r.id,
      name: r.name,
      storageRevision: Number(r.revision),
      updatedAt: r.updated_at,
    };
  });
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
  const old = await admin
    .from("editor_snapshots")
    .select("revision")
    .eq("project_id", projectId)
    .eq("node_id", nodeId)
    .maybeSingle();
  if (old.error) throw supabaseError(old.error.message);
  const revision = old.data ? old.data.revision + 1 : 1;

  if (old.data) {
    const { error } = await admin
      .from("editor_snapshots")
      .update({ payload, revision })
      .eq("project_id", projectId)
      .eq("node_id", nodeId);
    if (error) throw supabaseError(error.message);
  } else {
    const { error } = await admin
      .from("editor_snapshots")
      .insert({ project_id: projectId, node_id: nodeId, revision, payload });
    if (error) throw supabaseError(error.message);
  }
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
  const obj = asObject(value);
  if (!obj) throw badRequest("设置必须是对象");
  // downloadDirectory 由独立接口管理，全量保存不得覆盖或擦除。
  const { error: delErr } = await admin
    .from("settings")
    .delete()
    .eq("user_id", userId)
    .neq("key", "downloadDirectory");
  if (delErr) throw supabaseError(delErr.message);
  const rows = Object.entries(obj)
    .filter(([k]) => k !== "downloadDirectory")
    .map(([key, payload]) => ({ user_id: userId, key, payload }));
  if (rows.length > 0) {
    const { error } = await admin.from("settings").insert(rows);
    if (error) throw supabaseError(error.message);
  }
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
const CATALOG_TABLES: Record<string, { table: UserCollectionTable; key: string; scope: string }> = {
  skills: { table: "skills", key: "skills", scope: "skills" },
  recipes: { table: "recipes", key: "recipes", scope: "recipes" },
  assets: { table: "catalog_assets", key: "assets", scope: "assets" },
  materials: { table: "catalog_materials", key: "materials", scope: "materials" },
};

async function loadCatalogMetadata(userId: string, scope: string): Promise<JsonObject | null> {
  const { data, error } = await admin
    .from("catalog_metadatas")
    .select("payload")
    .eq("user_id", userId)
    .eq("scope", scope)
    .maybeSingle();
  if (error) throw supabaseError(error.message);
  return asObject(data?.payload);
}

async function saveCatalogMetadata(userId: string, scope: string, payload: Json): Promise<void> {
  const { error } = await admin
    .from("catalog_metadatas")
    .upsert({ user_id: userId, scope, payload }, { onConflict: "user_id,scope" });
  if (error) throw supabaseError(error.message);
}

async function loadCatalogRows(userId: string, table: UserCollectionTable): Promise<UserCollectionRow[]> {
  const { data, error } = await admin
    .from(table)
    .select("*")
    .eq("user_id", userId)
    .order("position");
  if (error) throw supabaseError(error.message);
  return data ?? [];
}

async function saveCatalogRows(userId: string, table: UserCollectionTable, rows: Json[]): Promise<void> {
  const { error: delErr } = await admin.from(table).delete().eq("user_id", userId);
  if (delErr) throw supabaseError(delErr.message);
  const inserts: Array<{ user_id: string; id: string; position: number; payload: Json }> = [];
  for (let position = 0; position < rows.length; position++) {
    const payload = rows[position]!;
    const id = asString(asObject(payload)?.["id"]);
    if (!id) throw badRequest(`${table} 记录缺少 id`);
    inserts.push({ user_id: userId, id, position, payload });
  }
  if (inserts.length > 0) {
    const { error } = await admin.from(table).insert(inserts);
    if (error) throw supabaseError(error.message);
  }
}

export async function loadCatalog(userId: string, kind: string, fallback: Json): Promise<Json> {
  const spec = CATALOG_TABLES[kind];
  if (!spec) throw badRequest(`未知目录：${kind}`);

  if (kind === "assets") {
    const meta = await loadCatalogMetadata(userId, "assets");
    if (!meta) return fallback;
    meta["assets"] = (await loadCatalogRows(userId, "catalog_assets")).map((r) => r.payload);
    const matMeta = await loadCatalogMetadata(userId, "materials");
    if (matMeta) meta["materials"] = matMeta["materials"] ?? [];
    return meta;
  }

  const meta = await loadCatalogMetadata(userId, spec.scope);
  if (!meta) return fallback;
  meta[spec.key] = (await loadCatalogRows(userId, spec.table)).map((r) => r.payload);
  return meta;
}

export async function saveCatalog(userId: string, kind: string, value: Json): Promise<void> {
  const spec = CATALOG_TABLES[kind];
  if (!spec) throw badRequest(`未知目录：${kind}`);

  if (kind === "assets") {
    const obj = asObject(value);
    if (!obj) throw badRequest("素材目录必须是对象");
    const assetsMeta: JsonObject = { ...obj };
    delete assetsMeta["materials"];
    const materials: Json = { materials: obj["materials"] ?? [] };
    await saveCatalogRows(userId, "catalog_assets", asArray(obj["assets"]));
    await saveCatalogMetadata(userId, "assets", assetsMeta);
    const matMeta = asObject(materials)!;
    await saveCatalogRows(userId, "catalog_materials", asArray(matMeta["materials"]));
    await saveCatalogMetadata(userId, "materials", materials);
    return;
  }

  const obj = asObject(value);
  if (!obj) throw badRequest("目录必须是对象");
  await saveCatalogRows(userId, spec.table, asArray(obj[spec.key]));
  const meta: JsonObject = { ...obj };
  delete meta[spec.key];
  await saveCatalogMetadata(userId, spec.scope, meta);
}

// ---------------------------------------------------------------------------
// 最近项目
// ---------------------------------------------------------------------------
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
  const { error } = await admin
    .from("workspace_sessions")
    .upsert({ user_id: userId, window_label: label, project_id: projectId }, { onConflict: "user_id,window_label" });
  if (error) throw supabaseError(error.message);
}
