use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "edges")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub position: i32,
    pub source: String,
    pub target: String,
    pub payload: Json,
}
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(belongs_to = "super::node::Entity", from = "Column::Source", to = "super::node::Column::Id", on_update = "Cascade", on_delete = "Cascade")]
    Source,
    #[sea_orm(belongs_to = "super::node::Entity", from = "Column::Target", to = "super::node::Column::Id", on_update = "Cascade", on_delete = "Cascade")]
    Target,
}
impl ActiveModelBehavior for ActiveModel {}

impl ActiveModel {
    pub fn record(id: String, position: i32, payload: Json) -> Self {
        Self { source: sea_orm::Set(payload["source"].as_str().unwrap_or("").to_owned()), target: sea_orm::Set(payload["target"].as_str().unwrap_or("").to_owned()), id: sea_orm::Set(id), position: sea_orm::Set(position), payload: sea_orm::Set(payload) }
    }
}
