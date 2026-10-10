use super::{audio::source_has_audio, common::file_result, media_tool::media_tool};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

#[derive(Debug, Clone, PartialEq)]
struct VideoInfo {
    width: u32,
    height: u32,
    fps: f64,
}

/// 扫描一行中的 `宽x高`。必须跳过 `[0x1]`、`0x31637661` 这类十六进制片段，
/// 所以只有落在真实画面尺寸范围内的候选才被接受。
fn find_dimensions(line: &str) -> Option<(u32, u32)> {
    let bytes = line.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if !bytes[index].is_ascii_digit() {
            index += 1;
            continue;
        }
        let width_start = index;
        while index < bytes.len() && bytes[index].is_ascii_digit() {
            index += 1;
        }
        if index < bytes.len() && bytes[index] == b'x' {
            let width_end = index;
            index += 1;
            let height_start = index;
            while index < bytes.len() && bytes[index].is_ascii_digit() {
                index += 1;
            }
            if index > height_start {
                let width = line[width_start..width_end].parse::<u32>().ok();
                let height = line[height_start..index].parse::<u32>().ok();
                if let (Some(width), Some(height)) = (width, height) {
                    if (16..=16384).contains(&width) && (16..=16384).contains(&height) {
                        return Some((width, height));
                    }
                }
            }
        }
        index += 1;
    }
    None
}

/// 取 ` fps` 前面的数字。找不到时由调用方退回默认帧率。
fn find_fps(line: &str) -> Option<f64> {
    let marker = line.find(" fps")?;
    let prefix = &line[..marker];
    let start = prefix
        .rfind(|value: char| !(value.is_ascii_digit() || value == '.'))
        .map(|position| position + 1)
        .unwrap_or(0);
    prefix[start..].trim().parse::<f64>().ok()
}

fn video_stream_line(stderr: &str) -> &str {
    stderr
        .lines()
        .find(|line| line.contains("Video:"))
        .unwrap_or("")
}

fn probe_video(ffmpeg: &Path, source: &Path) -> Result<VideoInfo, String> {
    // ffmpeg-static 不带 ffprobe，`-i` 无输出文件时信息写在 stderr 上。
    let output = Command::new(ffmpeg)
        .args(["-hide_banner", "-i"])
        .arg(source)
        .output()
        .map_err(|error| format!("无法读取视频信息：{error}"))?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    let line = video_stream_line(&stderr);
    if line.is_empty() {
        return Err(format!("不是可识别的视频文件：{}", source.display()));
    }
    let (width, height) = find_dimensions(line)
        .ok_or_else(|| format!("无法读取视频尺寸：{}", source.display()))?;
    Ok(VideoInfo {
        width,
        height,
        fps: find_fps(line).unwrap_or(30.0),
    })
}

/// 每个输入先等比缩放居中补黑边到基准尺寸、统一帧率与像素格式，再整体 concat。
/// 只有全部输入都带音轨时才拼接音频：混合情况拼接会因缺少输入流直接失败，
/// 此时保留画面并显式丢弃音频，由调用方在回执里说明。
fn build_concat_filter(width: u32, height: u32, fps: f64, count: usize, with_audio: bool) -> String {
    let mut parts = Vec::with_capacity(count * 2 + 1);
    for index in 0..count {
        parts.push(format!(
            "[{index}:v]scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps={fps},format=yuv420p[v{index}]"
        ));
    }
    if with_audio {
        for index in 0..count {
            parts.push(format!("[{index}:a]aresample=async=1:first_pts=0[a{index}]"));
        }
    }
    let mut inputs = String::new();
    for index in 0..count {
        inputs.push_str(&format!("[v{index}]"));
        if with_audio {
            inputs.push_str(&format!("[a{index}]"));
        }
    }
    parts.push(format!(
        "{inputs}concat=n={count}:v=1:a={}{}",
        usize::from(with_audio),
        if with_audio { "[outv][outa]" } else { "[outv]" }
    ));
    parts.join(";")
}

fn concat_videos(sources: Vec<String>, target: String) -> Result<Value, String> {
    if sources.len() < 2 {
        return Err("视频拼接至少需要两个文件".into());
    }
    let paths: Vec<PathBuf> = sources.iter().map(PathBuf::from).collect();
    for path in &paths {
        if !path.is_file() {
            return Err(format!("视频文件不存在：{}", path.display()));
        }
    }
    let target = PathBuf::from(target);
    if target.as_os_str().is_empty() {
        return Err("缺少拼接输出路径".into());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建拼接目录：{error}"))?;
    }
    let ffmpeg = media_tool("ffmpeg")?;
    let mut infos = Vec::with_capacity(paths.len());
    let mut audios = Vec::with_capacity(paths.len());
    for path in &paths {
        infos.push(probe_video(&ffmpeg, path)?);
        audios.push(source_has_audio(&ffmpeg, path));
    }
    let base = infos[0].clone();
    let with_audio = audios.iter().all(|value| *value);
    let filter = build_concat_filter(base.width, base.height, base.fps, paths.len(), with_audio);

    let mut command = Command::new(&ffmpeg);
    command.args(["-hide_banner", "-loglevel", "error", "-y"]);
    for path in &paths {
        command.arg("-i").arg(path);
    }
    command.args(["-filter_complex", &filter, "-map", "[outv]"]);
    if with_audio {
        command.args(["-map", "[outa]", "-c:a", "aac", "-b:a", "192k"]);
    } else {
        command.arg("-an");
    }
    command.args([
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
    ]);
    command.arg(&target);

    let output = command
        .output()
        .map_err(|error| format!("无法启动视频拼接：{error}"))?;
    if !output.status.success() || !target.is_file() {
        let _ = fs::remove_file(&target);
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "视频拼接失败".into()
        } else {
            detail
        });
    }
    let mut result = file_result(&target)?;
    if let Some(object) = result.as_object_mut() {
        object.insert("engine".into(), json!("rust-ffmpeg-concat"));
        object.insert("audioDropped".into(), json!(!with_audio && audios.iter().any(|value| *value)));
        object.insert("width".into(), json!(base.width));
        object.insert("height".into(), json!(base.height));
    }
    Ok(result)
}

