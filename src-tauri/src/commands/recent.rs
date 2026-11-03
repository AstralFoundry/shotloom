use super::common::localized_error;
use super::common::user_file;
use crate::services::storage_service::{self, APP_DATABASE};
use serde_json::{json, Value};
use tauri::AppHandle;

#[tauri::command]
pub fn recent_list(app: AppHandle) -> Result<Value, String> {
    storage_service::recent(&user_file(&app, APP_DATABASE)?)
}
#[tauri::command]
pub fn recent_add(app: AppHandle, project: Value) -> Result<Value, String> {
    storage_service::add_recent(&user_file(&app, APP_DATABASE)?, project)
}
#[tauri::command]
pub fn recent_remove(app: AppHandle, path: Value) -> Result<Value, String> {
    storage_service::remove_recent(&user_file(&app, APP_DATABASE)?, path.as_str().ok_or_else(|| localized_error("native.error.1c35fef9cd", json!({}), "项目路径无效".into()))?)
}
