use sea_orm::{ActiveModelTrait, ConnectionTrait, DbErr, EntityTrait, Set};
use crate::models::workspace_session;
pub async fn project_dir(db: &impl ConnectionTrait, label: &str) -> Result<Option<String>, DbErr> {
    Ok(workspace_session::Entity::find_by_id(label).one(db).await?.and_then(|row| row.project_dir))
}
pub async fn set_project_dir(db: &impl ConnectionTrait, label: &str, directory: Option<String>) -> Result<(), DbErr> {
    let exists = workspace_session::Entity::find_by_id(label).one(db).await?.is_some();
    let row = workspace_session::ActiveModel { window_label: Set(label.to_owned()), project_dir: Set(directory) };
    if exists { row.update(db).await?; } else { row.insert(db).await?; }
    Ok(())
}
