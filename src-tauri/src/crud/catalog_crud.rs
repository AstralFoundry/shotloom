use crate::localized_error::localized_error;
use sea_orm::{ActiveModelTrait, ConnectionTrait, DbErr, EntityTrait, QueryOrder, Set};
use serde_json::{json, Value};
use crate::models::{catalog_metadata, skill, recipe, asset, material};

pub async fn metadata(db: &impl ConnectionTrait, scope: &str) -> Result<Option<Value>, DbErr> {
    Ok(catalog_metadata::Entity::find_by_id(scope).one(db).await?.map(|row| row.payload))
}
pub async fn set_metadata(db: &impl ConnectionTrait, scope: &str, payload: Value) -> Result<(), DbErr> {
    let exists = catalog_metadata::Entity::find_by_id(scope).one(db).await?.is_some();
    let record = catalog_metadata::ActiveModel { scope: Set(scope.to_owned()), payload: Set(payload) };
    if exists { record.update(db).await?; } else { record.insert(db).await?; }
    Ok(())
}
macro_rules! catalog {
    ($load:ident, $save:ident, $model:ident, $key:literal, $scope:literal) => {
        pub async fn $load(db: &impl ConnectionTrait) -> Result<Option<Value>, DbErr> {
            let Some(mut value) = metadata(db, $scope).await? else { return Ok(None); };
            value[$key] = Value::Array($model::Entity::find().order_by_asc($model::Column::Position).all(db).await?.into_iter().map(|row| row.payload).collect());
            Ok(Some(value))
        }
        pub async fn $save(db: &impl ConnectionTrait, mut value: Value) -> Result<(), DbErr> {
            let rows = value.as_object_mut().ok_or_else(|| DbErr::Custom(localized_error("native.storage.1f02fc7c88", json!({}), "目录必须是对象".into())))?.remove($key).and_then(|v| v.as_array().cloned()).unwrap_or_default();
            $model::Entity::delete_many().exec(db).await?;
            for (position, payload) in rows.into_iter().enumerate() {
                let id = payload["id"].as_str().filter(|id| !id.is_empty()).ok_or_else(|| DbErr::Custom(localized_error("native.storage.fdc388af1b", json!({"collection": $key}), concat!($key, "记录缺少 id").into())))?.to_owned();
                $model::ActiveModel::record(id, position as i32, payload).insert(db).await?;
            }
            set_metadata(db, $scope, value).await
        }
    }
}
catalog!(skills, save_skills, skill, "skills", "skills");
catalog!(recipes, save_recipes, recipe, "recipes", "recipes");
catalog!(assets, save_assets, asset, "assets", "assets");
catalog!(materials, save_materials, material, "materials", "materials");
