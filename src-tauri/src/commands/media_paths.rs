use serde_json::json;
use super::common::localized_error;
use std::{
    fs,
    path::{Path, PathBuf},
};

/// 模型输入文件的读取边界。
///
/// `generation_request` 的 multipart 资源路径由渲染进程提交，而提示注入和厂商返回内容都
/// 可能 influence 它，所以"能读哪个文件"不能完全交给请求声明。项目内的媒体与人工从主目录
/// 挑选的素材都能正常上传；凭据文件、隐藏目录和项目之外的任意路径会被拒绝。
const MAX_MODEL_INPUT_BYTES: u64 = 512 * 1024 * 1024;

/// 厂商 multipart 只接受媒体文件；按扩展名收口，`.json`/`.env` 这类配置不会被外发。
const MEDIA_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "heic", "heif", "avif", "mp4",
    "mov", "m4v", "webm", "avi", "mkv", "mp3", "wav", "aac", "m4a", "ogg", "flac", "opus",
];

/// 厂商 multipart 与"用系统默认程序打开"都只接受媒体文件；按扩展名收口，
/// `.json`/`.env`/`.app`/`.command` 这类配置与可执行内容不会被读取或启动。
pub fn is_media_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| MEDIA_EXTENSIONS.contains(&value.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn has_hidden_component(path: &Path) -> bool {
    path.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .map(|value| value.starts_with('.') && value != "." && value != "..")
            .unwrap_or(false)
    })
}

fn is_within(candidate: &Path, root: &Path) -> bool {
    !root.as_os_str().is_empty() && candidate.starts_with(root)
}

/// 交给系统默认程序打开的目录后缀。这些 bundle 被 `open` 消费就是执行代码，
/// 即使它们看起来只是"一个文件夹"。
const EXECUTABLE_BUNDLE_SUFFIXES: &[&str] = &[
    "app", "pkg", "dmg", "command", "workflow", "band", "component", "framework", "kext",
    "bundle", "plugin", "service", "xpc", "prefpane", "mdimporter", "qlgenerator",
];

