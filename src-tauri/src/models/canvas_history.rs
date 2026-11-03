use sea_orm::entity::prelude::*;
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "canvas_history")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub stack: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub position: i32,
    pub payload: Json,
}
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}
