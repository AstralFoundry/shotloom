use super::common::localized_error;
use super::{common::file_result, media_tool::media_tool};
use serde_json::{json, Value};
use serde::Deserialize;
use std::{fs, path::PathBuf, process::Command};

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FrameEndpoint { Last }

#[derive(Deserialize)]
#[serde(untagged)]
pub enum FramePosition { Seconds(f64), Endpoint(FrameEndpoint) }

fn capture_frame(source: String, target: String, seconds: FramePosition) -> Result<Value, String> {
    if matches!(seconds, FramePosition::Seconds(value) if !value.is_finite() || value < 0.0) {
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
    let last = matches!(seconds, FramePosition::Endpoint(FrameEndpoint::Last));
    let run = |seek_tail: bool| {
        let mut command = Command::new(&ffmpeg);
        command.args(["-hide_banner", "-loglevel", "error", "-y"]);
        match seconds {
            FramePosition::Seconds(value) => { command.arg("-ss").arg(format!("{value:.6}")); }
            FramePosition::Endpoint(_) if seek_tail => { command.args(["-sseof", "-1"]); }
            _ => {}
        }
        command.arg("-i").arg(&source).args(["-map", "0:v:0", "-an"]);
        if last {
            // Replace the same image as frames arrive; EOF leaves the actual
            // last decoded frame, without retaining a reversed video in memory.
            command.args(["-fps_mode", "passthrough", "-update", "1"]);
        } else {
            command.args(["-frames:v", "1"]);
        }
        command.arg(&target).output().map_err(|error|
            localized_error("native.error.bec71471c7", json!({"error": error.to_string()}), format!("无法启动视频截帧：{error}")))
    };
    let mut output = run(last)?;
    // Container EOF can follow video EOF (e.g. a longer audio track). If the
    // tail contains no video, decode from the beginning to find its real end.
    if last && output.status.success() && !target.is_file() {
        output = run(false)?;
    }
    if !output.status.success() || !target.is_file() {
        let _ = fs::remove_file(&target);
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() { localized_error("native.error.22c399361b", json!({}), "视频截帧失败".into()) } else { detail });
    }
    file_result(&target)
}

#[tauri::command]
pub async fn file_capture_video_frame(source: String, target: String, seconds: FramePosition) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || capture_frame(source, target, seconds))
        .await
        .map_err(|error| localized_error("native.error.f4fa37ffed", json!({"error": error.to_string()}), format!("视频截帧任务异常：{error}")))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn last_frame_matches_decode_for_low_fps_short_and_audio_extended_video() {
        let ffmpeg = media_tool("ffmpeg").expect("FFmpeg is required for media regression tests");
        let root = std::env::temp_dir().join(format!("shotloom-last-frame-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let result = std::panic::catch_unwind(|| {
            for (name, rate, duration, audio) in [
                ("low-fps", "2", "3", false),
                ("short", "24", "0.2", false),
                ("long-audio", "2", "1", true),
            ] {
                let source = root.join(format!("{name}.mp4"));
                let target = root.join(format!("{name}.png"));
                let expected = root.join(format!("{name}-expected.png"));
                let mut generate = Command::new(&ffmpeg);
                generate.args(["-v", "error", "-y", "-f", "lavfi", "-i"])
                    .arg(format!("testsrc2=size=32x32:rate={rate}:duration={duration}"));
                if audio {
                    generate.args(["-f", "lavfi", "-i", "sine=duration=5", "-c:a", "aac"]);
                }
                assert!(generate.args(["-c:v", "libx264", "-pix_fmt", "yuv420p"]).arg(&source).status().unwrap().success());
                if name == "low-fps" {
                    // The former duration - 1/30 seek lands after the final
                    // frame (2.5s) of this 3s, 2fps video and produces no image.
                    assert!(capture_frame(source.to_string_lossy().into(),
                        root.join("old-tail.png").to_string_lossy().into(),
                        FramePosition::Seconds(3.0 - 1.0 / 30.0)).is_err());
                }
                capture_frame(source.to_string_lossy().into(), target.to_string_lossy().into(),
                    FramePosition::Endpoint(FrameEndpoint::Last)).unwrap();
                // Independent oracle: reverse this tiny video, then take its first frame.
                assert!(Command::new(&ffmpeg).args(["-v", "error", "-y", "-i"])
                    .arg(&source).args(["-vf", "reverse", "-frames:v", "1", "-an"])
                    .arg(&expected).status().unwrap().success());
                assert_eq!(fs::read(&target).unwrap(), fs::read(&expected).unwrap(), "{name}");
                let first = root.join(format!("{name}-first.png"));
                capture_frame(source.to_string_lossy().into(), first.to_string_lossy().into(),
                    FramePosition::Seconds(0.0)).unwrap();
                assert!(first.is_file());
            }
        });
        let _ = fs::remove_dir_all(root);
        if let Err(error) = result { std::panic::resume_unwind(error); }
    }
}
