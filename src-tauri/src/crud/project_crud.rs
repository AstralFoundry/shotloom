use crate::localized_error::localized_error;
use sea_orm::{ActiveModelTrait, ConnectionTrait, DbErr, EntityTrait, QueryOrder, Set};
use serde_json::{json, Value};
use crate::models::{project, node, edge, task, asset, material, conversation, editor_snapshot, production_plan, agent_batch, agent_evaluation};

macro_rules! collections {
    ($action:ident, $db:expr, $value:expr) => {
        $action!($db, $value, node, "nodes");
        $action!($db, $value, edge, "edges");
        $action!($db, $value, task, "tasks");
        $action!($db, $value, asset, "assets");
        $action!($db, $value, material, "materials");
        $action!($db, $value, conversation, "harnessSessions");
        $action!($db, $value, production_plan, "productionPlans");
        $action!($db, $value, agent_batch, "agentBatches");
        $action!($db, $value, agent_evaluation, "agentEvaluations");
    }
}
macro_rules! load_rows {
    ($db:expr, $value:expr, $model:ident, $key:expr) => {
        $value[$key] = Value::Array($model::Entity::find().order_by_asc($model::Column::Position).all($db).await?.into_iter().map(|row| row.payload).collect());
    }
}
macro_rules! save_rows {
    ($db:expr, $value:expr, $model:ident, $key:expr) => {{
        let rows = $value.get($key).and_then(Value::as_array).cloned().unwrap_or_default();
        let current = $model::Entity::find().all($db).await?.into_iter().map(|row| (row.id.clone(), row)).collect::<std::collections::HashMap<_, _>>();
        let mut retained = std::collections::HashSet::new();
        for (position, payload) in rows.into_iter().enumerate() {
            let id = payload.get("id").and_then(Value::as_str).filter(|id| !id.is_empty()).ok_or_else(|| DbErr::Custom(localized_error("native.storage.67d9a58c03", json!({"collection": $key}), format!("{}记录缺少稳定 id", $key))))?.to_owned();
            if !retained.insert(id.clone()) { return Err(DbErr::Custom(localized_error("native.storage.247978142c", json!({"collection": $key, "id": id}), format!("{}存在重复 id：{}", $key, id)))); }
            let position = position as i32;
            if let Some(old) = current.get(&id) {
                if old.payload != payload || old.position != position {
                    $model::ActiveModel::record(id, position, payload).update($db).await?;
                }
            } else {
                $model::ActiveModel::record(id, position, payload).insert($db).await?;
            }
        }
        for id in current.keys().filter(|id| !retained.contains(*id)) { $model::Entity::delete_by_id(id.clone()).exec($db).await?; }
    }}
}

pub async fn load(db: &impl ConnectionTrait) -> Result<Option<Value>, DbErr> {
    let Some(row) = project::Entity::find_by_id(1).one(db).await? else { return Ok(None); };
    let mut value = row.payload;
    value["storageRevision"] = json!(row.revision);
    collections!(load_rows, db, value);
    value["canvasHistory"] = history(db, "undo").await?;
    value["canvasRedoStack"] = history(db, "redo").await?;
    Ok(Some(value))
}

/// Caller owns the transaction; changed records are updated individually.
pub async fn save(db: &impl ConnectionTrait, value: Value) -> Result<Value, DbErr> {
    let current = project::Entity::find_by_id(1).one(db).await?;
    let revision = current.as_ref().map_or(0, |row| row.revision);
    if let Some(expected) = value.get("storageRevision").and_then(Value::as_i64) {
        if expected != revision { return Err(DbErr::Custom(localized_error("native.storage.7a2275e121", json!({}), "工程已被另一窗口修改，请重新打开后再保存".into()))); }
    }
    collections!(save_rows, db, value);
    save_history(db, "undo", value.get("canvasHistory")).await?;
    save_history(db, "redo", value.get("canvasRedoStack")).await?;
    let mut metadata = value.clone();
    for key in ["nodes", "edges", "tasks", "assets", "materials", "harnessSessions", "productionPlans", "agentBatches", "agentEvaluations", "canvasHistory", "canvasRedoStack", "storageRevision"] { metadata.as_object_mut().ok_or_else(|| DbErr::Custom(localized_error("native.storage.cfa8748391", json!({}), "项目数据无效".into())))?.remove(key); }
    let record = project::ActiveModel {
        id: Set(1), name: Set(value["name"].as_str().unwrap_or("").to_owned()),
        created_at: Set(value["createdAt"].as_str().unwrap_or("").to_owned()),
        updated_at: Set(value["updatedAt"].as_str().unwrap_or("").to_owned()),
        revision: Set(revision + 1), payload: Set(metadata),
    };
    if current.is_some() { record.update(db).await?; } else { record.insert(db).await?; }
    let mut result = value;
    result["storageRevision"] = json!(revision + 1);
    Ok(result)
}

pub async fn snapshot(db: &impl ConnectionTrait, node_id: &str) -> Result<Option<Value>, DbErr> {
    Ok(editor_snapshot::Entity::find_by_id(node_id).one(db).await?.map(|row| row.payload))
}
pub async fn save_snapshot(db: &impl ConnectionTrait, node_id: &str, payload: Value) -> Result<(), DbErr> {
    let old = editor_snapshot::Entity::find_by_id(node_id).one(db).await?;
    let revision = old.as_ref().map_or(1, |row| row.revision + 1);
    let record = editor_snapshot::ActiveModel { node_id: Set(node_id.to_owned()), payload: Set(payload), revision: Set(revision) };
    if old.is_some() { record.update(db).await?; } else { record.insert(db).await?; }
    Ok(())
}

