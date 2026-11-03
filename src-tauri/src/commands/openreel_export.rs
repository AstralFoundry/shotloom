use super::common::localized_error;
use super::{
    common::{file_result, PROJECT_FILE},
    media_tasks::run_ffmpeg,
    media_tool::media_tool,
};
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::{Seek, SeekFrom, Write},
    path::PathBuf,
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeEncoderSettings {
    width: u32,
    height: u32,
    frame_rate: f64,
    total_frames: u64,
    codec: String,
    format: String,
    audio_sample_rate: u32,
    audio_channels: u16,
    #[serde(default)]
    prores_profile: Option<String>,
}

impl NativeEncoderSettings {
    fn validate(&self) -> Result<(), String> {
        if self.width == 0
            || self.height == 0
            || self.frame_bytes() > 256 * 1024 * 1024
            || !self.frame_rate.is_finite()
            || self.frame_rate <= 0.0
            || self.frame_rate > 240.0
            || self.total_frames == 0
            || ![44100, 48000, 96000].contains(&self.audio_sample_rate)
            || ![1, 2].contains(&self.audio_channels)
        {
            return Err(localized_error("native.error.dfa69e55f7", json!({}), "Invalid native encoder dimensions, timing or audio settings".into()));
        }
        let valid = match self.format.as_str() {
            "mp4" => ["h264", "h265"].contains(&self.codec.as_str()),
            "webm" => ["vp8", "vp9"].contains(&self.codec.as_str()),
            "mov" => ["h264", "h265", "prores"].contains(&self.codec.as_str()),
            _ => false,
        };
        if !valid {
            return Err(localized_error("native.error.948f33bcc3", json!({}), "Unsupported native codec/container pair".into()));
        }
        if self
            .prores_profile
            .as_deref()
            .is_some_and(|p| !["proxy", "lt", "standard", "hq", "4444", "4444xq"].contains(&p))
        {
            return Err(localized_error("native.error.8d532e07cb", json!({}), "Unknown ProRes profile".into()));
        }
        Ok(())
    }
    fn frame_bytes(&self) -> u64 {
        u64::from(self.width) * u64::from(self.height) * 4
    }
}

#[derive(Default)]
struct StreamState {
    frames: u64,
    audio_bytes: u64,
    encoding: bool,
}
struct ExportJob {
    owner: String,
    settings: NativeEncoderSettings,
    scratch: PathBuf,
    output: PathBuf,
    cancelled: AtomicBool,
    stream: Mutex<StreamState>,
}
impl Drop for ExportJob {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.scratch);
    }
}

