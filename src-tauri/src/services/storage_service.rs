//! Transaction boundaries for persistent product data. No SQL or filesystem JSON.
use crate::localized_error::localized_error;
use crate::{crud::{catalog_crud, project_crud, settings_crud, recent_crud, recovery_crud, clipboard_crud}, database};
use sea_orm::{DbErr, TransactionTrait};
use serde_json::{json, Value};
use std::path::Path;

pub const PROJECT_DATABASE: &str = "project.sqlite";
pub const APP_DATABASE: &str = "app.sqlite";

macro_rules! with_database {
    ($path:expr, $db:ident, $work:block) => {{
        let path = $path.to_path_buf();
        database::run(async move {
            let $db = database::open(&path).await?;
            let outcome = async { $work }.await;
            $db.close().await?;
            outcome
        })
    }};
}

pub fn load_project(path: &Path) -> Result<Value, String> {
    if !path.is_file() { return Ok(Value::Null); }
    with_database!(path, db, {
        let tx = db.begin().await?;
        let value = project_crud::load(&tx).await?.unwrap_or(Value::Null);
        tx.commit().await?;
        Ok(value)
    })
}
pub fn save_project(path: &Path, value: &Value) -> Result<Value, String> {
    let value = value.clone();
    with_database!(path, db, {
        let tx = db.begin().await?;
        let result = project_crud::save(&tx, value).await?;
        tx.commit().await?;
        Ok(result)
    })
}
pub fn load_snapshot(path: &Path, node_id: &str) -> Result<Value, String> {
    if !path.is_file() { return Ok(Value::Null); }
    let node_id = node_id.to_owned();
    with_database!(path, db, { Ok(project_crud::snapshot(&db, &node_id).await?.unwrap_or(Value::Null)) })
}
pub fn editor_record(path: &Path, node_id: String, key: String) -> Result<Value, String> {
    if !path.is_file() { return Ok(Value::Null); }
    with_database!(path, db, { Ok(project_crud::editor_record(&db, &node_id, &key).await?.unwrap_or(Value::Null)) })
}
pub fn set_editor_record(path: &Path, node_id: String, key: String, payload: Option<Value>) -> Result<(), String> {
    with_database!(path, db, {
        let tx = db.begin().await?;
        project_crud::set_editor_record(&tx, &node_id, &key, payload).await?;
        tx.commit().await?; Ok(())
    })
}
pub fn save_snapshot(path: &Path, node_id: &str, payload: &Value) -> Result<(), String> {
    let node_id = node_id.to_owned(); let payload = payload.clone();
    with_database!(path, db, {
        let tx = db.begin().await?;
        project_crud::save_snapshot(&tx, &node_id, payload).await?;
        tx.commit().await?; Ok(())
    })
}
pub fn settings(path: &Path, defaults: &Value) -> Result<Value, String> {
    let defaults = defaults.clone();
    with_database!(path, db, {
        let result = settings_crud::load(&db).await?;
        let mut merged = defaults;
        if let (Some(base), Some(fields)) = (merged.as_object_mut(), result.as_object()) { base.extend(fields.clone()); }
        Ok(merged)
    })
}
pub fn save_settings(path: &Path, value: &Value) -> Result<(), String> {
    let value = value.clone();
    with_database!(path, db, {
        let tx = db.begin().await?; settings_crud::save(&tx, value).await?; tx.commit().await?; Ok(())
    })
}
pub fn set_token_group(path: &Path, id: Value, defaults: Value) -> Result<Value, String> {
    with_database!(path, db, {
        let tx = db.begin().await?;
        let mut settings = settings_crud::load(&tx).await?;
        if settings.as_object().is_none_or(|fields| fields.is_empty()) { settings = defaults; }
        settings["activeTokenGroupId"] = id;
        settings_crud::save(&tx, settings.clone()).await?;
        tx.commit().await?; Ok(settings)
    })
}

