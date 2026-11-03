use crate::localized_error::localized_error;
use sea_orm::{ActiveModelTrait, ConnectionTrait, DbErr, EntityTrait, QueryOrder, QuerySelect, Set};
use serde_json::{json, Value};
use crate::models::recent_project;
pub async fn list(db: &impl ConnectionTrait) -> Result<Value, DbErr> {
    Ok(Value::Array(recent_project::Entity::find().order_by_desc(recent_project::Column::OpenedAt).limit(20).all(db).await?.into_iter().map(|row| row.payload).collect()))
}
pub async fn upsert(db: &impl ConnectionTrait, payload: Value) -> Result<(), DbErr> {
    let path = payload["filePath"].as_str().filter(|v| !v.is_empty()).ok_or_else(|| DbErr::Custom(localized_error("native.storage.f19026e6f4", json!({}), "最近项目缺少路径".into())))?.to_owned();
    let exists = recent_project::Entity::find_by_id(&path).one(db).await?.is_some();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_micros() as i64;
    let row = recent_project::ActiveModel { file_path: Set(path), opened_at: Set(now), payload: Set(payload) };
    if exists { row.update(db).await?; } else { row.insert(db).await?; }
    Ok(())
}
pub async fn remove(db: &impl ConnectionTrait, path: &str) -> Result<(), DbErr> {
    recent_project::Entity::delete_by_id(path).exec(db).await?; Ok(())
}
