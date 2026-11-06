use crate::services::storage_service;
use super::common::{
    app_data, chrono_stamp, copy_dir, localized_error, unique_dir, PROJECT_FILE,
};
use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::AppHandle;

const PROJECT_SCHEMA: &str = "shotloom-project";
const PROJECT_SCHEMA_VERSION: u64 = 2;
const SHARED_ASSET_LIBRARY_FILE: &str = "assets.sqlite";
const SHARED_ASSET_LIBRARY_SCHEMA: &str = "shotloom-project-assets";
static SHARED_ASSET_LIBRARY_LOCK: Mutex<()> = Mutex::new(());

fn lock_shared_asset_library() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    SHARED_ASSET_LIBRARY_LOCK
        .lock()
        .map_err(|_| localized_error("native.error.931a37d8d5", json!({}), "项目资产清单锁已损坏".into()))
}

fn shared_asset_root(project: &Value) -> Option<PathBuf> {
    ["library", "series"].iter().find_map(|key| {
        let boundary = project.get(key)?;
        if boundary.get("enabled").and_then(Value::as_bool) == Some(false) {
            return None;
        }
        let root = boundary.get("rootDir").and_then(Value::as_str)?.trim();
        (!root.is_empty()).then(|| PathBuf::from(root))
    })
}

fn shared_asset_directory(project: &Value) -> Option<PathBuf> {
    ["library", "series"].iter().find_map(|key| {
        let boundary = project.get(key)?;
        if boundary.get("enabled").and_then(Value::as_bool) == Some(false) {
            return None;
        }
        let directory = boundary.get("assetRootDir").and_then(Value::as_str)?.trim();
        (!directory.is_empty()).then(|| PathBuf::from(directory))
    })
}

