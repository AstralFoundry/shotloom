use serde_json::Value;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

pub const PROJECT_FILE: &str = "project.shotloom.json";
static WRITE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

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
    match serde_json::from_str(&content) {
        Ok(value) => Ok(value),
        Err(error) => {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis();
            let file_name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("storage.json");
            let backup = path.with_file_name(format!(
                "{file_name}.corrupt-{stamp}-{}",
                std::process::id()
            ));
            fs::rename(path, &backup).map_err(|backup_error| {
                format!(
                    "JSON 数据损坏且无法隔离原文件：{error}；备份失败：{backup_error}"
                )
            })?;
            eprintln!(
                "[storage-recovery] corrupt={} backup={} error={error}",
                path.display(),
                backup.display()
            );
            Ok(fallback)
        }
    }
}

pub fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let content = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    let temp = path.with_extension(format!(
        "tmp-{}-{}",
        std::process::id(),
        WRITE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|error| error.to_string())?;
    file.write_all(content.as_bytes()).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    drop(file);
    fs::rename(&temp, path).map_err(|error| {
        let _ = fs::remove_file(&temp);
        error.to_string()
    })?;
    #[cfg(unix)]
    if let Some(parent) = path.parent() {
        fs::File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| error.to_string())?;
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn test_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "shotloom-{name}-{}-{}",
            std::process::id(),
            chrono_stamp()
        ))
    }

    #[test]
    fn corrupt_json_is_quarantined_before_fallback_is_returned() {
        let dir = test_dir("corrupt-json");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("state.json");
        fs::write(&path, "{broken").unwrap();
        let recovered = read_json(&path, json!({ "safe": true })).unwrap();
        assert_eq!(recovered, json!({ "safe": true }));
        assert!(!path.exists());
        assert!(fs::read_dir(&dir).unwrap().flatten().any(|entry| {
            entry.file_name().to_string_lossy().starts_with("state.json.corrupt-")
        }));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn json_write_replaces_target_without_leaving_temp_file() {
        let dir = test_dir("atomic-json");
        let path = dir.join("state.json");
        write_json(&path, &json!({ "version": 1 })).unwrap();
        write_json(&path, &json!({ "version": 2 })).unwrap();
        assert_eq!(read_json(&path, Value::Null).unwrap(), json!({ "version": 2 }));
        assert_eq!(fs::read_dir(&dir).unwrap().flatten().count(), 1);
        fs::remove_dir_all(dir).unwrap();
    }
}
