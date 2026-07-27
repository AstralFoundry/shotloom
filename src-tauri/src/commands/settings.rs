use super::common::{chrono_stamp, read_json, user_file, write_json};
use serde_json::{json, Value};
use tauri::AppHandle;

#[tauri::command]
pub fn platform() -> Value {
    json!(std::env::consts::OS)
}

#[tauri::command]
pub fn settings_get(app: AppHandle) -> Result<Value, String> {
    read_json(&user_file(&app, "app-settings.json")?, json!({}))
}

#[tauri::command]
pub fn settings_set(app: AppHandle, mut settings: Value) -> Result<Value, String> {
    settings["storageVersion"] = json!(5);
    settings["updatedAt"] = json!(chrono_stamp());
    write_json(&user_file(&app, "app-settings.json")?, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn settings_set_token_group(app: AppHandle, id: Value) -> Result<Value, String> {
    let path = user_file(&app, "app-settings.json")?;
    let mut settings = read_json(&path, json!({}))?;
    settings["activeTokenGroupId"] = id;
    settings["updatedAt"] = json!(chrono_stamp());
    write_json(&path, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn storage_get(app: AppHandle, name: String, fallback: Value) -> Result<Value, String> {
    read_json(&user_file(&app, &name)?, fallback)
}

#[tauri::command]
pub fn storage_set(app: AppHandle, name: String, value: Value) -> Result<Value, String> {
    write_json(&user_file(&app, &name)?, &value)?;
    Ok(value)
}
