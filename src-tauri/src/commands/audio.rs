use super::{common::file_result, media_tool::media_tool};
use serde_json::{json, Value};
use std::{fs, path::{Path, PathBuf}, process::Command};

pub(crate) fn source_has_audio(ffmpeg: &Path, source: &Path) -> bool {
    Command::new(ffmpeg)
        .args(["-v", "error", "-i"])
        .arg(source)
        .args(["-map", "0:a:0", "-frames:a", "1", "-f", "null", "-"])
        .output()
        .is_ok_and(|output| output.status.success())
}

fn probe_audio(source: String) -> Result<bool, String> {
    let source = PathBuf::from(source);
    if !source.is_file() { return Err("视频文件不存在".into()); }
    let ffmpeg = media_tool("ffmpeg")?;
    Ok(source_has_audio(&ffmpeg, &source))
}

#[tauri::command]
pub async fn file_has_audio(source: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || probe_audio(source))
        .await
        .map_err(|error| format!("音轨检测任务异常：{error}"))?
}

fn separate_audio(source: String, audio_target: String, silent_video_target: String) -> Result<Value, String> {
    let source = PathBuf::from(source);
    if !source.is_file() { return Err("视频文件不存在".into()); }
    let ffmpeg = media_tool("ffmpeg")?;
    if !source_has_audio(&ffmpeg, &source) { return Err("当前视频不包含可分离的音轨".into()); }
    let audio_target = PathBuf::from(audio_target);
    let silent_video_target = PathBuf::from(silent_video_target);
    for target in [&audio_target, &silent_video_target] {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("无法创建拆分目录：{error}"))?;
        }
    }
    let output = Command::new(&ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(&source)
        .args(["-map", "0:a:0", "-vn", "-c:a", "aac", "-b:a", "192k"])
        .arg(&audio_target)
        .args(["-map", "0:v:0", "-an", "-c:v", "copy", "-movflags", "+faststart"])
        .arg(&silent_video_target)
        .output()
        .map_err(|error| format!("无法启动音频分离：{error}"))?;
    if !output.status.success() {
        let _ = fs::remove_file(&audio_target);
        let _ = fs::remove_file(&silent_video_target);
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() { "音频分离失败".into() } else { detail });
    }
    Ok(json!({ "audio": file_result(&audio_target)?, "video": file_result(&silent_video_target)? }))
}

#[tauri::command]
pub async fn file_separate_audio(source: String, audio_target: String, silent_video_target: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || separate_audio(source, audio_target, silent_video_target))
        .await
        .map_err(|error| format!("音视频拆分任务异常：{error}"))?
}