fn values(project: &Value, key: &str) -> Vec<Value> {
    project
        .get(key)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn value_id(value: &Value) -> &str {
    value.get("id").and_then(Value::as_str).unwrap_or("")
}

fn upsert_by_id(target: &mut Vec<Value>, value: Value) {
    let id = value_id(&value);
    if id.is_empty() {
        return;
    }
    if let Some(index) = target.iter().position(|item| value_id(item) == id) {
        target[index] = value;
    } else {
        target.push(value);
    }
}

fn shared_asset_catalog_path(project: &Value) -> Option<PathBuf> {
    shared_asset_root(project).map(|root| root.join(SHARED_ASSET_LIBRARY_FILE))
}

fn apply_shared_asset_catalog(project: &mut Value, catalog: &Value) -> Result<(), String> {
    let record = project
        .as_object_mut()
        .ok_or_else(|| localized_error("native.error.10949f3d2b", json!({}), "项目数据格式无效".into()))?;
    let assets = values(catalog, "assets");
    let shared_materials = values(catalog, "materials");
    let mut materials = record
        .get("materials")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for material in shared_materials {
        upsert_by_id(&mut materials, material);
    }
    record.insert("assets".into(), Value::Array(assets));
    record.insert("materials".into(), Value::Array(materials));
    record.insert(
        "sharedLibraryDeletedAssetIds".into(),
        Value::Array(values(catalog, "deletedAssetIds")),
    );
    Ok(())
}

fn persist_shared_asset_catalog(project: &mut Value) -> Result<(), String> {
    let Some(path) = shared_asset_catalog_path(project) else {
        return Ok(());
    };
    let mut catalog = storage_service::catalog(&path, "assets", json!({}))?;
    if catalog.get("schema").and_then(Value::as_str) != Some(SHARED_ASSET_LIBRARY_SCHEMA) {
        catalog = json!({
            "schema": SHARED_ASSET_LIBRARY_SCHEMA,
            "schemaVersion": 1,
            "assets": [],
            "materials": [],
            "deletedAssetIds": [],
            "migratedProjectIds": [],
        });
    }

    let mut deleted = values(&catalog, "deletedAssetIds")
        .into_iter()
        .filter_map(|value| value.as_str().map(str::to_string))
        .collect::<BTreeSet<_>>();
    deleted.extend(
        values(project, "sharedLibraryDeletedAssetIds")
            .into_iter()
            .filter_map(|value| value.as_str().map(str::to_string)),
    );

    let mut assets = values(&catalog, "assets");
    for asset in values(project, "assets") {
        if !deleted.contains(value_id(&asset)) {
            upsert_by_id(&mut assets, asset);
        }
    }
    assets.retain(|asset| !deleted.contains(value_id(asset)));

    let material_ids = assets
        .iter()
        .filter_map(|asset| asset.get("materialId").and_then(Value::as_str))
        .map(str::to_string)
        .collect::<BTreeSet<_>>();
    let mut materials = values(&catalog, "materials");
    for material in values(project, "materials") {
        if material_ids.contains(value_id(&material)) {
            upsert_by_id(&mut materials, material);
        }
    }
    materials.retain(|material| material_ids.contains(value_id(material)));

    let mut migrated = values(&catalog, "migratedProjectIds")
        .into_iter()
        .filter_map(|value| value.as_str().map(str::to_string))
        .collect::<BTreeSet<_>>();
    if let Some(project_id) = project.get("id").and_then(Value::as_str) {
        if !project_id.is_empty() {
            migrated.insert(project_id.to_string());
        }
    }
    catalog = json!({
        "schema": SHARED_ASSET_LIBRARY_SCHEMA,
        "schemaVersion": 1,
        "assets": assets,
        "materials": materials,
        "deletedAssetIds": deleted,
        "migratedProjectIds": migrated,
    });
    storage_service::save_catalog(&path, "assets", &catalog)?;
    apply_shared_asset_catalog(project, &catalog)
}

fn hydrate_shared_asset_catalog(project: &mut Value) -> Result<(), String> {
    let Some(path) = shared_asset_catalog_path(project) else {
        return Ok(());
    };
    let catalog = storage_service::catalog(&path, "assets", Value::Null)?;
    if catalog.is_null()
        || catalog.get("schema").and_then(Value::as_str) != Some(SHARED_ASSET_LIBRARY_SCHEMA)
    {
        return persist_shared_asset_catalog(project);
    }
    let project_id = project.get("id").and_then(Value::as_str).unwrap_or("");
    let migrated = values(&catalog, "migratedProjectIds")
        .iter()
        .any(|value| value.as_str() == Some(project_id));
    if !migrated {
        // Each legacy canvas contributes its old embedded assets once. The migrated ID
        // prevents a stale sibling canvas from resurrecting an asset deleted later.
        return persist_shared_asset_catalog(project);
    }
    apply_shared_asset_catalog(project, &catalog)
}

fn validate_current_project(project: &Value) -> Result<(), String> {
    if project.get("schema").and_then(Value::as_str) != Some(PROJECT_SCHEMA) {
        return Err(localized_error("native.error.c17248e2d5", json!({}), "项目格式无效：不是 Shotloom 项目".into()));
    }
    let version = project
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .ok_or_else(|| localized_error("native.error.689ca0e5ac", json!({}), "项目数据缺少有效的 schemaVersion".into()))?;
    if version != PROJECT_SCHEMA_VERSION {
        return Err(localized_error("native.error.f2e402a2db", json!({"PROJECT_SCHEMA_VERSION": PROJECT_SCHEMA_VERSION.to_string(), "version": version.to_string()}), format!("项目版本不受支持：需要 v{PROJECT_SCHEMA_VERSION}，实际为 v{version}")));
    }
    Ok(())
}

/// 项目树递归的硬性上限：目录结构来自磁盘，符号链接和深目录不能把原生进程带进无限递归。
const MAX_PROJECT_TREE_DEPTH: usize = 8;

// 列表已读取工程数据库，只返回一个实际存在的本地图片路径；不读取图片字节。
fn project_cover_source(project: &Value, directory: &Path) -> Option<String> {
    let nodes = project.get("nodes")?.as_array()?;
    let local_image = |media: &Value| -> Option<String> {
        let source = media.get("filePath").or_else(|| media.get("path")).and_then(Value::as_str)?;
        if source.is_empty() || source.contains("://") || source.starts_with("data:") || source.starts_with("blob:") { return None; }
        let path = Path::new(source);
        let extension = path.extension().and_then(|ext| ext.to_str()).unwrap_or("").to_ascii_lowercase();
        if !matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif" | "avif" | "bmp") { return None; }
        let path = if path.is_absolute() { path.to_path_buf() } else { directory.join(path) };
        path.is_file().then(|| path.to_string_lossy().into_owned())
    };
    for node in nodes {
        if let Some(outputs) = node.get("generatedOutputs").and_then(Value::as_array) {
            if let Some(selected) = outputs.iter().find(|item| item.get("id").is_some() && item.get("id") == node.get("selectedOutputNodeId")) {
                if let Some(path) = local_image(selected) { return Some(path); }
            }
            for output in outputs.iter().rev() {
                if let Some(path) = local_image(output) { return Some(path); }
            }
        }
        if let Some(path) = node.get("uploadedFile").and_then(&local_image) { return Some(path); }
        if let Some(path) = local_image(node) { return Some(path); }
    }
    // 素材仅扫描一次，且只能引用仍在画布上的节点。
    let node_ids: BTreeSet<&str> = nodes.iter().filter_map(|node| node.get("id").and_then(Value::as_str)).collect();
    if let Some(materials) = project.get("materials").and_then(Value::as_array) {
        for media in materials {
            if media.get("nodeId").and_then(Value::as_str).is_some_and(|id| node_ids.contains(id)) {
                if let Some(path) = local_image(media) { return Some(path); }
            }
        }
    }
    None
}

fn list_project_tree(root: &Path, depth: usize) -> Result<Vec<Value>, String> {
    let mut result = Vec::new();
    if !root.exists() {
        return Ok(result);
    }
    let mut entries = fs::read_dir(root)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_type()
                .map(|file_type| file_type.is_dir())
                .unwrap_or(false)
        })
        .filter(|entry| {
            !(root.join(SHARED_ASSET_LIBRARY_FILE).exists()
                && entry.file_name().to_string_lossy() == "assets")
        })
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let directory = entry.path();
        let metadata = entry.metadata().ok();
        let timestamp = |time: Option<std::time::SystemTime>| {
            time.and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as u64)
        };
        let created_at = timestamp(metadata.as_ref().and_then(|value| value.created().ok()));
        let updated_at = timestamp(metadata.as_ref().and_then(|value| value.modified().ok()));
        let project_path = directory.join(PROJECT_FILE);
        if project_path.exists() {
            let project = storage_service::load_project(&project_path)?;
            let fallback_name = entry.file_name().to_string_lossy().into_owned();
            let project_name = project
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(&fallback_name);
            result.push(json!({"kind":"project","name":project_name,"filePath":project_path.to_string_lossy(),"projectDir":directory.to_string_lossy(),"createdAt":project.get("createdAt").cloned().unwrap_or(Value::Null),"updatedAt":project.get("updatedAt").cloned().unwrap_or(Value::Null),"coverSource":project_cover_source(&project, &directory)}));
        } else if depth >= MAX_PROJECT_TREE_DEPTH {
            result.push(json!({"kind":"folder","name":entry.file_name().to_string_lossy(),"folderDir":directory.to_string_lossy(),"createdAt":created_at,"updatedAt":updated_at,"children":[],"truncated":true}));
        } else {
            result.push(json!({"kind":"folder","name":entry.file_name().to_string_lossy(),"folderDir":directory.to_string_lossy(),"createdAt":created_at,"updatedAt":updated_at,"children":list_project_tree(&directory, depth + 1)?}));
        }
    }
    Ok(result)
}

