use sea_orm::{ActiveModelTrait, ConnectionTrait, DbErr, EntityTrait, Set};
use serde_json::Value;
use crate::models::clipboard_record;
pub async fn load(db: &impl ConnectionTrait, key: &str) -> Result<Option<Value>, DbErr> {
    Ok(clipboard_record::Entity::find_by_id(key).one(db).await?.map(|row| row.payload))
}
pub async fn save(db: &impl ConnectionTrait, key: &str, payload: Value) -> Result<(), DbErr> {
    let exists = clipboard_record::Entity::find_by_id(key).one(db).await?.is_some();
    let row = clipboard_record::ActiveModel { id: Set(key.to_owned()), payload: Set(payload) };
    if exists { row.update(db).await?; } else { row.insert(db).await?; }
    Ok(())
}
