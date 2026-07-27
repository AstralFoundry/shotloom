use super::common::{read_json, user_file, write_json};
use serde_json::{json, Value};
use tauri::AppHandle;

#[tauri::command]
pub fn recent_list(app: AppHandle) -> Result<Value, String> {
    read_json(&user_file(&app, "recent-projects.json")?, json!([]))
}

#[tauri::command]
pub fn recent_add(app: AppHandle, project: Value) -> Result<Value, String> {
    let path = user_file(&app, "recent-projects.json")?;
    let mut recent = read_json(&path, json!([]))?
        .as_array()
        .cloned()
        .unwrap_or_default();
    let file_path = project.get("filePath").cloned();
    recent.retain(|entry| entry.get("filePath").cloned() != file_path);
    recent.insert(0, project);
    recent.truncate(20);
    let result = json!(recent);
    write_json(&path, &result)?;
    Ok(result)
}

#[tauri::command]
pub fn recent_remove(app: AppHandle, path: Value) -> Result<Value, String> {
    let store = user_file(&app, "recent-projects.json")?;
    let mut recent = read_json(&store, json!([]))?
        .as_array()
        .cloned()
        .unwrap_or_default();
    recent.retain(|entry| entry.get("filePath").cloned() != Some(path.clone()));
    let result = json!(recent);
    write_json(&store, &result)?;
    Ok(result)
}