#[tauri::command]
pub fn project_get_default_root(app: AppHandle) -> Result<Value, String> {
    let root = app_data(&app)?.join("projects");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(json!(root.to_string_lossy()))
}

#[tauri::command]
pub fn project_ensure_root(app: AppHandle, root: String) -> Result<Value, String> {
    let requested = PathBuf::from(root.trim());
    if !root.trim().is_empty() && requested.is_absolute() {
        fs::create_dir_all(&requested).map_err(|error| error.to_string())?;
        return Ok(json!(requested.to_string_lossy()));
    }

    let target_root = app_data(&app)?.join("projects");
    fs::create_dir_all(&target_root).map_err(|error| error.to_string())?;
    Ok(json!(target_root.to_string_lossy()))
}

#[tauri::command]
pub fn project_create_folder(parent: String, name: String) -> Result<Value, String> {
    let parent = PathBuf::from(parent);
    fs::create_dir_all(&parent).map_err(|error| error.to_string())?;
    let target = unique_dir(&parent, &name);
    fs::create_dir(&target).map_err(|error| error.to_string())?;
    Ok(json!(target.to_string_lossy()))
}

#[tauri::command]
pub fn project_create_library_folder(parent: String, name: String) -> Result<Value, String> {
    let target = unique_dir(Path::new(&parent), &name);
    fs::create_dir_all(&target).map_err(|error| error.to_string())?;
    Ok(
        json!({"kind":"folder","name":target.file_name().and_then(|v| v.to_str()).unwrap_or_default(),"folderDir":target.to_string_lossy()}),
    )
}

#[tauri::command]
pub fn project_rename_entry(path: String, name: String) -> Result<Value, String> {
    let source = PathBuf::from(path);
    let target = unique_dir(source.parent().ok_or_else(|| localized_error("native.error.db9eb77b5a", json!({}), "目录没有父级".into()))?, &name);
    fs::rename(&source, &target).map_err(|error| error.to_string())?;
    let actual_name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_string();
    let project_path = target.join(PROJECT_FILE);
    let mut storage_revision = None;
    if project_path.exists() {
        let update_result = (|| -> Result<(), String> {
            let mut project = storage_service::load_project(&project_path)?;
            let record = project
                .as_object_mut()
                .ok_or_else(|| localized_error("native.error.10949f3d2b", json!({}), "项目数据格式无效".into()))?;
            record.insert("name".into(), json!(actual_name));
            let saved = storage_service::save_project(&project_path, &project)?;
            storage_revision = saved.get("storageRevision").cloned();
            Ok(())
        })();
        if let Err(error) = update_result {
            return match fs::rename(&target, &source) {
                Ok(_) => Err(localized_error("native.error.78d9312625", json!({"error": error.to_string()}), format!("更新项目名称失败：{error}"))),
                Err(rollback_error) => Err(localized_error("native.error.a1819e93de", json!({"error": error.to_string(), "rollback_error": rollback_error.to_string()}), format!("更新项目名称失败：{error}；目录回滚失败：{rollback_error}"))),
            };
        }
    }
    Ok(
        json!({"oldDir":source.to_string_lossy(),"newDir":target.to_string_lossy(),"name":actual_name,"storageRevision":storage_revision}),
    )
}

fn clone_entry(path: String, name: Option<String>) -> Result<Value, String> {
    let source = PathBuf::from(path);
    let fallback = format!(
        "{}-copy",
        source
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("copy")
    );
    let preferred = name.filter(|value| !value.is_empty()).unwrap_or(fallback);
    let target = unique_dir(source.parent().ok_or_else(|| localized_error("native.error.db9eb77b5a", json!({}), "目录没有父级".into()))?, &preferred);
    copy_dir(&source, &target)?;
    Ok(
        json!({"ok":true,"projectDir":target.to_string_lossy(),"folderDir":target.to_string_lossy(),"name":target.file_name().and_then(|v| v.to_str()).unwrap_or_default()}),
    )
}

#[tauri::command]
pub async fn project_clone_entry(path: String, name: Option<String>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || clone_entry(path, name))
        .await
        .map_err(|error| localized_error("native.error.77e7deaee7", json!({"error": error.to_string()}), format!("项目克隆任务异常：{error}")))?
}

fn list_root(root: String) -> Result<Value, String> {
    Ok(json!(list_project_tree(Path::new(&root), 0)?))
}

