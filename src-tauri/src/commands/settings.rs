use super::common::localized_error;
use super::common::{chrono_stamp, user_file};
use crate::services::storage_service::{self, APP_DATABASE};
use serde_json::{json, Value};
use tauri::AppHandle;

const SETTINGS_STORAGE_VERSION: u64 = 7;

fn current_settings_defaults() -> Value {
    let mut settings = json!({
        "storageVersion": SETTINGS_STORAGE_VERSION,
        "providerConfigs": {},
        "tokenGroups": [],
        "agentCanRunNodes": false,
        "canvasActionShortcuts": {},
    });
    let configured: Value = serde_json::from_str(include_str!("../../../renderer/src/config/shotloom-defaults.generated.json"))
        .expect("generated Shotloom defaults must be valid JSON");
    if let (Some(base), Some(fields)) = (settings.as_object_mut(), configured["appSettings"].as_object()) {
        base.extend(fields.clone());
    }
    settings
}

fn validate_current_settings(settings: &Value) -> Result<(), String> {
    if !settings.is_object() {
        return Err(localized_error("native.settings.invalid", json!({}), "设置数据格式无效：必须是 JSON 对象".into()));
    }
    let version = settings
        .get("storageVersion")
        .and_then(Value::as_u64)
        .ok_or_else(|| localized_error("native.settings.versionMissing", json!({}), "设置数据缺少 storageVersion".into()))?;
    if version != SETTINGS_STORAGE_VERSION {
        return Err(localized_error("native.settings.versionUnsupported", json!({"expected": SETTINGS_STORAGE_VERSION, "actual": version}), format!("设置数据版本不受支持：需要 v{SETTINGS_STORAGE_VERSION}，实际为 v{version}")));
    }
    Ok(())
}

#[tauri::command]
pub fn platform() -> Value {
    json!(std::env::consts::OS)
}

#[tauri::command]
pub fn settings_get(app: AppHandle) -> Result<Value, String> {
    let settings = storage_service::settings(&user_file(&app, APP_DATABASE)?, &current_settings_defaults())?;
    validate_current_settings(&settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn settings_set(app: AppHandle, mut settings: Value) -> Result<Value, String> {
    validate_current_settings(&settings)?;
    settings["updatedAt"] = json!(chrono_stamp());
    storage_service::save_settings(&user_file(&app, APP_DATABASE)?, &settings)?;
    crate::native_ui::sync(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn settings_set_token_group(app: AppHandle, id: Value) -> Result<Value, String> {
    storage_service::set_token_group(&user_file(&app, APP_DATABASE)?, id, current_settings_defaults())
}

#[tauri::command]
pub fn storage_get(app: AppHandle, name: String, fallback: Value) -> Result<Value, String> {
    storage_service::catalog(&user_file(&app, APP_DATABASE)?, &name, fallback)
}

#[tauri::command]
pub fn storage_set(app: AppHandle, name: String, value: Value) -> Result<Value, String> {
    storage_service::save_catalog(&user_file(&app, APP_DATABASE)?, &name, &value)?;
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_errors_expose_stable_translation_keys_and_parameters() {
        let invalid: Value = serde_json::from_str(&validate_current_settings(&json!([])).unwrap_err()).unwrap();
        assert_eq!(invalid["type"], "shotloom:localized-error");
        assert_eq!(invalid["key"], "native.settings.invalid");
        let missing: Value = serde_json::from_str(&validate_current_settings(&json!({})).unwrap_err()).unwrap();
        assert_eq!(missing["key"], "native.settings.versionMissing");
        let unsupported: Value = serde_json::from_str(&validate_current_settings(&json!({"storageVersion": 0})).unwrap_err()).unwrap();
        assert_eq!(unsupported["key"], "native.settings.versionUnsupported");
        assert_eq!(unsupported["params"]["expected"], SETTINGS_STORAGE_VERSION);
        assert_eq!(unsupported["params"]["actual"], 0);
        assert!(unsupported["fallback"].as_str().is_some());
    }

    #[test]
    fn settings_validator_rejects_legacy_schema_versions() {
        assert!(validate_current_settings(&current_settings_defaults()).is_ok());
        assert!(validate_current_settings(&json!({ "storageVersion": 6 })).is_err());
        assert!(validate_current_settings(&json!({})).is_err());
    }
}

#[tauri::command]
pub fn workspace_project_get(app: AppHandle, window: tauri::Window) -> Result<Option<String>, String> {
    storage_service::window_project(&user_file(&app, APP_DATABASE)?, window.label())
}
#[tauri::command]
pub fn workspace_project_set(app: AppHandle, window: tauri::Window, directory: Option<String>) -> Result<(), String> {
    storage_service::bind_window_project(&user_file(&app, APP_DATABASE)?, window.label(), directory)
}
#[tauri::command]
pub fn download_directory_get(app: AppHandle) -> Result<Value, String> {
    storage_service::download_directory(&user_file(&app, APP_DATABASE)?)
}
#[tauri::command]
pub fn download_directory_set(app: AppHandle, directory: String) -> Result<(), String> {
    storage_service::set_download_directory(&user_file(&app, APP_DATABASE)?, directory)
}