#[tauri::command]
pub async fn file_concat_videos(sources: Vec<String>, target: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || concat_videos(sources, target))
        .await
        .map_err(|error| format!("视频拼接任务异常：{error}"))?
}

#[cfg(test)]
mod concat_tests {
    use super::*;
    use crate::commands::common::chrono_stamp;

    #[test]
    fn dimensions_skip_hex_stream_ids_and_codec_tags() {
        let line = "  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 1280x720 [SAR 1:1 DAR 16:9], 10958 kb/s, 30 fps, 30 tbr";
        assert_eq!(find_dimensions(line), Some((1280, 720)));
    }

    #[test]
    fn dimensions_and_fps_read_real_stream_facts() {
        let line = "  Stream #0:0: Video: hevc, yuv420p, 1920x1080, 29.97 fps, 29.97 tbr";
        assert_eq!(find_dimensions(line), Some((1920, 1080)));
        assert_eq!(find_fps(line), Some(29.97));
        assert_eq!(find_fps("  Stream #0:0: Video: h264, 1280x720, 25 tbr"), None);
        assert_eq!(find_dimensions("  Stream #0:0: Audio: aac, 44100 Hz, stereo"), None);
    }

    #[test]
    fn concat_filter_normalizes_every_input_to_the_base_frame() {
        let filter = build_concat_filter(1280, 720, 30.0, 3, false);
        assert!(filter.contains("[0:v]scale=1280:720:force_original_aspect_ratio=decrease"));
        assert!(filter.contains("pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black"));
        assert!(filter.contains("fps=30,format=yuv420p[v2]"));
        assert!(filter.contains("[v0][v1][v2]concat=n=3:v=1:a=0[outv]"));
        assert!(!filter.contains("[0:a]"));
        assert!(!filter.contains("[outa]"));
    }

    #[test]
    fn concat_filter_keeps_audio_only_when_every_input_has_a_track() {
        let filter = build_concat_filter(640, 480, 25.0, 2, true);
        assert!(filter.contains("[0:a]aresample=async=1:first_pts=0[a0]"));
        assert!(filter.contains("[1:a]aresample=async=1:first_pts=0[a1]"));
        assert!(filter.contains("[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]"));
    }

    fn stream_duration(ffmpeg: &Path, source: &Path) -> f64 {
        let output = Command::new(ffmpeg)
            .args(["-hide_banner", "-i"])
            .arg(source)
            .output()
            .unwrap();
        let stderr = String::from_utf8_lossy(&output.stderr);
        let marker = stderr.find("Duration:").expect("ffmpeg 输出缺少时长");
        let stamp = stderr[marker + "Duration:".len()..]
            .split(',')
            .next()
            .unwrap()
            .trim()
            .to_string();
        let mut parts = stamp.split(':');
        let hours: f64 = parts.next().unwrap().trim().parse().unwrap();
        let minutes: f64 = parts.next().unwrap().trim().parse().unwrap();
        let seconds: f64 = parts.next().unwrap().trim().parse().unwrap();
        hours * 3600.0 + minutes * 60.0 + seconds
    }

    fn generate(ffmpeg: &Path, target: &Path, args: &[&str]) {
        let status = Command::new(ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-y"])
            .args(args)
            .arg(target)
            .status()
            .unwrap();
        assert!(status.success(), "无法生成测试视频 {}", target.display());
    }

    /// 真实 ffmpeg 端到端：两段不同分辨率、且只有一段带音轨 —— 同时覆盖尺寸归一化与
    /// 混合音轨丢音两条路径，并核验成片时长确实是首尾相接。
    #[test]
    fn concat_joins_mismatched_sources_and_reports_dropped_audio() {
        let Ok(ffmpeg) = media_tool("ffmpeg") else {
            return;
        };
        let root = std::env::temp_dir().join(format!("shotloom-concat-{}", chrono_stamp()));
        fs::create_dir_all(&root).unwrap();
        let first = root.join("first.mp4");
        let second = root.join("second.mp4");
        let target = root.join("merged.mp4");
        generate(&ffmpeg, &first, &[
            "-f", "lavfi", "-i", "testsrc=size=320x180:rate=25",
            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
            "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
        ]);
        generate(&ffmpeg, &second, &[
            "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30",
            "-t", "1.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an",
        ]);

        let result = concat_videos(
            vec![
                first.to_string_lossy().into_owned(),
                second.to_string_lossy().into_owned(),
            ],
            target.to_string_lossy().into_owned(),
        )
        .unwrap();

        assert_eq!(result["audioDropped"], json!(true));
        assert_eq!(result["width"], json!(320));
        assert_eq!(result["height"], json!(180));
        assert_eq!(probe_video(&ffmpeg, &target).unwrap().width, 320);
        let expected = stream_duration(&ffmpeg, &first) + stream_duration(&ffmpeg, &second);
        let merged = stream_duration(&ffmpeg, &target);
        assert!(
            (merged - expected).abs() < 0.5,
            "拼接时长 {merged} 与两段之和 {expected} 不符"
        );
        let _ = fs::remove_dir_all(&root);
    }
}
