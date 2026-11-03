use super::common::localized_error;
use super::{common::file_result, media_tool::media_tool};
use serde_json::{json, Value};
use std::{fs, path::PathBuf, process::Command};

fn capture_frame(source: String, target: String, seconds: f64) -> Result<Value, String> {
    if !seconds.is_finite() || seconds < 0.0 {
        return Err(localized_error("native.error.3f51b31f6e", json!({}), "截帧时间无效".into()));
    }
    let source = PathBuf::from(source);
    if !source.is_file() {
        return Err(localized_error("native.error.f867756ee1", json!({}), "视频文件不存在".into()));
    }
    let target = PathBuf::from(target);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| localized_error("native.error.b849c6e2ad", json!({"error": error.to_string()}), format!("无法创建截帧目录：{error}")))?;
    }
    let ffmpeg = media_tool("ffmpeg")?;
    let output = Command::new(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-y", "-ss"])
        .arg(format!("{seconds:.3}"))
        .arg("-i")
        .arg(&source)
        .args(["-map", "0:v:0", "-frames:v", "1", "-an"])
        .arg(&target)
        .output()
        .map_err(|error| localized_error("native.error.bec71471c7", json!({"error": error.to_string()}), format!("无法启动视频截帧：{error}")))?;
    if !output.status.success() || !target.is_file() {
        let _ = fs::remove_file(&target);
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() { localized_error("native.error.22c399361b", json!({}), "视频截帧失败".into()) } else { detail });
    }
    file_result(&target)
}

#[tauri::command]
pub async fn file_capture_video_frame(source: String, target: String, seconds: f64) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || capture_frame(source, target, seconds))
        .await
        .map_err(|error| localized_error("native.error.f4fa37ffed", json!({"error": error.to_string()}), format!("视频截帧任务异常：{error}")))?
}
