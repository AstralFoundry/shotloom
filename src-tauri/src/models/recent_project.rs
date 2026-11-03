use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "recent_projects")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub file_path: String,
    pub opened_at: i64,
    pub payload: Json,
}
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}