#[tauri::command]
pub async fn project_list_root(root: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || list_root(root))
        .await
        .map_err(|error| localized_error("native.error.b8389e4636", json!({"error": error.to_string()}), format!("项目目录遍历任务异常：{error}")))?
}

fn save_project(directory: String, mut project: Value) -> Result<Value, String> {
    validate_current_project(&project)?;
    {
        let _guard = lock_shared_asset_library()?;
        persist_shared_asset_catalog(&mut project)?;
    }
    let directory = PathBuf::from(directory);
    let asset_directory =
        shared_asset_directory(&project).unwrap_or_else(|| directory.join("assets"));
    fs::create_dir_all(asset_directory).map_err(|error| error.to_string())?;
    let path = directory.join(PROJECT_FILE);
    project = storage_service::save_project(&path, &project)?;
    Ok(
        json!({"filePath":path.to_string_lossy(),"projectDir":directory.to_string_lossy(),"project":project}),
    )
}

#[tauri::command]
pub async fn project_save(directory: String, project: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || save_project(directory, project))
        .await
        .map_err(|error| localized_error("native.error.fc29894f70", json!({"error": error.to_string()}), format!("项目保存任务异常：{error}")))?
}

fn read_project_file(path: String) -> Result<Value, String> {
    let mut project = storage_service::load_project(Path::new(&path))?;
    validate_current_project(&project)?;
    {
        let _guard = lock_shared_asset_library()?;
        hydrate_shared_asset_catalog(&mut project)?;
    }
    Ok(project)
}

#[tauri::command]
pub async fn project_read_file(path: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || read_project_file(path))
        .await
        .map_err(|error| localized_error("native.error.e5e47e6ad0", json!({"error": error.to_string()}), format!("项目读取任务异常：{error}")))?
}

fn open_project_folder(directory: String) -> Result<Value, String> {
    let directory = PathBuf::from(directory);
    let path = directory.join(PROJECT_FILE);
    let mut project = storage_service::load_project(&path)?;
    if project.is_null() {
        return Err(localized_error("native.error.6324562919", json!({}), "所选目录不是 Shotloom 画布".into()));
    }
    validate_current_project(&project)?;
    {
        let _guard = lock_shared_asset_library()?;
        hydrate_shared_asset_catalog(&mut project)?;
    }
    Ok(
        json!({"ok":true,"filePath":path.to_string_lossy(),"projectDir":directory.to_string_lossy(),"project":project}),
    )
}

#[tauri::command]
pub async fn project_open_folder(directory: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || open_project_folder(directory))
        .await
        .map_err(|error| localized_error("native.error.94f486adad", json!({"error": error.to_string()}), format!("项目打开任务异常：{error}")))?
}

fn write_project_zip_directory(
    archive: &mut zip::ZipWriter<fs::File>,
    source_root: &Path,
    directory: &Path,
    options: zip::write::SimpleFileOptions,
    count: &mut usize,
    total_size: &mut u64,
) -> Result<(), String> {
    let mut entries = fs::read_dir(directory)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            write_project_zip_directory(archive, source_root, &path, options, count, total_size)?;
            continue;
        }
        if !file_type.is_file() { continue; }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with(".sqlite-wal") || name.ends_with(".sqlite-shm") { continue; }
        let relative = path
            .strip_prefix(source_root)
            .map_err(|error| error.to_string())?;
        let archive_name = relative
            .components()
            .map(|component| component.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        if archive_name.is_empty() || archive_name.contains("../") {
            continue;
        }
        archive
            .start_file(format!("project/{archive_name}"), options)
            .map_err(|error| error.to_string())?;
        let snapshot = if path.extension().and_then(|v| v.to_str()) == Some("sqlite") {
            let temp = std::env::temp_dir().join(format!("shotloom-export-{}.sqlite", uuid::Uuid::new_v4()));
            crate::database::backup(&path, &temp)?;
            Some(temp)
        } else { None };
        let result = (|| {
            let mut input = fs::File::open(snapshot.as_deref().unwrap_or(&path)).map_err(|error| error.to_string())?;
            let size = input.metadata().map_err(|error| error.to_string())?.len();
            std::io::copy(&mut input, archive).map_err(|error| error.to_string())?;
            Ok::<u64, String>(size)
        })();
        if let Some(snapshot) = snapshot { let _ = fs::remove_file(snapshot); }
        let size = result?;
        *count += 1;
        *total_size = total_size.saturating_add(size);
    }
    Ok(())
}