/// "在系统中打开"只允许目录和普通媒体文件；可执行 bundle 与脚本一律拒绝。
pub fn is_safe_open_target(target: &Path) -> bool {
    if is_media_extension(target) {
        return true;
    }
    if !fs::metadata(target).map(|metadata| metadata.is_dir()).unwrap_or(false) {
        return false;
    }
    !target
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| EXECUTABLE_BUNDLE_SUFFIXES.contains(&value.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// 应用数据目录（项目默认根目录与内置素材库都在这里）内的文件总是可读；主目录之外一律
/// 拒绝；主目录内只接受"用户自己挑选的媒体文件"，即带媒体扩展名且不含隐藏目录段的路径。
pub fn classify_media_file(target: &Path, app_data: &Path, home: Option<&Path>) -> Result<(), String> {
    if is_within(target, app_data) {
        return Ok(());
    }
    let inside_home = home.map(|root| is_within(target, root)).unwrap_or(false);
    if !inside_home {
        return Err(localized_error("native.error.f05957ef70", json!({"path": (target.display()).to_string()}), format!(
            "模型输入文件必须位于当前项目目录、素材库或用户主目录内：{}",
            target.display()
        )));
    }
    if has_hidden_component(target) || !is_media_extension(target) {
        return Err(localized_error("native.error.3949522951", json!({"path": (target.display()).to_string()}), format!(
            "项目目录之外的模型输入只能是媒体文件：{}",
            target.display()
        )));
    }
    Ok(())
}

/// 校验并返回可读取的真实路径，同时执行模型输入的大小上限。
/// canonicalize 之后所有判断都作用在解析过符号链接的真实路径上，链接无法把请求带出边界。
pub fn resolve_input_file(app_data: &Path, home: Option<&Path>, path: &str) -> Result<PathBuf, String> {
    let resolved = fs::canonicalize(path)
        .map_err(|error| localized_error("native.error.6fd93f3505", json!({"path": path.to_string(), "error": error.to_string()}), format!("无法读取模型输入文件 {path}: {error}")))?;
    if !resolved.is_file() {
        return Err(localized_error("native.error.68ec0e94d7", json!({"path": path.to_string()}), format!("模型输入文件不存在或不是普通文件：{path}")));
    }
    classify_media_file(&resolved, app_data, home)?;
    let size = resolved.metadata().map_err(|error| error.to_string())?.len();
    if size > MAX_MODEL_INPUT_BYTES {
        return Err(localized_error("native.error.534ec3e54f", json!({"size": (size / (1024 * 1024)).to_string(), "path": (path).to_string()}), format!(
            "模型输入文件 {path} 有 {} MB，超过网关允许的最大输入体积",
            size / (1024 * 1024)
        )));
    }
    Ok(resolved)
}

/// 用户主目录是"人工在文件对话框里挑选的素材"的现实边界。
pub fn home_root() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn denied_input_error_preserves_resolved_path_in_localization_envelope() {
        let target = Path::new("/outside-shotloom/media.mp4");
        let error = classify_media_file(target, Path::new("/shotloom-data"), None).unwrap_err();
        let envelope: serde_json::Value = serde_json::from_str(&error).unwrap();
        assert_eq!(envelope["type"], "shotloom:localized-error");
        assert_eq!(envelope["params"]["path"], target.display().to_string());
        assert!(envelope["key"].as_str().unwrap().starts_with("native.error."));
        assert!(envelope["fallback"].as_str().unwrap().contains("/outside-shotloom/media.mp4"));
    }


    fn temp_root(name: &str) -> PathBuf {
        let base = std::env::temp_dir()
            .join(format!("shotloom-media-paths-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        fs::canonicalize(&base).unwrap()
    }

    #[test]
    fn project_and_library_directories_are_trusted() {
        let base = temp_root("trusted");
        let app_data = base.join("appdata");
        let project = base.join("home").join("Documents").join("show-1");
        fs::create_dir_all(app_data.join("local-asset-library").join("blobs")).unwrap();
        fs::create_dir_all(project.join("assets")).unwrap();
        let video = project.join("assets").join("clip.mp4");
        fs::write(&video, b"clip").unwrap();
        assert!(classify_media_file(&video, &app_data, Some(&base.join("home"))).is_ok());
        let library = app_data.join("local-asset-library").join("blobs").join("a.bin");
        assert!(classify_media_file(&library, &app_data, Some(&base.join("home"))).is_ok());
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn outside_files_are_limited_to_home_media_without_hidden_parts() {
        let base = temp_root("outside");
        let home = base.join("home");
        let app_data = base.join("appdata");
        fs::create_dir_all(home.join("Downloads")).unwrap();
        fs::create_dir_all(home.join(".ssh")).unwrap();
        fs::create_dir_all(&app_data).unwrap();
        fs::write(home.join("Downloads").join("reference.png"), b"png").unwrap();
        let picked = fs::canonicalize(home.join("Downloads").join("reference.png")).unwrap();
        assert!(classify_media_file(&picked, &app_data, Some(&home)).is_ok());
        fs::write(home.join(".ssh").join("id_rsa"), b"secret").unwrap();
        assert!(
            classify_media_file(&home.join(".ssh").join("id_rsa"), &app_data, Some(&home)).is_err()
        );
        fs::write(home.join("Downloads").join("settings.json"), b"{}").unwrap();
        assert!(classify_media_file(
            &home.join("Downloads").join("settings.json"),
            &app_data,
            Some(&home)
        )
        .is_err());
        assert!(classify_media_file(
            Path::new("/etc/hosts"),
            &app_data,
            Some(&home)
        )
        .is_err());
        assert!(classify_media_file(&home.join("Downloads").join("gone.mp4"), &app_data, Some(&home))
            .is_ok());
        let error = resolve_input_file(&app_data, Some(&home), &home.join("missing.mp4").to_string_lossy())
            .expect_err("missing file must not resolve");
        assert!(error.contains("无法读取模型输入文件"));
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn open_targets_exclude_executable_bundles_and_plain_files() {
        let base = temp_root("open-target");
        let folder = base.join("素材");
        fs::create_dir_all(&folder).unwrap();
        let app_bundle = base.join("Calculator.app");
        fs::create_dir_all(&app_bundle).unwrap();
        fs::write(base.join("run.command"), b"#!/bin/sh").unwrap();
        fs::write(base.join("clip.mp4"), b"clip").unwrap();
        assert!(is_safe_open_target(&folder));
        assert!(is_safe_open_target(&base.join("clip.mp4")));
        assert!(!is_safe_open_target(&app_bundle));
        assert!(!is_safe_open_target(&base.join("run.command")));
        fs::remove_dir_all(base).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symlink_cannot_escape_the_read_boundary() {
        let base = temp_root("symlink");
        let home = base.join("home");
        let app_data = base.join("appdata");
        fs::create_dir_all(home.join("project")).unwrap();
        let blobs = app_data.join("local-asset-library").join("blobs");
        fs::create_dir_all(&blobs).unwrap();
        // 链接本身位于可信的应用数据目录，按表面路径判断就会被它骗过；
        // 所有边界都只作用于 canonicalize 之后的真实目标。
        let outside = base.join("elsewhere");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.png"), b"secret").unwrap();
        let escaped = blobs.join("follow.png");
        std::os::unix::fs::symlink(outside.join("secret.png"), &escaped).unwrap();
        assert!(is_within(&escaped, &app_data));
        assert!(!is_within(&fs::canonicalize(&escaped).unwrap(), &app_data));
        assert!(classify_media_file(&fs::canonicalize(&escaped).unwrap(), &app_data, Some(&home),)
            .is_err());
        fs::remove_dir_all(base).unwrap();
    }
}