pub async fn editor_record(db: &impl ConnectionTrait, node_id: &str, key: &str) -> Result<Option<Value>, DbErr> {
    use crate::models::editor_record;
    Ok(editor_record::Entity::find_by_id((node_id.to_owned(), key.to_owned())).one(db).await?.map(|row| row.payload))
}
pub async fn set_editor_record(db: &impl ConnectionTrait, node_id: &str, key: &str, payload: Option<Value>) -> Result<(), DbErr> {
    use crate::models::editor_record;
    let old = editor_record::Entity::find_by_id((node_id.to_owned(), key.to_owned())).one(db).await?;
    if let Some(payload) = payload {
        let row = editor_record::ActiveModel { node_id: Set(node_id.into()), key: Set(key.into()), payload: Set(payload) };
        if old.is_some() { row.update(db).await?; } else { row.insert(db).await?; }
    } else { editor_record::Entity::delete_by_id((node_id.to_owned(), key.to_owned())).exec(db).await?; }
    Ok(())
}


async fn history(db: &impl ConnectionTrait, stack: &str) -> Result<Value, DbErr> {
    use sea_orm::{ColumnTrait, QueryFilter};
    use crate::models::canvas_history;
    Ok(Value::Array(canvas_history::Entity::find().filter(canvas_history::Column::Stack.eq(stack)).order_by_asc(canvas_history::Column::Position).all(db).await?.into_iter().map(|row| row.payload).collect()))
}
async fn save_history(db: &impl ConnectionTrait, stack: &str, entries: Option<&Value>) -> Result<(), DbErr> {
    use sea_orm::{ColumnTrait, QueryFilter};
    use crate::models::canvas_history;
    let existing=canvas_history::Entity::find().filter(canvas_history::Column::Stack.eq(stack)).all(db).await?;
    let rows=entries.and_then(Value::as_array).cloned().unwrap_or_default();
    for (position,payload) in rows.iter().enumerate() {
        let record=canvas_history::ActiveModel {stack:Set(stack.to_owned()),position:Set(position as i32),payload:Set(payload.clone())};
        if let Some(old)=existing.iter().find(|row|row.position==position as i32) {
            if old.payload!=*payload {record.update(db).await?;}
        } else {record.insert(db).await?;}
    }
    canvas_history::Entity::delete_many().filter(canvas_history::Column::Stack.eq(stack)).filter(canvas_history::Column::Position.gte(rows.len() as i32)).exec(db).await?;
    Ok(())
}

// ── 画布快照 ────────────────────────────────────────────────────────────────

/// 列表只返回元数据：payload 可能有几 MB，列表页不该把它们全部读进内存。
pub async fn project_snapshots(db: &impl ConnectionTrait) -> Result<Value, DbErr> {
    use crate::models::project_snapshot;
    let rows = project_snapshot::Entity::find()
        .order_by_desc(project_snapshot::Column::CreatedAt)
        .all(db)
        .await?;
    Ok(Value::Array(rows.into_iter().map(|row| json!({
        "id": row.id,
        "createdAt": row.created_at,
        "reason": row.reason,
        "contentHash": row.content_hash,
        "payloadBytes": row.payload_bytes,
        "mediaRefs": row.media_refs,
        "degraded": row.degraded,
    })).collect()))
}

pub async fn save_project_snapshot(db: &impl ConnectionTrait, record: Value) -> Result<Value, DbErr> {
    use crate::models::project_snapshot;
    let id = record.get("id").and_then(Value::as_str).filter(|id| !id.is_empty())
        .ok_or_else(|| DbErr::Custom("snapshot record is missing id".to_owned()))?
        .to_owned();
    let created_at = record.get("createdAt").and_then(Value::as_str).unwrap_or_default().to_owned();
    let reason = record.get("reason").and_then(Value::as_str).unwrap_or("auto").to_owned();
    let content_hash = record.get("contentHash").and_then(Value::as_str).unwrap_or_default().to_owned();
    let payload_bytes = record.get("payloadBytes").and_then(Value::as_i64).unwrap_or(0);
    let media_refs = record.get("mediaRefs").cloned().filter(Value::is_array).unwrap_or_else(|| json!([]));
    let degraded = record.get("degraded").and_then(Value::as_bool).unwrap_or(false);
    let payload = record.get("payload").cloned().filter(|value| !value.is_null());
    project_snapshot::ActiveModel::record(id, created_at, reason, content_hash, payload_bytes, media_refs, degraded, payload)
        .insert(db)
        .await?;
    prune_project_snapshots(db, SNAPSHOT_LIMIT).await?;
    Ok(json!({"saved": true}))
}

pub async fn project_snapshot_payload(db: &impl ConnectionTrait, id: &str) -> Result<Value, DbErr> {
    use crate::models::project_snapshot;
    Ok(project_snapshot::Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .and_then(|row| row.payload)
        .unwrap_or(Value::Null))
}

/// 只保留最近 `limit` 份。快照表按时间排序，删除顺序与展示顺序一致。
pub async fn prune_project_snapshots(db: &impl ConnectionTrait, limit: usize) -> Result<(), DbErr> {
    use crate::models::project_snapshot;
    let stale = project_snapshot::Entity::find()
        .order_by_desc(project_snapshot::Column::CreatedAt)
        .all(db)
        .await?
        .into_iter()
        .skip(limit)
        .map(|row| row.id)
        .collect::<Vec<_>>();
    for id in stale {
        project_snapshot::Entity::delete_by_id(id).exec(db).await?;
    }
    Ok(())
}

/// 每个项目保留的快照数量。与前端 `SNAPSHOT_LIMIT` 保持一致。
pub const SNAPSHOT_LIMIT: usize = 20;
