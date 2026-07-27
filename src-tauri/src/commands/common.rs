use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

pub const PROJECT_FILE: &str = "project.shotloom.json";

pub fn app_data(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

pub fn user_file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    Ok(app_data(app)?.join(name))
}

pub fn read_json(path: &Path, fallback: Value) -> Result<Value, String> {
    if !path.exists() {
        return Ok(fallback);
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

pub fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let content = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    let temp = path.with_extension("tmp");
    fs::write(&temp, content).map_err(|error| error.to_string())?;
    fs::rename(temp, path).map_err(|error| error.to_string())
}

pub fn sanitize_name(value: &str, fallback: &str) -> String {
    let sanitized = value
        .trim()
        .replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "-");
    if sanitized.is_empty() {
        fallback.to_string()
    } else {
        sanitized
    }
}

pub fn unique_dir(parent: &Path, preferred: &str) -> PathBuf {
    let preferred = sanitize_name(preferred, "未命名项目");
    let mut target = parent.join(&preferred);
    for index in 2..10_000 {
        if !target.exists() {
            break;
        }
        target = parent.join(format!("{preferred}-{index}"));
    }
    if target.exists() {
        parent.join(format!("{preferred}-copy"))
    } else {
        target
    }
}

pub fn copy_dir(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        if source_path.is_dir() {
            copy_dir(&source_path, &target_path)?;
        } else {
            fs::copy(source_path, target_path).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

pub fn file_result(path: &Path) -> Result<Value, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    Ok(serde_json::json!({
        "filePath": path.to_string_lossy(), "path": path.to_string_lossy(),
        "name": path.file_name().and_then(|name| name.to_str()).unwrap_or_default(), "size": metadata.len()
    }))
}

pub fn chrono_stamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis().to_string())
        .unwrap_or_default()
}
