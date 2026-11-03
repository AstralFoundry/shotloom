use crate::localized_error::localized_error;
use sea_orm::{ActiveModelTrait, ColumnTrait, ConnectionTrait, DbErr, EntityTrait, QueryFilter, Set};
use serde_json::{json, Value};
use crate::models::setting;

pub async fn load(db: &impl ConnectionTrait) -> Result<Value, DbErr> {
    let mut value = serde_json::Map::new();
    for row in setting::Entity::find().all(db).await? { value.insert(row.key, row.payload); }
    Ok(Value::Object(value))
}
pub async fn save(db: &impl ConnectionTrait, value: Value) -> Result<(), DbErr> {
    let fields = value.as_object().ok_or_else(|| DbErr::Custom(localized_error("native.storage.b9d0cbaaeb", json!({}), "设置必须是对象".into())))?;
    // Download location has its own IPC owner; a settings form snapshot must
    // neither erase it nor overwrite it with a stale copy.
    setting::Entity::delete_many().filter(setting::Column::Key.ne("downloadDirectory")).exec(db).await?;
    for (key, payload) in fields {
        if key == "downloadDirectory" { continue; }
        setting::ActiveModel { key: Set(key.clone()), payload: Set(payload.clone()) }.insert(db).await?;
    }
    Ok(())
}

pub async fn field(db: &impl ConnectionTrait, key: &str) -> Result<Option<Value>, DbErr> {
    Ok(setting::Entity::find_by_id(key).one(db).await?.map(|row| row.payload))
}
pub async fn set_field(db: &impl ConnectionTrait, key: &str, payload: Value) -> Result<(), DbErr> {
    let exists = setting::Entity::find_by_id(key).one(db).await?.is_some();
    let row = setting::ActiveModel { key: Set(key.to_owned()), payload: Set(payload) };
    if exists { row.update(db).await?; } else { row.insert(db).await?; }
    Ok(())
}
