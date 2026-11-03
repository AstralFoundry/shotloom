use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "agent_batchs")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub position: i32,
    pub name: String,
    pub payload: Json,
}
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}

impl ActiveModel {
    pub fn record(id: String, position: i32, payload: Json) -> Self {
        Self { name: sea_orm::Set(payload["name"].as_str().unwrap_or("").to_owned()), id: sea_orm::Set(id), position: sea_orm::Set(position), payload: sea_orm::Set(payload) }
    }
}
