use super::common::localized_error;
use serde_json::json;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};
use tauri::{AppHandle, Emitter, Manager, State};
use super::harness_bridge::{bridge_env, start_harness_bridge, HarnessBridgeState};

#[derive(Default, Clone)]
pub struct HarnessRuntimeState {
    startup: Arc<tokio::sync::Mutex<()>>,
    pub(super) child: Arc<Mutex<Option<Child>>>,
    pub(super) ready: Arc<Mutex<bool>>,
    last_error: Arc<Mutex<Option<String>>>,
    pub(super) replies: Arc<Mutex<std::collections::HashMap<String, super::harness_session::NativeReply>>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessRuntimeOptions {
    pub source_root: Option<String>,
    pub data_root: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HarnessRuntimeStatus {
    pub running: bool,
    pub ready: bool,
    pub error: Option<String>,
}

fn host_root(app: &AppHandle, options: &HarnessRuntimeOptions) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        if let Some(root) = options.source_root.as_deref() { return Ok(PathBuf::from(root)); }
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/agent-host"));
    }
    Ok(app.path().resource_dir().map_err(|error| error.to_string())?.join("resources/agent-host"))
}

fn status_inner(state: &HarnessRuntimeState) -> HarnessRuntimeStatus {
    let mut child = state.child.lock().unwrap_or_else(|error| error.into_inner());
    let running = match child.as_mut() {
        Some(process) => process.try_wait().ok().flatten().is_none(),
        None => false,
    };
    if !running {
        child.take();
        *state.ready.lock().unwrap_or_else(|error| error.into_inner()) = false;
    }
    HarnessRuntimeStatus {
        running,
        ready: *state.ready.lock().unwrap_or_else(|error| error.into_inner()),
        error: state.last_error.lock().unwrap_or_else(|error| error.into_inner()).clone(),
    }
}

#[tauri::command]
pub fn harness_runtime_status(state: State<'_, HarnessRuntimeState>) -> HarnessRuntimeStatus {
    status_inner(&state)
}

#[tauri::command]
pub async fn start_harness_runtime(
    app: AppHandle,
    state: State<'_, HarnessRuntimeState>,
    bridge: State<'_, HarnessBridgeState>,
    options: HarnessRuntimeOptions,
) -> Result<HarnessRuntimeStatus, String> {
    let _startup = state.startup.lock().await;
    if status_inner(&state).running {
        return Ok(status_inner(&state));
    }
    let root = host_root(&app, &options)?;
    if !root.join("dist/main.js").exists() {
        return Err(localized_error("native.harness.missingBuild", json!({"path": root.display().to_string()}), format!("Shotloom Agent Host 产物不存在，请运行 npm run prepare:harness：{}", root.display())));
    }
    let data_root = match options.data_root {
        Some(path) => PathBuf::from(path),
        None => app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?
            .join("deepseek-harness"),
    };
    fs::create_dir_all(&data_root).map_err(|error| error.to_string())?;
    let bridge_app = app.clone();
    let bridge_state = bridge.inner().clone();
    tauri::async_runtime::spawn_blocking(move || start_harness_bridge(&bridge_app, &bridge_state))
        .await.map_err(|error| error.to_string())??;
    let (bridge_port, bridge_token) = bridge_env(&bridge).ok_or_else(|| localized_error("native.harness.bridgeNotReady", json!({}), "工具桥接尚未就绪".into()))?;
    let executable = root.join(if cfg!(windows) { "node.exe" } else { "node" });
    let mut command = Command::new(executable);
    command
        .current_dir(&root)
        .arg(root.join("dist/main.js"))
        .env("SHOTLOOM_DATA_ROOT", &data_root)
        .env("SHOTLOOM_BRIDGE_URL", format!("http://127.0.0.1:{bridge_port}"))
        .env("SHOTLOOM_BRIDGE_TOKEN", bridge_token)
        .env("SHOTLOOM_CONTENT_ROOT", root.join("content"))
        .env("SHOTLOOM_RULES_PATH", root.join("AGENTS.md"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|error| localized_error("native.harness.startFailed", json!({"error": error.to_string()}), format!("启动 DeepSeek Harness 失败：{error}")))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    {
        let mut slot = state.child.lock().unwrap_or_else(|error| error.into_inner());
        *slot = Some(child);
    }
    *state.ready.lock().unwrap_or_else(|error| error.into_inner()) = false;
    *state.last_error.lock().unwrap_or_else(|error| error.into_inner()) = None;

    if let Some(stdout) = stdout {
        let app_handle = app.clone();
        let state_handle = state.inner().clone();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Some(payload) = line.strip_prefix("shotloom transport: ") {
                    super::harness_session::deliver_native(&state_handle, payload);
                    continue;
                }
                if line == "shotloom host: native" {
                    *state_handle.ready.lock().unwrap_or_else(|error| error.into_inner()) = true;
                    let _ = app_handle.emit("harness://ready", ());
                }
                let _ = app_handle.emit("harness://stdout", line);
            }
        });
    }
    if let Some(stderr) = stderr {
        let app_handle = app.clone();
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let _ = app_handle.emit("harness://stderr", line);
            }
        });
    }
    Ok(status_inner(&state))
}

pub fn shutdown_harness_runtime(state: &HarnessRuntimeState) {
    if let Some(mut child) = state.child.lock().unwrap_or_else(|error| error.into_inner()).take() {
        if let Some(input) = child.stdin.as_mut() { let _ = input.write_all(b"shutdown\n"); }
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        while std::time::Instant::now() < deadline {
            if child.try_wait().ok().flatten().is_some() { break; }
            thread::sleep(std::time::Duration::from_millis(25));
        }
        if child.try_wait().ok().flatten().is_none() { let _ = child.kill(); }
        let _ = child.wait();
    }
    *state.ready.lock().unwrap_or_else(|error| error.into_inner()) = false;
    state.replies.lock().unwrap_or_else(|error| error.into_inner()).clear();
}

#[tauri::command]
pub fn stop_harness_runtime(state: State<'_, HarnessRuntimeState>) -> Result<HarnessRuntimeStatus, String> {
    shutdown_harness_runtime(&state);
    Ok(status_inner(&state))
}

#[tauri::command]
pub async fn restart_harness_runtime(
    app: AppHandle,
    state: State<'_, HarnessRuntimeState>,
    bridge: State<'_, HarnessBridgeState>,
    options: HarnessRuntimeOptions,
) -> Result<HarnessRuntimeStatus, String> {
    stop_harness_runtime(state.clone())?;
    start_harness_runtime(app, state, bridge, options).await
}