#[derive(Default)]
pub struct OpenReelExportState {
    jobs: Mutex<HashMap<String, Arc<ExportJob>>>,
}
impl OpenReelExportState {
    pub fn shutdown(&self, owner: Option<&str>) {
        if let Ok(mut jobs) = self.jobs.lock() {
            jobs.retain(|_, job| {
                if owner.is_none_or(|owner| job.owner == owner) {
                    job.cancelled.store(true, Ordering::Release);
                    false
                } else {
                    true
                }
            });
        }
    }
    fn get(&self, owner: &str, id: &str) -> Result<Arc<ExportJob>, String> {
        let jobs = self.jobs.lock().map_err(|_| localized_error("native.error.07672da77d", json!({}), "Export registry poisoned".into()))?;
        let job = jobs
            .get(id)
            .filter(|job| job.owner == owner)
            .ok_or_else(|| localized_error("native.error.cf621a4f6c", json!({}), "Native export session not found".into()))?;
        if job.cancelled.load(Ordering::Acquire) {
            return Err(localized_error("native.error.2bb8d03cf9", json!({}), "Native export cancelled".into()));
        }
        Ok(job.clone())
    }
    fn start(
        &self,
        owner: String,
        project_dir: String,
        settings: NativeEncoderSettings,
    ) -> Result<String, String> {
        settings.validate()?;
        media_tool("ffmpeg")?;
        let root = fs::canonicalize(project_dir).map_err(|e| e.to_string())?;
        if !root.join(PROJECT_FILE).is_file() {
            return Err(localized_error("native.error.ce0baa2719", json!({}), "Native export requires a saved Shotloom project".into()));
        }
        let assets = root.join("assets");
        fs::create_dir_all(&assets).map_err(|e| e.to_string())?;
        let assets = fs::canonicalize(assets).map_err(|e| e.to_string())?;
        if !assets.starts_with(&root) {
            return Err(localized_error("native.error.948293cf73", json!({}), "Project assets escape the project directory".into()));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let scratch = std::env::temp_dir().join(format!("shotloom-openreel-{id}"));
        fs::create_dir(&scratch).map_err(|e| e.to_string())?;
        let output = assets.join(format!("openreel-{id}.{}", settings.format));
        let job = Arc::new(ExportJob {
            owner,
            settings,
            scratch,
            output,
            cancelled: AtomicBool::new(false),
            stream: Mutex::new(StreamState::default()),
        });
        self.jobs
            .lock()
            .map_err(|_| localized_error("native.error.07672da77d", json!({}), "Export registry poisoned".into()))?
            .insert(id.clone(), job);
        Ok(id)
    }
    fn write(
        &self,
        owner: &str,
        id: &str,
        kind: &str,
        bytes: &[u8],
        position: u64,
    ) -> Result<(), String> {
        let job = self.get(owner, id)?;
        let mut stream = job.stream.lock().map_err(|_| localized_error("native.error.23c6a3e86d", json!({}), "Export stream poisoned".into()))?;
        if stream.encoding {
            return Err(localized_error("native.error.4f02b13584", json!({}), "Native export is already encoding".into()));
        }
        let filename = match kind {
            "frame" => {
                if bytes.len() as u64 != job.settings.frame_bytes()
                    || position != stream.frames * job.settings.frame_bytes()
                    || stream.frames >= job.settings.total_frames
                {
                    return Err(localized_error("native.error.752472cc11", json!({}), "Invalid RGBA frame size, position or frame count".into()));
                }
                "video.rgba"
            }
            "audio" => {
                if bytes.is_empty()
                    || bytes.len() > 16 * 1024 * 1024
                    || position > stream.audio_bytes
                {
                    return Err(localized_error("native.error.4de569d2e1", json!({}), "Invalid audio chunk size or sparse write".into()));
                }
                "audio.wav"
            }
            _ => return Err(localized_error("native.error.06a6d4544f", json!({}), "Unknown native export stream".into())),
        };
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(job.scratch.join(filename))
            .map_err(|e| e.to_string())?;
        file.seek(SeekFrom::Start(position))
            .and_then(|_| file.write_all(bytes))
            .map_err(|e| e.to_string())?;
        if kind == "frame" {
            stream.frames += 1;
        } else {
            stream.audio_bytes = stream.audio_bytes.max(position + bytes.len() as u64);
        }
        Ok(())
    }
    fn prepare_finish(&self, owner: &str, id: &str) -> Result<Arc<ExportJob>, String> {
        let job = self.get(owner, id)?;
        {
            let mut stream = job.stream.lock().map_err(|_| localized_error("native.error.23c6a3e86d", json!({}), "Export stream poisoned".into()))?;
            if stream.encoding
                || stream.frames != job.settings.total_frames
                || stream.audio_bytes < 44
            {
                return Err(localized_error("native.error.76128bca84", json!({}), "Incomplete or already finishing native export".into()));
            }
            stream.encoding = true;
        }
        Ok(job)
    }
    fn cancel(&self, owner: &str, id: &str) -> Result<(), String> {
        let mut jobs = self.jobs.lock().map_err(|_| localized_error("native.error.07672da77d", json!({}), "Export registry poisoned".into()))?;
        if let Some(job) = jobs.get(id) {
            if job.owner != owner {
                return Err(localized_error("native.error.fc99b3325a", json!({}), "Native export owner mismatch".into()));
            }
            job.cancelled.store(true, Ordering::Release);
            jobs.remove(id);
        }
        Ok(())
    }
}

fn encode(job: &ExportJob) -> Result<Value, String> {
    let s = &job.settings;
    let encoded = job.scratch.join(format!("result.{}", s.format));
    let mut command = Command::new(media_tool("ffmpeg")?);
    command
        .args([
            "-v",
            "error",
            "-nostdin",
            "-f",
            "rawvideo",
            "-pixel_format",
            "rgba",
            "-video_size",
        ])
        .arg(format!("{}x{}", s.width, s.height))
        .arg("-framerate")
        .arg(s.frame_rate.to_string())
        .arg("-i")
        .arg(job.scratch.join("video.rgba"))
        .arg("-i")
        .arg(job.scratch.join("audio.wav"))
        .args(["-map", "0:v:0", "-map", "1:a:0", "-frames:v"])
        .arg(s.total_frames.to_string());
    match s.codec.as_str() {
        "prores" => {
            let profile = s.prores_profile.as_deref().unwrap_or("hq");
            let number = match profile {
                "proxy" => "0",
                "lt" => "1",
                "standard" => "2",
                "hq" => "3",
                "4444" => "4",
                _ => "5",
            };
            command.args([
                "-c:v",
                "prores_ks",
                "-profile:v",
                number,
                "-pix_fmt",
                if number == "4" || number == "5" {
                    "yuva444p10le"
                } else {
                    "yuv422p10le"
                },
            ]);
        }
        "vp8" | "vp9" => {
            command.args([
                "-c:v",
                if s.codec == "vp9" {
                    "libvpx-vp9"
                } else {
                    "libvpx"
                },
                "-pix_fmt",
                "yuva420p",
                "-auto-alt-ref",
                "0",
                "-crf",
                "25",
                "-b:v",
                "0",
            ]);
        }
        "h265" => {
            command.args(["-c:v", "libx265", "-pix_fmt", "yuv420p", "-tag:v", "hvc1"]);
        }
        _ => {
            command.args([
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20",
            ]);
        }
    }
    command
        .args([
            "-c:a",
            if s.format == "webm" {
                "libopus"
            } else if s.codec == "prores" {
                "pcm_s16le"
            } else {
                "aac"
            },
            "-shortest",
        ])
        .arg(&encoded);
    let run = run_ffmpeg(&mut command, &job.cancelled)?;
    if run.cancelled {
        return Err(localized_error("native.error.2bb8d03cf9", json!({}), "Native export cancelled".into()));
    }
    if !run.ok {
        return Err(localized_error("native.error.beb29ac164", json!({"detail": (run.stderr).to_string()}), format!("FFmpeg native export failed: {}", run.stderr)));
    }
    if job.cancelled.load(Ordering::Acquire) {
        return Err(localized_error("native.error.2bb8d03cf9", json!({}), "Native export cancelled".into()));
    }
    if fs::metadata(&encoded).map_err(|e| e.to_string())?.len() == 0 {
        return Err(localized_error("native.error.c560aa00c5", json!({}), "FFmpeg produced an empty file".into()));
    }
    // The caller cannot supply an output path. Refuse swapped directory
    // symlinks and overwrite; copying also supports projects on another volume.
    let parent = job.output.parent().ok_or_else(|| localized_error("native.error.434141831f", json!({}), "Missing export directory".into()))?;
    if fs::canonicalize(parent).map_err(|e| e.to_string())? != parent {
        return Err(localized_error("native.error.33dcae234c", json!({}), "Export directory changed during encoding".into()));
    }
    let mut destination = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&job.output)
        .map_err(|e| e.to_string())?;
    let copied = fs::File::open(&encoded)
        .and_then(|mut source| std::io::copy(&mut source, &mut destination))
        .and_then(|_| destination.sync_all());
    if let Err(error) = copied {
        let _ = fs::remove_file(&job.output);
        return Err(localized_error("native.error.67016eaa35", json!({"error": error.to_string()}), format!("Cannot publish native export: {error}")));
    }
    if job.cancelled.load(Ordering::Acquire) {
        let _ = fs::remove_file(&job.output);
        return Err(localized_error("native.error.2bb8d03cf9", json!({}), "Native export cancelled".into()));
    }
    let mut result = file_result(&job.output)?;
    result["filename"] = json!(job
        .output
        .file_name()
        .and_then(|p| p.to_str())
        .unwrap_or_default());
    result["codec"] = json!(s.codec);
    result["format"] = json!(s.format);
    Ok(result)
}

