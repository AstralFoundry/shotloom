use super::common::{chrono_stamp, read_json, user_file, write_json};
use serde_json::{json, Value};
use tauri::AppHandle;

const SETTINGS_STORAGE_VERSION: u64 = 7;

fn current_settings_defaults() -> Value {
    json!({
        "storageVersion": SETTINGS_STORAGE_VERSION,
        "providerConfigs": {},
        "tokenGroups": [],
        "agentAutoEval": true,
        "agentAutoLayout": true,
        "agentCanRunNodes": false,
        "canvasActionShortcuts": {},
        "modelPollIntervalMs": 1500,
        "runtimeProtection": {
            "healthIntervalMs": 10_000,
            "failureThreshold": 3,
            "failureWindowMs": 300_000,
            "circuitCooldownMs": 120_000,
            "stallWarningMs": 180_000,
            "hardCapMs": 1_800_000
        }
    })
}

fn validate_current_settings(settings: &Value) -> Result<(), String> {
    if !settings.is_object() {
        return Err("设置数据格式无效：必须是 JSON 对象".into());
    }
    let version = settings
        .get("storageVersion")
        .and_then(Value::as_u64)
        .ok_or_else(|| "设置数据缺少 storageVersion".to_string())?;
    if version != SETTINGS_STORAGE_VERSION {
        return Err(format!(
            "设置数据版本不受支持：需要 v{SETTINGS_STORAGE_VERSION}，实际为 v{version}"
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn platform() -> Value {
    json!(std::env::consts::OS)
}

#[tauri::command]
pub fn settings_get(app: AppHandle) -> Result<Value, String> {
    let path = user_file(&app, "app-settings.json")?;
    let settings = read_json(&path, current_settings_defaults())?;
    validate_current_settings(&settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn settings_set(app: AppHandle, mut settings: Value) -> Result<Value, String> {
    validate_current_settings(&settings)?;
    settings["updatedAt"] = json!(chrono_stamp());
    write_json(&user_file(&app, "app-settings.json")?, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn settings_set_token_group(app: AppHandle, id: Value) -> Result<Value, String> {
    let path = user_file(&app, "app-settings.json")?;
    let mut settings = read_json(&path, current_settings_defaults())?;
    validate_current_settings(&settings)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_validator_rejects_legacy_schema_versions() {
        assert!(validate_current_settings(&current_settings_defaults()).is_ok());
        assert!(validate_current_settings(&json!({ "storageVersion": 6 })).is_err());
        assert!(validate_current_settings(&json!({})).is_err());
    }
}