fn export_package(source: String, target: String) -> Result<Value, String> {
    let source = PathBuf::from(source);
    let target = PathBuf::from(target);
    if !source.is_dir() || !source.join(PROJECT_FILE).is_file() {
        return Err(localized_error("native.error.490282ece2", json!({}), "项目目录无效或缺少 project.sqlite".into()));
    }
    if target.starts_with(&source) {
        return Err(localized_error("native.error.35af4b8578", json!({}), "项目包不能保存到项目目录内部".into()));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let project = storage_service::load_project(&source.join(PROJECT_FILE))?;
    validate_current_project(&project)?;
    let temp_name = format!(
        ".{}.{}.partial",
        target
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("project.zip"),
        chrono_stamp(),
    );
    let temp = target.parent().unwrap_or(Path::new(".")).join(temp_name);
    let export_result = (|| -> Result<(usize, u64), String> {
        let output = fs::File::create(&temp).map_err(|error| error.to_string())?;
        let mut archive = zip::ZipWriter::new(output);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        let manifest = json!({
            "schema": "shotloom-project-package",
            "version": 1,
            "projectName": project.get("name").and_then(Value::as_str).unwrap_or("未命名项目"),
            "projectFile": format!("project/{PROJECT_FILE}"),
            "sourceProjectDir": source.to_string_lossy(),
            "exportedAtMs": chrono_stamp(),
        });
        archive
            .start_file("manifest.json", options)
            .map_err(|error| error.to_string())?;
        archive
            .write_all(
                serde_json::to_string_pretty(&manifest)
                    .map_err(|error| error.to_string())?
                    .as_bytes(),
            )
            .map_err(|error| error.to_string())?;
        let mut count = 0usize;
        let mut total_size = 0u64;
        write_project_zip_directory(
            &mut archive,
            &source,
            &source,
            options,
            &mut count,
            &mut total_size,
        )?;
        archive.finish().map_err(|error| error.to_string())?;
        Ok((count, total_size))
    })();
    let (count, total_size) = match export_result {
        Ok(value) => value,
        Err(error) => {
            let _ = fs::remove_file(&temp);
            return Err(error);
        }
    };
    if target.exists() {
        fs::remove_file(&target).map_err(|error| error.to_string())?;
    }
    fs::rename(&temp, &target).map_err(|error| error.to_string())?;
    Ok(json!({
        "ok": true,
        "filePath": target.to_string_lossy(),
        "count": count,
        "totalSize": total_size,
    }))
}

#[tauri::command]
pub async fn project_export_package(source: String, target: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || export_package(source, target))
        .await
        .map_err(|error| localized_error("native.error.dc48ad8918", json!({"error": error.to_string()}), format!("项目包导出任务异常：{error}")))?
}

fn rewrite_imported_project_paths(value: &mut Value, source_root: &str, target_root: &Path) {
    match value {
        Value::Array(items) => {
            for item in items {
                rewrite_imported_project_paths(item, source_root, target_root);
            }
        }
        Value::Object(object) => {
            for item in object.values_mut() {
                rewrite_imported_project_paths(item, source_root, target_root);
            }
        }
        Value::String(text) if !source_root.is_empty() => {
            let normalized_source = source_root
                .replace('\\', "/")
                .trim_end_matches('/')
                .to_string();
            let normalized_text = text.replace('\\', "/");
            if normalized_text == normalized_source
                || normalized_text.starts_with(&format!("{normalized_source}/"))
            {
                let suffix = normalized_text
                    .strip_prefix(&normalized_source)
                    .unwrap_or("")
                    .trim_start_matches('/');
                let mut rewritten = target_root.to_path_buf();
                for component in suffix.split('/').filter(|component| !component.is_empty()) {
                    rewritten.push(component);
                }
                *text = rewritten.to_string_lossy().into_owned();
            }
        }
        _ => {}
    }
}