#[tauri::command]
pub async fn openreel_export_start(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, OpenReelExportState>,
    project_dir: String,
    settings: NativeEncoderSettings,
) -> Result<String, String> {
    state.start(window.label().to_string(), project_dir, settings)
}
#[tauri::command]
pub async fn openreel_export_write(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, OpenReelExportState>,
    job_id: String,
    kind: String,
    data: String,
    position: u64,
) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| e.to_string())?;
    state.write(window.label(), &job_id, &kind, &bytes, position)
}
#[tauri::command]
pub async fn openreel_export_finish(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, OpenReelExportState>,
    job_id: String,
) -> Result<Value, String> {
    let job = state.prepare_finish(window.label(), &job_id)?;
    let result = tauri::async_runtime::spawn_blocking(move || encode(&job))
        .await
        .map_err(|e| e.to_string());
    state
        .jobs
        .lock()
        .map_err(|_| localized_error("native.error.07672da77d", json!({}), "Export registry poisoned".into()))?
        .remove(&job_id);
    result?
}
#[tauri::command]
pub async fn openreel_export_cancel(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, OpenReelExportState>,
    job_id: String,
) -> Result<(), String> {
    state.cancel(window.label(), &job_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufRead;
    struct ProjectDir(PathBuf);
    impl ProjectDir {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("shotloom-encode-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            crate::services::storage_service::save_project(&path.join(PROJECT_FILE), &json!({"name":"Encoder test","nodes":[]})).unwrap();
            Self(fs::canonicalize(path).unwrap())
        }
    }
    impl Drop for ProjectDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn settings(codec: &str, format: &str) -> NativeEncoderSettings {
        NativeEncoderSettings {
            width: 16,
            height: 16,
            frame_rate: 2.0,
            total_frames: 2,
            codec: codec.into(),
            format: format.into(),
            audio_sample_rate: 48000,
            audio_channels: 2,
            prores_profile: (codec == "prores").then(|| "4444".into()),
        }
    }
    #[test]
    fn invalid_encoder_settings_return_explicit_localization_envelope() {
        let mut config = settings("h264", "mp4");
        config.width = 0;
        let error: Value = serde_json::from_str(&config.validate().unwrap_err()).unwrap();
        assert_eq!(error["type"], "shotloom:localized-error");
        assert_eq!(error["key"], "native.error.dfa69e55f7");
        assert_eq!(error["params"], json!({}));
        assert_eq!(error["fallback"], "Invalid native encoder dimensions, timing or audio settings");
    }

    fn wav() -> Vec<u8> {
        let count = 48000 * 2 * 2u32;
        let mut bytes = Vec::new();
        bytes.extend(b"RIFF");
        bytes.extend((36 + count).to_le_bytes());
        bytes.extend(b"WAVEfmt ");
        bytes.extend(16u32.to_le_bytes());
        bytes.extend(1u16.to_le_bytes());
        bytes.extend(2u16.to_le_bytes());
        bytes.extend(48000u32.to_le_bytes());
        bytes.extend(192000u32.to_le_bytes());
        bytes.extend(4u16.to_le_bytes());
        bytes.extend(16u16.to_le_bytes());
        bytes.extend(b"data");
        bytes.extend(count.to_le_bytes());
        bytes.resize(44 + count as usize, 0);
        bytes
    }
    fn frame() -> Vec<u8> {
        (0..256)
            .flat_map(|pixel| [0, 255, 0, if pixel % 16 < 8 { 0 } else { 255 }])
            .collect()
    }
    fn encode_fixture(
        state: &OpenReelExportState,
        root: &ProjectDir,
        codec: &str,
        format: &str,
    ) -> Value {
        let id = state
            .start(
                "main".into(),
                root.0.to_string_lossy().into_owned(),
                settings(codec, format),
            )
            .unwrap();
        state.write("main", &id, "audio", &wav(), 0).unwrap();
        for n in 0..2 {
            state
                .write("main", &id, "frame", &frame(), n * 1024)
                .unwrap();
        }
        let job = state.prepare_finish("main", &id).unwrap();
        let result = encode(&job).unwrap();
        let scratch = job.scratch.clone();
        drop(job);
        state.jobs.lock().unwrap().remove(&id);
        assert!(!scratch.exists(), "spooled frames must be removed");
        result
    }
    #[test]
    fn native_encoder_rejects_wrong_owner_sparse_chunks_and_incomplete_frames() {
        let root = ProjectDir::new();
        let state = OpenReelExportState::default();
        let id = state
            .start(
                "main".into(),
                root.0.to_string_lossy().into_owned(),
                settings("h264", "mp4"),
            )
            .unwrap();
        let scratch = state.get("main", &id).unwrap().scratch.clone();
        assert!(state.write("other", &id, "frame", &frame(), 0).is_err());
        assert!(state.write("main", &id, "frame", &[0], 0).is_err());
        assert!(state.write("main", &id, "audio", &[0], 42).is_err());
        assert!(state.prepare_finish("main", &id).is_err());
        assert!(state.cancel("other", &id).is_err());
        state.cancel("main", &id).unwrap();
        assert!(state.get("main", &id).is_err());
        assert!(!scratch.exists());
        assert!(settings("prores", "webm").validate().is_err());
    }
    #[test]
    fn native_encoder_produces_real_h264_alpha_webm_and_prores_files() {
        let root = ProjectDir::new();
        let state = OpenReelExportState::default();
        for (codec, format, expected) in [
            ("h264", "mp4", "h264"),
            ("vp9", "webm", "vp9"),
            ("prores", "mov", "prores"),
        ] {
            let result = encode_fixture(&state, &root, codec, format);
            let path = result["filePath"].as_str().unwrap();
            assert!(result["size"].as_u64().unwrap() > 0);
            assert!(PathBuf::from(path).starts_with(root.0.join("assets")));
            let probe = Command::new(media_tool("ffprobe").unwrap())
                .args([
                    "-v",
                    "error",
                    "-select_streams",
                    "v:0",
                    "-count_frames",
                    "-show_streams",
                    "-of",
                    "json",
                    path,
                ])
                .output()
                .unwrap();
            assert!(probe.status.success());
            let probe: Value = serde_json::from_slice(&probe.stdout).unwrap();
            assert_eq!(probe["streams"][0]["codec_name"], expected);
            assert_eq!(probe["streams"][0]["nb_read_frames"], "2");
            if codec != "h264" {
                let mut decode = Command::new(media_tool("ffmpeg").unwrap());
                decode.args(["-v", "error"]);
                if codec == "vp9" {
                    decode.args(["-c:v", "libvpx-vp9"]);
                }
                let rgba = decode
                    .args([
                        "-i",
                        path,
                        "-frames:v",
                        "1",
                        "-f",
                        "rawvideo",
                        "-pix_fmt",
                        "rgba",
                        "pipe:1",
                    ])
                    .output()
                    .unwrap();
                assert!(
                    rgba.status.success(),
                    "{}",
                    String::from_utf8_lossy(&rgba.stderr)
                );
                assert_eq!(rgba.stdout.len(), 16 * 16 * 4);
                assert_eq!(rgba.stdout[3], 0, "transparent pixels must survive {codec}");
                assert_eq!(
                    rgba.stdout[15 * 4 + 3],
                    255,
                    "opaque pixels must survive {codec}"
                );
            }
        }
    }
    #[test]
    fn native_encoder_cancellation_and_publish_conflicts_never_claim_delivery() {
        let root = ProjectDir::new();
        let state = OpenReelExportState::default();
        for cancelled in [true, false] {
            let id = state
                .start(
                    "main".into(),
                    root.0.to_string_lossy().into_owned(),
                    settings("h264", "mp4"),
                )
                .unwrap();
            state.write("main", &id, "audio", &wav(), 0).unwrap();
            for n in 0..2 {
                state
                    .write("main", &id, "frame", &frame(), n * 1024)
                    .unwrap();
            }
            let job = state.prepare_finish("main", &id).unwrap();
            if cancelled {
                job.cancelled.store(true, Ordering::Release);
            } else {
                fs::write(&job.output, b"Existing file must survive").unwrap();
            }
            assert!(encode(&job).is_err());
            if cancelled {
                assert!(!job.output.exists());
            } else {
                assert_eq!(
                    fs::read(&job.output).unwrap(),
                    b"Existing file must survive"
                );
            }
            state.cancel("main", &id).unwrap();
        }
    }

    /// Local browser verification uses stdin/stdout instead of Tauri IPC; the
    /// encoding, ownership checks and file publication are the production code.
    #[test]
    #[ignore = "interactive browser fixture; requires SHOTLOOM_ENCODER_TEST_PROJECT"]
    fn native_encoder_protocol() {
        let root =
            std::env::var("SHOTLOOM_ENCODER_TEST_PROJECT").expect("isolated project required");
        crate::services::storage_service::save_project(&PathBuf::from(&root).join(PROJECT_FILE), &json!({"name":"Native export verification","nodes":[]})).unwrap();
        let state = OpenReelExportState::default();
        for line in std::io::stdin().lock().lines() {
            let request: Value = serde_json::from_str(&line.unwrap()).unwrap();
            let id = request["jobId"].as_str().unwrap_or_default();
            let result: Result<Value, String> = (|| match request["op"].as_str().unwrap_or_default()
            {
                "start" => state
                    .start(
                        "browser-fixture".into(),
                        root.clone(),
                        serde_json::from_value(request["settings"].clone())
                            .map_err(|e| e.to_string())?,
                    )
                    .map(Value::String),
                "write" => {
                    let bytes = base64::engine::general_purpose::STANDARD
                        .decode(request["data"].as_str().unwrap_or_default())
                        .map_err(|e| e.to_string())?;
                    state.write(
                        "browser-fixture",
                        id,
                        request["kind"].as_str().unwrap_or_default(),
                        &bytes,
                        request["position"].as_u64().unwrap_or_default(),
                    )?;
                    Ok(Value::Null)
                }
                "finish" => {
                    let job = state.prepare_finish("browser-fixture", id)?;
                    let result = encode(&job);
                    state.jobs.lock().unwrap().remove(id);
                    result
                }
                "cancel" => state.cancel("browser-fixture", id).map(|_| Value::Null),
                "shutdown" => {
                    state.shutdown(None);
                    Ok(Value::Null)
                }
                _ => Err("Unknown fixture command".into()),
            })();
            println!(
                "SHOTLOOM_EXPORT:{}",
                match result {
                    Ok(value) => json!({"ok": true, "value": value}),
                    Err(error) => json!({"ok": false, "error": error}),
                }
            );
            std::io::stdout().flush().unwrap();
            if request["op"] == "shutdown" {
                break;
            }
        }
    }
}
