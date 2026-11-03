use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tasks")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub position: i32,
    pub node_id: Option<String>,
    pub status: String,
    pub payload: Json,
}
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}

impl ActiveModel {
    pub fn record(id: String, position: i32, payload: Json) -> Self {
        Self { node_id: sea_orm::Set(payload["nodeId"].as_str().map(str::to_owned)), status: sea_orm::Set(payload["status"].as_str().unwrap_or("").to_owned()), id: sea_orm::Set(id), position: sea_orm::Set(position), payload: sea_orm::Set(payload) }
    }
}