fn import_package(source: String, target_root: String) -> Result<Value, String> {
    const MAX_PACKAGE_FILES: usize = 20_000;
    const MAX_PACKAGE_BYTES: u64 = 20 * 1024 * 1024 * 1024;
    let source = PathBuf::from(source);
    let target_root = PathBuf::from(target_root);
    if !source.is_file() {
        return Err(localized_error("native.error.bdaff3d4e7", json!({}), "项目包不存在".into()));
    }
    fs::create_dir_all(&target_root).map_err(|error| error.to_string())?;
    let input = fs::File::open(&source).map_err(|error| error.to_string())?;
    let mut archive =
        zip::ZipArchive::new(input).map_err(|error| localized_error("native.error.7c6b74d5d2", json!({"error": error.to_string()}), format!("项目包格式无效：{error}")))?;
    let manifest: Value = {
        let mut file = archive
            .by_name("manifest.json")
            .map_err(|_| localized_error("native.error.271d00e74f", json!({}), "项目包缺少 manifest.json".into()))?;
        if file.size() > 1024 * 1024 {
            return Err(localized_error("native.error.17726343ad", json!({}), "项目包清单过大".into()));
        }
        let mut text = String::new();
        file.read_to_string(&mut text)
            .map_err(|error| error.to_string())?;
        serde_json::from_str(&text).map_err(|error| localized_error("native.error.05db8b0431", json!({"error": error.to_string()}), format!("项目包清单无效：{error}")))?
    };
    if manifest.get("schema").and_then(Value::as_str) != Some("shotloom-project-package")
        || manifest.get("version").and_then(Value::as_u64) != Some(1)
        || manifest.get("projectFile").and_then(Value::as_str)
            != Some("project/project.sqlite")
    {
        return Err(localized_error("native.error.b97ed0790b", json!({}), "不是受支持的 Shotloom 项目包".into()));
    }

    let mut file_count = 0usize;
    let mut total_size = 0u64;
    for index in 0..archive.len() {
        let file = archive.by_index(index).map_err(|error| error.to_string())?;
        let name = file.name().replace('\\', "/");
        if name == "manifest.json" || name == "project/" {
            continue;
        }
        if !name.starts_with("project/") || name.contains("../") || file.enclosed_name().is_none() {
            return Err(localized_error("native.error.0f90da86b1", json!({"name": name.to_string()}), format!("项目包包含不安全路径：{name}")));
        }
        if !file.is_dir() {
            file_count += 1;
            total_size = total_size.saturating_add(file.size());
            if file_count > MAX_PACKAGE_FILES {
                return Err(localized_error("native.error.5dae9149f2", json!({}), "项目包文件数超过上限".into()));
            }
            if total_size > MAX_PACKAGE_BYTES {
                return Err(localized_error("native.error.6c9bb31fda", json!({}), "项目包解压体积超过 20GB 上限".into()));
            }
        }
    }

    let project_name = manifest
        .get("projectName")
        .and_then(Value::as_str)
        .unwrap_or("导入项目");
    let target = unique_dir(&target_root, project_name);
    let temp = target_root.join(format!(".shotloom-import-{}.partial", chrono_stamp()));
    let import_result = (|| -> Result<Value, String> {
        fs::create_dir_all(&temp).map_err(|error| error.to_string())?;
        for index in 0..archive.len() {
            let mut file = archive.by_index(index).map_err(|error| error.to_string())?;
            let name = file.name().replace('\\', "/");
            if name == "manifest.json" || name == "project/" {
                continue;
            }
            let relative = name.strip_prefix("project/").ok_or_else(|| localized_error("native.error.b9f84a3f77", json!({}), "项目包路径无效".into()))?;
            if relative.is_empty() {
                continue;
            }
            let output = relative
                .split('/')
                .filter(|part| !part.is_empty())
                .fold(temp.clone(), |path, part| path.join(part));
            if file.is_dir() {
                fs::create_dir_all(&output).map_err(|error| error.to_string())?;
                continue;
            }
            if let Some(parent) = output.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            let mut destination = fs::File::create(&output).map_err(|error| error.to_string())?;
            std::io::copy(&mut file, &mut destination).map_err(|error| error.to_string())?;
        }
        let project_path = temp.join(PROJECT_FILE);
        let mut project = storage_service::load_project(&project_path)?;
        validate_current_project(&project)
            .map_err(|error| localized_error("native.error.fbd533a5a7", json!({"error": error.to_string()}), format!("项目包中的 project.sqlite 无效：{error}")))?;
        rewrite_imported_project_paths(
            &mut project,
            manifest
                .get("sourceProjectDir")
                .and_then(Value::as_str)
                .unwrap_or(""),
            &target,
        );
        project = storage_service::save_project(&project_path, &project)?;
        fs::rename(&temp, &target).map_err(|error| error.to_string())?;
        Ok(json!({
            "ok": true,
            "projectDir": target.to_string_lossy(),
            "filePath": target.join(PROJECT_FILE).to_string_lossy(),
            "project": project,
            "count": file_count,
            "totalSize": total_size,
        }))
    })();
    if import_result.is_err() {
        let _ = fs::remove_dir_all(&temp);
    }
    import_result
}

#[tauri::command]
pub async fn project_import_package(source: String, target_root: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || import_package(source, target_root))
        .await
        .map_err(|error| localized_error("native.error.58685a53f4", json!({"error": error.to_string()}), format!("项目包导入任务异常：{error}")))?
}

#[tauri::command]
pub fn project_create_episode_folder(
    parent: String,
    shared: String,
    name: String,
) -> Result<Value, String> {
    let target = unique_dir(Path::new(&parent), &name);
    fs::create_dir_all(&target).map_err(|error| error.to_string())?;
    let assets = PathBuf::from(&shared).join("assets");
    fs::create_dir_all(&assets).map_err(|error| error.to_string())?;
    Ok(
        json!({"projectDir":target.to_string_lossy(),"seriesDir":shared,"assetRootDir":assets.to_string_lossy()}),
    )
}

fn trash_entry(path: String) -> Result<Value, String> {
    let target = PathBuf::from(path);
    if target.exists() {
        trash::delete(&target).map_err(|error| error.to_string())?;
    }
    Ok(json!({"ok":true}))
}

