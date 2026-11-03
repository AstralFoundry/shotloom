use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "materials")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub position: i32,
    pub file_path: Option<String>,
    pub payload: Json,
}
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}

impl ActiveModel {
    pub fn record(id: String, position: i32, payload: Json) -> Self {
        Self { file_path: sea_orm::Set(payload.get("filePath").or_else(|| payload.get("path")).and_then(serde_json::Value::as_str).map(str::to_owned)), id: sea_orm::Set(id), position: sea_orm::Set(position), payload: sea_orm::Set(payload) }
    }
}
