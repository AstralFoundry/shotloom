use super::common::{app_data, file_result, localized_error, sanitize_name};
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

fn trash_path(path: String) -> Result<Value, String> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Ok(json!({"ok": true, "missing": true}));
    }
    trash::delete(&path).map_err(|error| error.to_string())?;
    Ok(json!({"ok": true, "path": path.to_string_lossy()}))
}

#[tauri::command]
pub async fn file_trash(path: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || trash_path(path))
        .await
        .map_err(|error| localized_error("native.error.2689ece882", json!({"error": error.to_string()}), format!("回收站任务异常：{error}")))?
}

#[tauri::command]
pub fn file_show_item_in_folder(path: String) -> Result<Value, String> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err(localized_error("native.file.missing", json!({}), "要定位的文件不存在".into()));
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
        .map_err(|error| localized_error("native.file.revealFailed", json!({"detail": error.to_string()}), format!("无法在文件夹中定位文件：{error}")))?;
    Ok(json!({"ok": true, "path": path.to_string_lossy()}))
}

/// 渲染进程不再持有 `shell.open` 权限：路径只能由这里校验后交给系统默认程序。
/// 边界是"目录或媒体文件"，可执行 bundle 与脚本一律拒绝，避免打开路径变成执行代码。
#[tauri::command]
pub fn file_open_path(path: String) -> Result<Value, String> {
    let target = fs::canonicalize(&path).map_err(|_| localized_error("native.file.pathMissing", json!({"path": path}), format!("要打开的路径不存在：{path}")))?;
    if !super::media_paths::is_safe_open_target(&target) {
        return Err(localized_error("native.file.unsafePath", json!({"path": path}), format!("只能打开目录或媒体文件：{path}")));
    }

    #[cfg(target_os = "macos")]
    let opener = ("open", vec![target.as_os_str().to_os_string()]);
    #[cfg(target_os = "windows")]
    let opener = ("explorer.exe", vec![target.as_os_str().to_os_string()]);
    #[cfg(all(unix, not(target_os = "macos")))]
    let opener = ("xdg-open", vec![target.as_os_str().to_os_string()]);

    Command::new(opener.0)
        .args(opener.1)
        .spawn()
        .map_err(|error| localized_error("native.file.openFailed", json!({"detail": error.to_string()}), format!("无法打开路径：{error}")))?;
    Ok(json!({"ok": true, "path": target.to_string_lossy()}))
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

fn export_resource_package(
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
pub async fn file_export_resource_package(
    target: String,
    manifest: Value,
    files: Vec<ResourcePackageFile>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || export_resource_package(target, manifest, files))
        .await
        .map_err(|error| localized_error("native.error.7eed8813cf", json!({"error": error.to_string()}), format!("资源包导出任务异常：{error}")))?
}

fn import_resource_package(
    source: String,
    target_directory: String,
) -> Result<Value, String> {
    let input = fs::File::open(source).map_err(|error| error.to_string())?;
    let mut archive =
        zip::ZipArchive::new(input).map_err(|error| localized_error("native.error.b515037bdd", json!({"error": error.to_string()}), format!("资源包格式无效：{error}")))?;
    let mut manifest_text = String::new();
    archive
        .by_name("manifest.json")
        .map_err(|_| localized_error("native.error.9978a52164", json!({}), "资源包缺少 manifest.json".into()))?
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
        return Err(localized_error("native.error.b0ae636d4a", json!({}), "资源包素材记录缺少 packagePath".into()));
    }
    if package_paths.len() > 10_000 {
        return Err(localized_error("native.error.50e19e1802", json!({}), "资源包文件数超过上限".into()));
    }
    let mut total_size = 0u64;
    for package_path in &package_paths {
        if !package_path.starts_with("files/") || package_path.contains("../") {
            return Err(localized_error("native.error.131621dc50", json!({"package_path": package_path.to_string()}), format!("资源包文件路径无效：{package_path}")));
        }
        let zipped = archive
            .by_name(package_path)
            .map_err(|_| localized_error("native.error.63ac646633", json!({"package_path": package_path.to_string()}), format!("资源包缺少文件：{package_path}")))?;
        total_size = total_size.saturating_add(zipped.size());
    }
    if total_size > 20 * 1024 * 1024 * 1024 {
        return Err(localized_error("native.error.dd32ec29b4", json!({}), "资源包解压后体积超过 20GB 上限".into()));
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
                .map_err(|_| localized_error("native.error.63ac646633", json!({"package_path": package_path.to_string()}), format!("资源包缺少文件：{package_path}")))?;
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
pub async fn file_import_resource_package(
    source: String,
    target_directory: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        import_resource_package(source, target_directory)
    })
    .await
    .map_err(|error| localized_error("native.error.95a5f0f23d", json!({"error": error.to_string()}), format!("资源包导入任务异常：{error}")))?
}

fn read_array_buffer(path: String) -> Result<Value, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(json!(
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[tauri::command]
pub async fn file_read_array_buffer(path: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || read_array_buffer(path))
        .await
        .map_err(|error| localized_error("native.error.551503f128", json!({"error": error.to_string()}), format!("文件读取任务异常：{error}")))?
}

fn write_file(path: String, data: String, append: bool) -> Result<Value, String> {
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
pub async fn file_write(path: String, data: String, append: bool) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || write_file(path, data, append))
        .await
        .map_err(|error| localized_error("native.error.0210358dbb", json!({"error": error.to_string()}), format!("文件写入任务异常：{error}")))?
}

fn copy_file(source: String, target: String) -> Result<Value, String> {
    let target = PathBuf::from(target);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::copy(source, &target).map_err(|error| error.to_string())?;
    file_result(&target)
}

#[tauri::command]
pub async fn file_copy(source: String, target: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || copy_file(source, target))
        .await
        .map_err(|error| localized_error("native.error.8a906c47f1", json!({"error": error.to_string()}), format!("文件复制任务异常：{error}")))?
}


#[tauri::command]
pub fn file_path_exists(path: String) -> Value {
    json!(Path::new(&path).exists())
}

fn checksum_file(path: String) -> Result<Value, String> {
    let mut input = fs::File::open(&path).map_err(|error| error.to_string())?;
    let size = input.metadata().map_err(|error| error.to_string())?.len();
    // 校验和的对象可能是几 GB 的视频，必须分块喂给哈希器，不能整体读进内存。
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = input.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(
        json!({"checksum":format!("{:x}", digest.finalize()),"checksumAlgorithm":"sha256","size":size}),
    )
}

#[tauri::command]
pub async fn file_checksum(path: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || checksum_file(path))
        .await
        .map_err(|error| localized_error("native.error.ce2017d5e1", json!({"error": error.to_string()}), format!("校验和任务异常：{error}")))?
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