#[tauri::command]
pub async fn project_trash_entry(path: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || trash_entry(path))
        .await
        .map_err(|error| localized_error("native.error.07d1ba756c", json!({"error": error.to_string()}), format!("项目移除任务异常：{error}")))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn sqlite_project_lifecycle_preserves_graph_and_editor_state() {
        let root = std::env::temp_dir().join(format!("shotloom-lifecycle-{}", uuid::Uuid::new_v4()));
        let created = project_create_folder(root.to_string_lossy().into_owned(), "Created".into()).unwrap();
        let directory = PathBuf::from(created.as_str().unwrap());
        let project = json!({"schema":"shotloom-project","schemaVersion":PROJECT_SCHEMA_VERSION,
            "id":"lifecycle","name":"Created","nodes":[{"id":"n","type":"clipStudio","title":"clip"}],"edges":[]});
        let saved = save_project(directory.to_string_lossy().into_owned(), project).unwrap();
        storage_service::save_snapshot(&directory.join(PROJECT_FILE), "n", &json!({"tracks":[{"id":"t"}]})).unwrap();
        assert_eq!(open_project_folder(directory.to_string_lossy().into_owned()).unwrap()["project"]["nodes"], saved["project"]["nodes"]);
        let cloned = clone_entry(directory.to_string_lossy().into_owned(), Some("Copied".into())).unwrap();
        let clone_dir = PathBuf::from(cloned["projectDir"].as_str().unwrap());
        assert_eq!(storage_service::load_snapshot(&clone_dir.join(PROJECT_FILE), "n").unwrap()["tracks"][0]["id"], "t");
        let renamed = project_rename_entry(clone_dir.to_string_lossy().into_owned(), "Renamed".into()).unwrap();
        let renamed_dir = PathBuf::from(renamed["newDir"].as_str().unwrap());
        assert!(!clone_dir.exists());
        assert_eq!(storage_service::load_project(&renamed_dir.join(PROJECT_FILE)).unwrap()["name"], "Renamed");
        let archive = root.join("transfer.shotloom-project.zip");
        export_package(renamed_dir.to_string_lossy().into_owned(), archive.to_string_lossy().into_owned()).unwrap();
        let imported = import_package(archive.to_string_lossy().into_owned(), root.join("imports").to_string_lossy().into_owned()).unwrap();
        let imported_dir = PathBuf::from(imported["projectDir"].as_str().unwrap());
        assert_eq!(storage_service::load_project(&imported_dir.join(PROJECT_FILE)).unwrap()["nodes"], saved["project"]["nodes"]);
        assert_eq!(storage_service::load_snapshot(&imported_dir.join(PROJECT_FILE), "n").unwrap()["tracks"][0]["id"], "t");
        let listed = list_root(root.to_string_lossy().into_owned()).unwrap();
        assert_eq!(listed.as_array().unwrap().iter().filter(|row| row["kind"] == "project").count(), 2);
        let legacy_dir = root.join("legacy"); fs::create_dir(&legacy_dir).unwrap();
        fs::write(legacy_dir.join(["project", "shotloom", "json"].join(".")), b"{}").unwrap();
        assert!(open_project_folder(legacy_dir.to_string_lossy().into_owned()).is_err());
        trash_entry(imported_dir.to_string_lossy().into_owned()).unwrap();
        assert!(!imported_dir.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn project_covers_use_existing_canvas_images_and_skip_missing_files() {
        let root = std::env::temp_dir().join(format!("shotloom-project-cover-{}", chrono_stamp()));
        fs::create_dir_all(root.join("assets")).unwrap();
        fs::write(root.join("assets/cover.png"), b"image-placeholder").unwrap();
        let project = json!({"nodes":[
            {"id":"text","type":"text","content":"hello"},
            {"id":"image","generatedOutputs":[{"filePath":"assets/cover.png"},{"filePath":"assets/deleted.png"}]}
        ],"materials":[{"nodeId":"unrelated","filePath":"not-on-canvas.png"}]});
        let expected = root.join("assets/cover.png").to_string_lossy().into_owned();
        assert_eq!(project_cover_source(&project, &root), Some(expected));
        assert_eq!(project_cover_source(&project, &root), project_cover_source(&project, &root));
        fs::remove_file(root.join("assets/cover.png")).unwrap();
        assert_eq!(project_cover_source(&project, &root), None);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn project_export_writes_manifest_project_and_assets() {
        let root = std::env::temp_dir().join(format!("shotloom-export-test-{}", chrono_stamp()));
        let source = root.join("source");
        let target = root.join("export.shotloom-project.zip");
        fs::create_dir_all(source.join("assets")).unwrap();
        storage_service::save_project(&source.join(PROJECT_FILE), &json!({"schema":"shotloom-project","schemaVersion":2,"id":"export-test","name":"Export Test"})).unwrap();
        fs::write(source.join("assets").join("image.bin"), b"asset-bytes").unwrap();

        let result = export_package(
            source.to_string_lossy().into_owned(),
            target.to_string_lossy().into_owned(),
        )
        .unwrap();
        assert_eq!(result.get("ok").and_then(Value::as_bool), Some(true));
        assert_eq!(result.get("count").and_then(Value::as_u64), Some(2));

        {
            let mut archive = zip::ZipArchive::new(fs::File::open(&target).unwrap()).unwrap();
            assert!(archive.by_name("manifest.json").is_ok());
            assert!(archive.by_name(&format!("project/{PROJECT_FILE}")).is_ok());
            let mut asset = Vec::new();
            archive
                .by_name("project/assets/image.bin")
                .unwrap()
                .read_to_end(&mut asset)
                .unwrap();
            assert_eq!(asset, b"asset-bytes");
        }

        let imported = import_package(
            target.to_string_lossy().into_owned(),
            root.join("imports").to_string_lossy().into_owned(),
        )
        .unwrap();
        let imported_dir =
            PathBuf::from(imported.get("projectDir").and_then(Value::as_str).unwrap());
        assert_eq!(
            fs::read(imported_dir.join("assets").join("image.bin")).unwrap(),
            b"asset-bytes"
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn project_tree_stops_at_deep_directories_and_ignores_symlinks() {
        let root = std::env::temp_dir().join(format!("shotloom-tree-depth-{}", chrono_stamp()));
        fs::create_dir_all(root.join("nested")).unwrap();
        let boundary = list_project_tree(&root, MAX_PROJECT_TREE_DEPTH).unwrap();
        assert_eq!(
            boundary
                .first()
                .and_then(|entry| entry.get("truncated"))
                .and_then(Value::as_bool),
            Some(true)
        );
        let inside_limit = list_project_tree(&root, MAX_PROJECT_TREE_DEPTH - 1).unwrap();
        assert!(inside_limit
            .first()
            .and_then(|entry| entry.get("truncated"))
            .is_none());

        std::os::unix::fs::symlink(root.join("nested"), root.join("escape")).unwrap();
        let top = list_project_tree(&root, 0).unwrap();
        assert!(!top
            .iter()
            .any(|entry| entry.get("name").and_then(Value::as_str) == Some("escape")));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn project_version_error_preserves_expected_and_actual_parameters() {
        let error = validate_current_project(&json!({
            "schema": "shotloom-project", "schemaVersion": 0
        })).unwrap_err();
        let envelope: Value = serde_json::from_str(&error).unwrap();
        assert_eq!(envelope["type"], "shotloom:localized-error");
        assert_eq!(envelope["params"]["PROJECT_SCHEMA_VERSION"], PROJECT_SCHEMA_VERSION.to_string());
        assert_eq!(envelope["params"]["version"], "0");
        assert!(envelope["key"].as_str().unwrap().starts_with("native.error."));
    }

    #[test]
    fn project_validator_rejects_legacy_schema_versions() {
        assert!(validate_current_project(&json!({
            "schema": "shotloom-project",
            "schemaVersion": PROJECT_SCHEMA_VERSION
        }))
        .is_ok());
        assert!(validate_current_project(&json!({
            "schema": "shotloom-project",
            "schemaVersion": PROJECT_SCHEMA_VERSION - 1
        }))
        .is_err());
        assert!(validate_current_project(&json!({
            "schema": "shotloom-project"
        }))
        .is_err());
    }

    #[test]
    fn sibling_canvases_share_assets_and_deleted_entries_do_not_return() {
        let root = std::env::temp_dir().join(format!("shotloom-shared-assets-{}", chrono_stamp()));
        fs::create_dir_all(&root).unwrap();
        let boundary = json!({
            "enabled": true,
            "rootDir": root.to_string_lossy(),
            "assetRootDir": root.join("assets").to_string_lossy(),
        });
        let mut first = json!({
            "id": "canvas-a",
            "library": boundary,
            "assets": [{"id":"asset-a","materialId":"material-a","name":"A"}],
            "materials": [{"id":"material-a","path":"/shared/assets/a.png"}],
        });
        persist_shared_asset_catalog(&mut first).unwrap();

        let mut second = json!({
            "id": "canvas-b",
            "library": first.get("library").cloned().unwrap(),
            "assets": [{"id":"asset-b","materialId":"material-b","name":"B"}],
            "materials": [{"id":"material-b","path":"/shared/assets/b.png"}],
        });
        persist_shared_asset_catalog(&mut second).unwrap();
        assert_eq!(values(&second, "assets").len(), 2);

        first["assets"] = json!([]);
        first["sharedLibraryDeletedAssetIds"] = json!(["asset-a"]);
        persist_shared_asset_catalog(&mut first).unwrap();
        assert_eq!(values(&first, "assets").len(), 1);
        assert_eq!(value_id(&values(&first, "assets")[0]), "asset-b");

        // A stale sibling still containing asset-a cannot resurrect the tombstoned entry.
        second["assets"] = json!([
            {"id":"asset-a","materialId":"material-a","name":"A"},
            {"id":"asset-b","materialId":"material-b","name":"B"}
        ]);
        second["sharedLibraryDeletedAssetIds"] = json!([]);
        persist_shared_asset_catalog(&mut second).unwrap();
        assert_eq!(values(&second, "assets").len(), 1);
        assert_eq!(value_id(&values(&second, "assets")[0]), "asset-b");

        fs::remove_dir_all(root).unwrap();
    }
}

#[tauri::command]
pub async fn editor_snapshot_get(directory: String, node_id: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || storage_service::load_snapshot(&Path::new(&directory).join(PROJECT_FILE), &node_id)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn editor_record_get(directory: String, node_id: String, key: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || storage_service::editor_record(&Path::new(&directory).join(PROJECT_FILE), node_id, key)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn editor_record_set(directory: String, node_id: String, key: String, value: Option<Value>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || storage_service::set_editor_record(&Path::new(&directory).join(PROJECT_FILE), node_id, key, value)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn editor_snapshot_set(directory: String, node_id: String, snapshot: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        storage_service::save_snapshot(&Path::new(&directory).join(PROJECT_FILE), &node_id, &snapshot)?;
        Ok(json!({"saved": true}))
    }).await.map_err(|e| e.to_string())?
}

// ── 画布快照 ────────────────────────────────────────────────────────────────

fn snapshot_database_path(directory: &str) -> std::path::PathBuf {
    PathBuf::from(directory).join(PROJECT_FILE)
}

#[tauri::command]
pub async fn project_snapshot_list(directory: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        storage_service::list_project_snapshots(&snapshot_database_path(&directory))
    })
    .await
    .map_err(|error| localized_error("native.error.fc29894f70", json!({"error": error.to_string()}), format!("快照列表任务异常：{error}")))?
}

#[tauri::command]
pub async fn project_snapshot_create(directory: String, record: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        storage_service::create_project_snapshot(&snapshot_database_path(&directory), &record)
    })
    .await
    .map_err(|error| localized_error("native.error.fc29894f70", json!({"error": error.to_string()}), format!("快照写入任务异常：{error}")))?
}

#[tauri::command]
pub async fn project_snapshot_read(directory: String, id: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        storage_service::read_project_snapshot(&snapshot_database_path(&directory), &id)
    })
    .await
    .map_err(|error| localized_error("native.error.fc29894f70", json!({"error": error.to_string()}), format!("快照读取任务异常：{error}")))?
}
