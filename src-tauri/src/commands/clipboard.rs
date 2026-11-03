use super::common::localized_error;
use super::common::{app_data, sanitize_name};
use serde_json::{json, Value};
use crate::services::storage_service;
use std::{fs, path::Path};
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

const SENTINEL_PREFIX: &str = "shotloom-workflow:";

fn valid_snapshot_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn stage_workflow(root: &Path, mut payload: Value) -> Result<Value, String> {
    let id = payload["snapshotId"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    if !valid_snapshot_id(&id) || !payload["nodes"].is_array() || !payload["edges"].is_array() {
        return Err(localized_error("native.error.985d66180d", json!({}), "工作流剪贴板数据无效，未暂存".into()));
    }
    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let directory = root.join(&id);
    // A failed new copy cannot overwrite or delete a previous clipboard snapshot.
    fs::create_dir(&directory).map_err(|error| localized_error("native.error.26533634c6", json!({"error": error.to_string()}), format!("无法创建工作流暂存目录：{error}")))?;
    let result = (|| {
        let mut count = 0;
        if let Some(resources) = payload["resources"].as_array_mut() {
            for (index, resource) in resources.iter_mut().enumerate() {
                let source = ["path", "filePath", "localPath"]
                    .iter()
                    .filter_map(|key| resource[*key].as_str())
                    .find(|path| !path.is_empty())
                    .unwrap_or_default()
                    .to_owned();
                if source.is_empty() {
                    continue;
                }
                let source_path = Path::new(&source);
                if !source_path.is_file() {
                    return Err(localized_error("native.error.275ec0efca", json!({"source": source.to_string()}), format!("工作流素材不存在：{source}")));
                }
                let name = sanitize_name(
                    source_path
                        .file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or("media"),
                    "media",
                );
                let target = directory.join(format!("{index}-{name}"));
                fs::copy(source_path, &target)
                    .map_err(|error| localized_error("native.error.6f326882a2", json!({"source": source.to_string(), "error": error.to_string()}), format!("暂存素材失败（{source}）：{error}")))?;
                fs::OpenOptions::new().write(true).open(&target)
                    .and_then(|file| file.sync_all())
                    .map_err(|error| error.to_string())?;
                resource["stagedPath"] = json!(target.to_string_lossy());
                count += 1;
            }
        }
        storage_service::save_clipboard(&root.join("clipboard.sqlite"), &id, &payload)?;
        Ok(
            json!({"snapshotId":id,"stagingDir":directory.to_string_lossy(),"filesCopied":count,"summary":payload["summary"]}),
        )
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&directory);
    }
    result
}

fn load_workflow(root: &Path, id: &str) -> Result<Value, String> {
    if !valid_snapshot_id(id) {
        return Err(localized_error("native.error.5223f52609", json!({}), "工作流剪贴板标识无效".into()));
    }
    storage_service::clipboard(&root.join("clipboard.sqlite"), id)
}

#[tauri::command]
pub async fn clipboard_stage_workflow(app: AppHandle, payload: Value) -> Result<Value, String> {
    let root = app_data(&app)?.join("workflow-clipboard");
    let result = tauri::async_runtime::spawn_blocking(move || stage_workflow(&root, payload))
        .await
        .map_err(|error| error.to_string())??;
    let id = result["snapshotId"].as_str().ok_or_else(|| localized_error("native.error.883cbbd57d", json!({}), "暂存结果缺少标识".into()))?;
    app.clipboard()
        .write_text(format!("{SENTINEL_PREFIX}{id}"))
        .map_err(|error| localized_error("native.error.0e014fbb47", json!({"error": error.to_string()}), format!("工作流已暂存，但系统剪贴板写入失败，请重新复制：{error}")))?;
    Ok(result)
}

#[tauri::command]
pub fn clipboard_read_staged_sentinel(app: AppHandle) -> Result<Option<Value>, String> {
    let text = app
        .clipboard()
        .read_text()
        .map_err(|error| localized_error("native.error.a4c69b960f", json!({"error": error.to_string()}), format!("系统剪贴板不可读取：{error}")))?;
    Ok(text
        .strip_prefix(SENTINEL_PREFIX)
        .filter(|id| valid_snapshot_id(id))
        .map(|id| json!({"snapshotId":id})))
}

#[tauri::command]
pub async fn clipboard_load_staged_payload(
    app: AppHandle,
    snapshot_id: String,
) -> Result<Value, String> {
    let root = app_data(&app)?.join("workflow-clipboard");
    tauri::async_runtime::spawn_blocking(move || load_workflow(&root, &snapshot_id))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn full_native_project_and_media_survive_clipboard_staging() {
        let root = std::env::temp_dir().join(format!(
            "shotloom-clipboard-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("原视频.mp4");
        let bytes = b"source media bytes";
        fs::write(&source, bytes).unwrap();
        let native = json!({"id":"native","timeline":{"tracks":[{"clips":[{"id":"clip","effects":[{"type":"blur"}]}]}]},"shotloomSession":{"undo":[{"id":"split"}],"view":{"scrollX":12}}});
        let payload = json!({"snapshotId":"copy-1","nodes":[{"type":"clipStudio","clipTransfer":{"version":1,"native":native}}],"edges":[],"resources":[{"path":source}],"summary":{"nodeCount":1}});
        let receipt = stage_workflow(&root.join("staging"), payload.clone()).unwrap();
        assert_eq!(receipt["filesCopied"], 1);
        fs::remove_file(&source).unwrap();
        let restored = load_workflow(&root.join("staging"), "copy-1").unwrap();
        assert_eq!(restored["nodes"], payload["nodes"]);
        let staged = restored["resources"][0]["stagedPath"].as_str().unwrap();
        assert_eq!(fs::read(staged).unwrap(), bytes);
        assert!(stage_workflow(&root.join("staging"), payload).is_err());
        assert!(load_workflow(&root, "../copy-1").is_err());
        let bad =
            json!({"snapshotId":"copy-2","nodes":[],"edges":[],"resources":[{"path":source}]});
        assert!(stage_workflow(&root.join("staging"), bad).is_err());
        assert!(!root.join("staging/copy-2").exists());
        assert!(root.join("staging/clipboard.sqlite").is_file());
        fs::remove_dir_all(root).unwrap();
    }
}