/// Explicit product catalogs, never arbitrary table or filename access.
pub fn catalog(path: &Path, kind: &str, fallback: Value) -> Result<Value, String> {
    let kind = kind.to_owned();
    with_database!(path, db, {
        let tx = db.begin().await?;
        let value = match kind.as_str() {
            "skills" => catalog_crud::skills(&tx).await?,
            "recipes" => catalog_crud::recipes(&tx).await?,
            "workflow-templates" => catalog_crud::workflow_templates(&tx).await?,
            "assets" => {
                let assets = catalog_crud::assets(&tx).await?;
                if let Some(mut value) = assets {
                    if let Some(materials) = catalog_crud::materials(&tx).await? { value["materials"] = materials["materials"].clone(); }
                    Some(value)
                } else { None }
            },
            _ => return Err(DbErr::Custom(localized_error("native.storage.46f6ec5e08", json!({"kind": kind.to_string()}), format!("未知目录：{kind}")))),
        };
        tx.commit().await?;
        Ok(value.unwrap_or(fallback))
    })
}
pub fn save_catalog(path: &Path, kind: &str, value: &Value) -> Result<(), String> {
    let kind = kind.to_owned(); let value = value.clone();
    with_database!(path, db, {
        let tx = db.begin().await?;
        match kind.as_str() {
            "skills" => catalog_crud::save_skills(&tx, value).await?,
            "recipes" => catalog_crud::save_recipes(&tx, value).await?,
            "workflow-templates" => catalog_crud::save_workflow_templates(&tx, &value).await?,
            "assets" => {
                let mut assets = value.clone(); assets.as_object_mut().ok_or_else(|| DbErr::Custom(localized_error("native.storage.d5455edb54", json!({}), "素材目录必须是对象".into())))?.remove("materials");
                let materials = serde_json::json!({ "materials": value.get("materials").cloned().unwrap_or(serde_json::json!([])) });
                catalog_crud::save_assets(&tx, assets).await?;
                catalog_crud::save_materials(&tx, materials).await?;
            },
            _ => return Err(DbErr::Custom(localized_error("native.storage.46f6ec5e08", json!({"kind": kind.to_string()}), format!("未知目录：{kind}")))),
        }
        tx.commit().await?; Ok(())
    })
}
pub fn recent(path: &Path) -> Result<Value, String> { with_database!(path, db, { recent_crud::list(&db).await }) }
pub fn add_recent(path: &Path, project: Value) -> Result<Value, String> {
    with_database!(path, db, {
        let tx = db.begin().await?; recent_crud::upsert(&tx, project).await?;
        let list = recent_crud::list(&tx).await?; tx.commit().await?; Ok(list)
    })
}
pub fn remove_recent(path: &Path, file_path: &str) -> Result<Value, String> {
    let file_path = file_path.to_owned();
    with_database!(path, db, {
        let tx = db.begin().await?; recent_crud::remove(&tx, &file_path).await?;
        let list = recent_crud::list(&tx).await?; tx.commit().await?; Ok(list)
    })
}
pub fn recovery(path: &Path, kind: &str) -> Result<Value, String> {
    let kind = kind.to_owned();
    with_database!(path, db, { Ok(recovery_crud::load(&db, &kind).await?.unwrap_or(Value::Null)) })
}
pub fn save_recovery(path: &Path, kind: &str, payload: &Value) -> Result<(), String> {
    let kind = kind.to_owned(); let payload = payload.clone();
    with_database!(path, db, { recovery_crud::save(&db, &kind, payload).await })
}
pub fn clipboard(path: &Path, id: &str) -> Result<Value, String> {
    let id = id.to_owned();
    with_database!(path, db, { clipboard_crud::load(&db, &id).await?.ok_or_else(|| DbErr::Custom(localized_error("native.storage.acc492d403", json!({}), "暂存工作流不存在，请重新复制".into()))) })
}
pub fn save_clipboard(path: &Path, id: &str, payload: &Value) -> Result<(), String> {
    let id = id.to_owned(); let payload = payload.clone();
    with_database!(path, db, { clipboard_crud::save(&db, &id, payload).await })
}

pub fn window_project(path: &Path, label: &str) -> Result<Option<String>, String> {
    let label = label.to_owned();
    with_database!(path, db, { crate::crud::workspace_crud::project_dir(&db, &label).await })
}
pub fn bind_window_project(path: &Path, label: &str, directory: Option<String>) -> Result<(), String> {
    let label = label.to_owned();
    with_database!(path, db, { crate::crud::workspace_crud::set_project_dir(&db, &label, directory).await })
}
pub fn download_directory(path: &Path) -> Result<Value, String> {
    with_database!(path, db, { Ok(settings_crud::field(&db, "downloadDirectory").await?.unwrap_or(serde_json::json!(""))) })
}
pub fn set_download_directory(path: &Path, directory: String) -> Result<(), String> {
    with_database!(path, db, { settings_crud::set_field(&db, "downloadDirectory", serde_json::json!(directory)).await })
}

/// 画布快照只存结构与媒体引用，不复制媒体文件。
pub fn list_project_snapshots(path: &Path) -> Result<Value, String> {
    if !path.is_file() { return Ok(Value::Array(Vec::new())); }
    with_database!(path, db, { Ok(project_crud::project_snapshots(&db).await?) })
}

pub fn create_project_snapshot(path: &Path, record: &Value) -> Result<Value, String> {
    let record = record.clone();
    with_database!(path, db, {
        let tx = db.begin().await?;
        let result = project_crud::save_project_snapshot(&tx, record).await?;
        tx.commit().await?;
        Ok(result)
    })
}

pub fn read_project_snapshot(path: &Path, id: &str) -> Result<Value, String> {
    if !path.is_file() { return Ok(Value::Null); }
    let id = id.to_owned();
    with_database!(path, db, { Ok(project_crud::project_snapshot_payload(&db, &id).await?) })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 前端用 `storage:get/set` 的 `workflow-templates` 命名空间存模板；
    /// 之前没在白名单里，保存会报「未知目录」。
    #[test]
    fn workflow_templates_catalog_round_trips() {
        let dir = std::env::temp_dir().join(format!(
            "shotloom-storage-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(APP_DATABASE);
        let fallback = json!({"storageVersion": 1, "templates": []});

        let initial = catalog(&path, "workflow-templates", fallback.clone()).unwrap();
        assert_eq!(initial, fallback);

        let value = json!({"storageVersion": 1, "templates": [{"id": "wf-1", "name": "跨项目模板"}]});
        save_catalog(&path, "workflow-templates", &value).unwrap();
        assert_eq!(catalog(&path, "workflow-templates", fallback).unwrap(), value);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
