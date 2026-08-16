use super::common::{app_data, file_result, sanitize_name};
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
};
use tauri::AppHandle;

#[tauri::command]
pub fn file_global_asset_root(app: AppHandle) -> Result<Value, String> {
    let root = app_data(&app)?.join("local-asset-library").join("blobs");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(json!(root.to_string_lossy()))
}

#[tauri::command]
pub fn file_trash(path: String) -> Result<Value, String> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Ok(json!({"ok": true, "missing": true}));
    }
    trash::delete(&path).map_err(|error| error.to_string())?;
    Ok(json!({"ok": true, "path": path.to_string_lossy()}))
}

#[tauri::command]
pub fn file_show_item_in_folder(path: String) -> Result<Value, String> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err("要定位的文件不存在".into());
    }

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg("-R").arg(&path);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer.exe");
        command.arg("/select,").arg(&path);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(path.parent().unwrap_or(&path));
        command
    };

    command
        .spawn()
        .map_err(|error| format!("无法在文件夹中定位文件：{error}"))?;
    Ok(json!({"ok": true, "path": path.to_string_lossy()}))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourcePackageFile {
    source: String,
    archive_name: String,
}

fn unique_file_path(directory: &Path, name: &str) -> PathBuf {
    let requested = sanitize_name(name, "resource.bin");
    let requested_path = Path::new(&requested);
    let stem = requested_path
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("resource");
    let extension = requested_path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("");
    let mut target = directory.join(&requested);
    for index in 2..10_000 {
        if !target.exists() {
            break;
        }
        target = directory.join(if extension.is_empty() {
            format!("{stem}-{index}")
        } else {
            format!("{stem}-{index}.{extension}")
        });
    }
    target
}

#[tauri::command]
pub fn file_export_resource_package(
    target: String,
    manifest: Value,
    files: Vec<ResourcePackageFile>,
) -> Result<Value, String> {
    let target = PathBuf::from(target);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let output = fs::File::create(&target).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipWriter::new(output);
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
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
    for item in files {
        let source = PathBuf::from(&item.source);
        if !source.is_file() {
            continue;
        }
        let archive_name = item.archive_name.replace('\\', "/");
        if !archive_name.starts_with("files/") || archive_name.contains("../") {
            continue;
        }
        archive
            .start_file(archive_name, options)
            .map_err(|error| error.to_string())?;
        let mut input = fs::File::open(source).map_err(|error| error.to_string())?;
        std::io::copy(&mut input, &mut archive).map_err(|error| error.to_string())?;
        count += 1;
    }
    archive.finish().map_err(|error| error.to_string())?;
    Ok(json!({"ok": true, "count": count, "filePath": target.to_string_lossy(), "direct": true}))
}

#[tauri::command]
pub fn file_import_resource_package(
    source: String,
    target_directory: String,
) -> Result<Value, String> {
    let input = fs::File::open(source).map_err(|error| error.to_string())?;
    let mut archive =
        zip::ZipArchive::new(input).map_err(|error| format!("资源包格式无效：{error}"))?;
    let mut manifest_text = String::new();
    archive
        .by_name("manifest.json")
        .map_err(|_| "资源包缺少 manifest.json".to_string())?
        .read_to_string(&mut manifest_text)
        .map_err(|error| error.to_string())?;
    let mut manifest: Value =
        serde_json::from_str(&manifest_text).map_err(|error| error.to_string())?;
    let target_directory = PathBuf::from(target_directory);
    fs::create_dir_all(&target_directory).map_err(|error| error.to_string())?;
    let package_paths: Vec<String> = manifest
        .get("materials")
        .and_then(Value::as_array)
        .map(|materials| {
            materials
                .iter()
                .filter_map(|material| {
                    material
                        .get("packagePath")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .collect()
        })
        .unwrap_or_default();
    let material_count = manifest
        .get("materials")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    if package_paths.len() != material_count {
        return Err("资源包素材记录缺少 packagePath".into());
    }
    if package_paths.len() > 10_000 {
        return Err("资源包文件数超过上限".into());
    }
    let mut total_size = 0u64;
    for package_path in &package_paths {
        if !package_path.starts_with("files/") || package_path.contains("../") {
            return Err(format!("资源包文件路径无效：{package_path}"));
        }
        let zipped = archive
            .by_name(package_path)
            .map_err(|_| format!("资源包缺少文件：{package_path}"))?;
        total_size = total_size.saturating_add(zipped.size());
    }
    if total_size > 20 * 1024 * 1024 * 1024 {
        return Err("资源包解压后体积超过 20GB 上限".into());
    }
    if let Some(materials) = manifest.get_mut("materials").and_then(Value::as_array_mut) {
        for material in materials {
            let package_path = material
                .get("packagePath")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if !package_path.starts_with("files/") || package_path.contains("../") {
                continue;
            }
            let preferred = material
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("resource.bin");
            let target = unique_file_path(&target_directory, preferred);
            let mut zipped = archive
                .by_name(&package_path)
                .map_err(|_| format!("资源包缺少文件：{package_path}"))?;
            let mut output = fs::File::create(&target).map_err(|error| error.to_string())?;
            std::io::copy(&mut zipped, &mut output).map_err(|error| error.to_string())?;
            material["path"] = json!(target.to_string_lossy());
            material["filePath"] = json!(target.to_string_lossy());
            material["storageScope"] = json!("project");
        }
    }
    Ok(manifest)
}

#[tauri::command]
pub fn file_read_array_buffer(path: String) -> Result<Value, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(json!(
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[tauri::command]
pub fn file_write(path: String, data: String, append: bool) -> Result<Value, String> {
    let path = PathBuf::from(path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|error| error.to_string())?;
    if append {
        use std::io::Write;
        fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .and_then(|mut file| file.write_all(&bytes))
            .map_err(|error| error.to_string())?;
    } else {
        fs::write(&path, bytes).map_err(|error| error.to_string())?;
    }
    file_result(&path)
}

#[tauri::command]
pub fn file_copy(source: String, target: String) -> Result<Value, String> {
    let target = PathBuf::from(target);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::copy(source, &target).map_err(|error| error.to_string())?;
    file_result(&target)
}


#[tauri::command]
pub fn file_path_exists(path: String) -> Value {
    json!(Path::new(&path).exists())
}

#[tauri::command]
pub fn file_checksum(path: String) -> Result<Value, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(
        json!({"checksum":format!("{:x}", Sha256::digest(&bytes)),"checksumAlgorithm":"sha256","size":bytes.len()}),
    )
}

#[tauri::command]
pub fn file_resolve_unique_path(directory: String, name: String) -> Value {
    let directory = PathBuf::from(directory);
    let requested = sanitize_name(&name, "resource.bin");
    let requested_path = Path::new(&requested);
    let stem = requested_path
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("resource");
    let extension = requested_path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("");
    let mut target = directory.join(&requested);
    for index in 2..10_000 {
        if !target.exists() {
            break;
        }
        target = directory.join(if extension.is_empty() {
            format!("{stem}-{index}")
        } else {
            format!("{stem}-{index}.{extension}")
        });
    }
    json!(target.to_string_lossy())
}
