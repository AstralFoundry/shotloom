use super::common::localized_error;
use super::media_tool::media_tool;
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    process::Command,
};

/// 时长与画面尺寸只从容器信息里读，不解码画面。
/// ffprobe 能直接给 JSON；只有 ffmpeg 可用时，从它打印的流信息里取同一对事实。
fn parse_duration(stderr: &str) -> Option<f64> {
    let marker = stderr.find("Duration:")?;
    let rest = stderr[marker + "Duration:".len()..].trim_start();
    let token = rest.split(',').next()?.trim();
    if token.eq_ignore_ascii_case("N/A") {
        return None;
    }
    let mut parts = token.split(':');
    let hours: f64 = parts.next()?.trim().parse().ok()?;
    let minutes: f64 = parts.next()?.trim().parse().ok()?;
    let seconds: f64 = parts.next()?.trim().parse().ok()?;
    let total = hours * 3600.0 + minutes * 60.0 + seconds;
    total.is_finite().then_some(total)
}

fn parse_dimensions(stderr: &str) -> Option<(u32, u32)> {
    for line in stderr.lines() {
        if !line.contains("Video:") {
            continue;
        }
        for token in line.split(|character: char| {
            character.is_whitespace() || character == ',' || character == '(' || character == ')'
        }) {
            let mut parts = token.split('x');
            let (Some(width), Some(height), None) = (parts.next(), parts.next(), parts.next()) else {
                continue;
            };
            let (Ok(width), Ok(height)) = (width.parse::<u32>(), height.parse::<u32>()) else {
                continue;
            };
            // 编解码器标签形如 0x31637661，宽度会是 0，据此排除。
            if width > 0 && height > 0 {
                return Some((width, height));
            }
        }
    }
    None
}

fn probe_with_ffprobe(ffprobe: &Path, source: &Path) -> Option<Value> {
    let output = Command::new(ffprobe)
        .args([
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-show_entries", "format=duration",
            "-of", "json",
        ])
        .arg(source)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let parsed: Value = serde_json::from_slice(&output.stdout).ok()?;
    // 单张图片没有容器时长，时长缺席按 0 返回，尺寸仍然是真实事实。
    let duration = parsed
        .get("format")
        .and_then(|format| format.get("duration"))
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(0.0);
    let stream = parsed.get("streams").and_then(Value::as_array).and_then(|streams| streams.first());
    let width = stream.and_then(|item| item.get("width")).and_then(Value::as_u64).unwrap_or(0);
    let height = stream.and_then(|item| item.get("height")).and_then(Value::as_u64).unwrap_or(0);
    (duration > 0.0 || (width > 0 && height > 0)).then(|| json!({
        "duration": duration,
        "width": width,
        "height": height,
    }))
}

fn probe_with_ffmpeg(ffmpeg: &Path, source: &Path) -> Result<Value, String> {
    let output = Command::new(ffmpeg)
        .args(["-hide_banner", "-i"])
        .arg(source)
        .output()
        .map_err(|error| localized_error("native.error.700ffa2075", json!({"error": error.to_string()}), format!("无法启动媒体探测：{error}")))?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    let duration = parse_duration(&stderr);
    let dimensions = parse_dimensions(&stderr);
    match (duration, dimensions) {
        (None, None) => Err(localized_error("native.error.76ed3ab41a", json!({}), "无法读取媒体信息".into())),
        (duration, dimensions) => {
            let (width, height) = dimensions.unwrap_or((0, 0));
            Ok(json!({ "duration": duration.unwrap_or(0.0), "width": width, "height": height }))
        }
    }
}

fn probe_media(source: String) -> Result<Value, String> {
    let source = PathBuf::from(source);
    if !source.is_file() {
        return Err(localized_error("native.error.eb35c63468", json!({}), "媒体文件不存在".into()));
    }
    if let Ok(ffprobe) = media_tool("ffprobe") {
        if let Some(value) = probe_with_ffprobe(&ffprobe, &source) {
            return Ok(value);
        }
    }
    probe_with_ffmpeg(&media_tool("ffmpeg")?, &source)
}

#[tauri::command]
pub async fn file_probe_media(source: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || probe_media(source))
        .await
        .map_err(|error| localized_error("native.error.a535686ef0", json!({"error": error.to_string()}), format!("媒体探测任务异常：{error}")))?
}
