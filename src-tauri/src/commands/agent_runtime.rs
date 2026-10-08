use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    net::TcpListener as StdTcpListener,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};
use tokio::sync::{oneshot, Mutex, RwLock};
use super::agent_runtime_proxy::child_proxy_environment;
#[cfg(test)]
use super::agent_runtime_proxy::parse_macos_system_proxy;
use super::agent_runtime_sse::{parse_sse_data, take_sse_frame};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTool {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub state: String,
    pub error: Option<String>,
}

#[derive(Debug)]
struct ProcessState {
    status: RuntimeStatus,
    child: Option<CommandChild>,
    configuration_key: Option<String>,
    runtime_url: Option<String>,
    runtime_token: Option<String>,
    generation: u64,
    desired_running: bool,
    failure_times_ms: VecDeque<u128>,
    circuit_open_until_ms: u128,
    consecutive_health_failures: u32,
    last_health_at_ms: u128,
    last_progress_at_ms: u128,
    active_run_id: Option<String>,
    active_project_key: Option<String>,
    last_stall_notice_at_ms: u128,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeProtectionConfiguration {
    pub health_interval_ms: Option<u64>,
    pub failure_threshold: Option<usize>,
    pub failure_window_ms: Option<u64>,
    pub circuit_cooldown_ms: Option<u64>,
    pub stall_warning_ms: Option<u64>,
    pub hard_cap_ms: Option<u64>,
}

impl Default for RuntimeProtectionConfiguration {
    fn default() -> Self {
        Self {
            health_interval_ms: Some(10_000),
            failure_threshold: Some(3),
            failure_window_ms: Some(300_000),
            circuit_cooldown_ms: Some(120_000),
            stall_warning_ms: Some(180_000),
            hard_cap_ms: Some(1_800_000),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHttpRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHttpResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStreamEvent {
    subscription_id: String,
    event: Option<Value>,
    error: Option<String>,
    done: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConfiguration {
    pub enabled_providers: Vec<String>,
    pub model: String,
    pub provider: Value,
    pub agent: Value,
    #[serde(default)]
    pub skills: Vec<RuntimeSkill>,
    pub tools: Vec<RuntimeTool>,
    pub workspace_directory: String,
    #[serde(default)]
    pub runtime_protection: Option<RuntimeProtectionConfiguration>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSkill {
    pub id: String,
    pub content: String,
}

fn valid_native_skill_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 80
        && bytes.first().is_some_and(u8::is_ascii_alphanumeric)
        && bytes.last().is_some_and(u8::is_ascii_alphanumeric)
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-')
}

fn materialize_runtime_skills(
    runtime_root: &std::path::Path,
    skills: &[RuntimeSkill],
) -> Result<Vec<String>, String> {
    let target = runtime_root.join("skills");
    let staging = runtime_root.join("skills-next");
    if staging.exists() {
        std::fs::remove_dir_all(&staging).map_err(|error| error.to_string())?;
    }
    std::fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
    let mut seen = std::collections::HashSet::new();
    let mut relative_paths = Vec::with_capacity(skills.len());
    for skill in skills {
        if !valid_native_skill_id(&skill.id) {
            return Err(format!("Invalid native Skill ID: {}", skill.id));
        }
        if !seen.insert(skill.id.as_str()) {
            return Err(format!("Duplicate native Skill ID: {}", skill.id));
        }
        if skill.content.trim().is_empty() {
            return Err(format!(
                "Native Skill {} has empty SKILL.md content",
                skill.id
            ));
        }
        let directory = staging.join(&skill.id);
        std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        std::fs::write(directory.join("SKILL.md"), skill.content.as_bytes())
            .map_err(|error| error.to_string())?;
        relative_paths.push(skill.id.clone());
    }
    if target.exists() {
        std::fs::remove_dir_all(&target).map_err(|error| error.to_string())?;
    }
    std::fs::rename(&staging, &target).map_err(|error| error.to_string())?;
    Ok(relative_paths
        .into_iter()
        .map(|id| target.join(id).to_string_lossy().into_owned())
        .collect())
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolRunContext {
    request_id: String,
    session_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolRequest {
    request_id: String,
    name: String,
    arguments: Value,
}

#[derive(Clone)]
struct BridgeState {
    app: Option<AppHandle>,
    tools: Arc<RwLock<Vec<RuntimeTool>>>,
    tool_run: Arc<RwLock<ToolRunContext>>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>>,
    token: String,
}

pub struct AgentRuntimeState {
    start_lock: Mutex<()>,
    process: Mutex<ProcessState>,
    bridge_cancel: Mutex<Option<oneshot::Sender<()>>>,
    tools: Arc<RwLock<Vec<RuntimeTool>>>,
    tool_run: Arc<RwLock<ToolRunContext>>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>>,
    subscriptions: Mutex<HashMap<String, oneshot::Sender<()>>>,
    health_cancel: Mutex<Option<oneshot::Sender<()>>>,
}

impl AgentRuntimeState {
    pub fn new() -> Self {
        Self {
            start_lock: Mutex::new(()),
            process: Mutex::new(ProcessState {
                status: RuntimeStatus {
                    state: "stopped".into(),
                    error: None,
                },
                child: None,
                configuration_key: None,
                runtime_url: None,
                runtime_token: None,
                generation: 0,
                desired_running: false,
                failure_times_ms: VecDeque::new(),
                circuit_open_until_ms: 0,
                consecutive_health_failures: 0,
                last_health_at_ms: 0,
                last_progress_at_ms: 0,
                active_run_id: None,
                active_project_key: None,
                last_stall_notice_at_ms: 0,
            }),
            bridge_cancel: Mutex::new(None),
            tools: Arc::new(RwLock::new(Vec::new())),
            tool_run: Arc::new(RwLock::new(ToolRunContext::default())),
            pending: Arc::new(Mutex::new(HashMap::new())),
            subscriptions: Mutex::new(HashMap::new()),
            health_cancel: Mutex::new(None),
        }
    }

    pub async fn shutdown(&self) -> Result<(), String> {
        if let Some(cancel) = self.health_cancel.lock().await.take() {
            let _ = cancel.send(());
        }
        for (_, cancel) in self.subscriptions.lock().await.drain() {
            let _ = cancel.send(());
        }
        if let Some(cancel) = self.bridge_cancel.lock().await.take() {
            let _ = cancel.send(());
        }
        *self.tool_run.write().await = ToolRunContext::default();
        for (_, pending) in self.pending.lock().await.drain() {
            let _ = pending.send(Err("Shotloom Agent Runtime stopped".into()));
        }
        let mut process = self.process.lock().await;
        if let Some(child) = process.child.take() {
            child.kill().map_err(|e| e.to_string())?;
        }
        process.status = RuntimeStatus {
            state: "stopped".into(),
            error: None,
        };
        process.configuration_key = None;
        process.runtime_url = None;
        process.runtime_token = None;
        process.desired_running = false;
        process.active_run_id = None;
        process.active_project_key = None;
        process.generation += 1;
        Ok(())
    }
}

fn unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn protection(configuration: &RuntimeConfiguration) -> RuntimeProtectionConfiguration {
    configuration.runtime_protection.clone().unwrap_or_default()
}

fn prune_failures(process: &mut ProcessState, window_ms: u64) {
    let cutoff = unix_ms().saturating_sub(window_ms as u128);
    while process.failure_times_ms.front().is_some_and(|value| *value < cutoff) {
        process.failure_times_ms.pop_front();
    }
}

fn record_failure(process: &mut ProcessState, config: &RuntimeProtectionConfiguration) {
    let window_ms = config.failure_window_ms.unwrap_or(300_000).max(10_000);
    prune_failures(process, window_ms);
    process.failure_times_ms.push_back(unix_ms());
    let threshold = config.failure_threshold.unwrap_or(3).clamp(1, 20);
    if process.failure_times_ms.len() >= threshold {
        process.circuit_open_until_ms = unix_ms()
            .saturating_add(config.circuit_cooldown_ms.unwrap_or(120_000).max(10_000) as u128);
    }
}

fn available_port() -> Result<u16, String> {
    let listener = StdTcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    listener
        .local_addr()
        .map(|addr| addr.port())
        .map_err(|e| e.to_string())
}

fn authorized(headers: &HeaderMap, token: &str) -> bool {
    headers.get("authorization").and_then(|value| value.to_str().ok())
        == Some(format!("Bearer {token}").as_str())
}

fn tool_error(status: StatusCode, error: impl Into<String>) -> Response {
    (status, Json(json!({ "error": error.into() }))).into_response()
}

async fn tool_context(State(state): State<BridgeState>, headers: HeaderMap) -> Response {
    if !authorized(&headers, &state.token) {
        return tool_error(StatusCode::UNAUTHORIZED, "Unauthorized Shotloom tool transport");
    }
    let context = state.tool_run.read().await;
    if context.request_id.is_empty() || context.session_id.is_empty() {
        return tool_error(StatusCode::CONFLICT, "Shotloom tool transport has no active run");
    }
    Json(context.clone()).into_response()
}

async fn execute_tool(
    State(state): State<BridgeState>,
    headers: HeaderMap,
    Json(request): Json<ToolRequest>,
) -> Response {
    if !authorized(&headers, &state.token) {
        return tool_error(StatusCode::UNAUTHORIZED, "Unauthorized Shotloom tool transport");
    }
    let run = state.tool_run.read().await;
    if request.request_id.is_empty() || request.request_id != run.request_id || run.session_id.is_empty() {
        return tool_error(StatusCode::CONFLICT, "Unknown or expired Shotloom Agent run");
    }
    if !state.tools.read().await.iter().any(|tool| tool.name == request.name) {
        return tool_error(StatusCode::BAD_REQUEST, format!("Unknown Shotloom tool: {}", request.name));
    }
    if !request.arguments.is_object() {
        return tool_error(StatusCode::BAD_REQUEST, "Shotloom tool arguments must be an object");
    }
    let Some(app) = &state.app else {
        return tool_error(StatusCode::SERVICE_UNAVAILABLE, "Shotloom application bridge is unavailable");
    };
    let call_id = format!("tool-{}", uuid_like());
    let (tx, rx) = oneshot::channel();
    state.pending.lock().await.insert(call_id.clone(), tx);
    let emitted = app.emit("agent-tool-request", json!({
        "callId": call_id, "requestId": request.request_id,
        "name": request.name, "arguments": request.arguments
    }));
    // Registration/release take the write lock, so no request can be queued
    // after a run is released. Pending calls are then explicitly rejected.
    drop(run);
    if let Err(error) = emitted {
        state.pending.lock().await.remove(&call_id);
        return tool_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string());
    }
    let response = match tokio::time::timeout(Duration::from_secs(600), rx).await {
        Ok(Ok(Ok(value))) => Json(value).into_response(),
        Ok(Ok(Err(error))) => tool_error(StatusCode::UNPROCESSABLE_ENTITY, error),
        Ok(Err(_)) => tool_error(StatusCode::GONE, "Shotloom tool reply channel closed"),
        Err(_) => tool_error(StatusCode::GATEWAY_TIMEOUT, "Shotloom tool timed out"),
    };
    state.pending.lock().await.remove(&call_id);
    response
}

fn uuid_like() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{nanos:x}-{:x}", std::process::id())
}

async fn start_bridge(
    app: AppHandle,
    state: &AgentRuntimeState,
    token: String,
) -> Result<String, String> {
    if let Some(cancel) = state.bridge_cancel.lock().await.take() {
        let _ = cancel.send(());
    }
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let bridge = BridgeState {
        app: Some(app),
        tools: state.tools.clone(),
        tool_run: state.tool_run.clone(),
        pending: state.pending.clone(),
        token,
    };
    let router = Router::new()
        .route("/context", get(tool_context))
        .route("/execute", post(execute_tool))
        .with_state(bridge);
    let (cancel_tx, cancel_rx) = oneshot::channel();
    *state.bridge_cancel.lock().await = Some(cancel_tx);
    tauri::async_runtime::spawn(async move {
        let server = axum::serve(listener, router).with_graceful_shutdown(async {
            let _ = cancel_rx.await;
        });
        if let Err(error) = server.await {
            eprintln!("Shotloom tool transport stopped: {error}");
        }
    });
    Ok(format!("http://127.0.0.1:{port}"))
}

async fn wait_for_opencode_health(url: &str, token: &str) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_millis(250))
        .timeout(Duration::from_millis(500))
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;
    let health_url = format!("{url}/global/health");
    for _ in 0..100 {
        if let Ok(response) = client
            .get(&health_url)
            .basic_auth("opencode", Some(token))
            .send()
            .await
        {
            if response.status().is_success() {
                return Ok(());
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err("OpenCode health check did not become ready".into())
}

#[tauri::command]
pub async fn agent_runtime_start(
    app: AppHandle,
    state: tauri::State<'_, AgentRuntimeState>,
    configuration: RuntimeConfiguration,
) -> Result<RuntimeStatus, String> {
    let _start_guard = state.start_lock.lock().await;
    let protection_config = protection(&configuration);
    let workspace = std::path::PathBuf::from(&configuration.workspace_directory);
    let metadata = std::fs::metadata(&workspace)
        .map_err(|e| format!("OpenCode workspace is unavailable: {e}"))?;
    if !metadata.is_dir() {
        return Err("OpenCode workspace is not a directory".into());
    }
    let workspace = std::fs::canonicalize(workspace)
        .map_err(|e| format!("OpenCode workspace cannot be resolved: {e}"))?;
    let configuration_key = serde_json::to_string(&configuration).map_err(|e| e.to_string())?;
    {
        let mut process = state.process.lock().await;
        prune_failures(
            &mut process,
            protection_config.failure_window_ms.unwrap_or(300_000),
        );
        if process.circuit_open_until_ms > unix_ms() {
            let remaining_ms = process.circuit_open_until_ms.saturating_sub(unix_ms());
            return Err(format!(
                "OpenCode Runtime protection circuit is open; retry in {} seconds",
                remaining_ms.div_ceil(1000)
            ));
        }
        if matches!(process.status.state.as_str(), "starting" | "ready")
            && process.configuration_key.as_deref() == Some(configuration_key.as_str())
        {
            return Ok(process.status.clone());
        }
        if let Some(child) = process.child.take() {
            child.kill().map_err(|e| e.to_string())?;
        }
        process.generation += 1;
        process.desired_running = true;
        process.consecutive_health_failures = 0;
    }
    if let Some(cancel) = state.health_cancel.lock().await.take() {
        let _ = cancel.send(());
    }
    let runtime_root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("opencode-runtime");
    let runtime_data = runtime_root.join("data");
    let runtime_config = runtime_root.join("config");
    let runtime_cache = runtime_root.join("cache");
    for directory in [&runtime_data, &runtime_config, &runtime_cache] {
        std::fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    }
    let skill_paths = materialize_runtime_skills(&runtime_root, &configuration.skills)?;
    let tool_token = uuid_like();
    let runtime_token = uuid_like();
    let tool_url = start_bridge(app.clone(), &state, tool_token.clone()).await?;
    let plugin_path = runtime_root.join("shotloom-tools-plugin.mjs");
    std::fs::write(&plugin_path, include_str!("../../resources/shotloom-tools-plugin.mjs"))
        .map_err(|error| error.to_string())?;
    let plugin_url = reqwest::Url::from_file_path(&plugin_path)
        .map_err(|_| "Shotloom tool plugin path is invalid")?;
    {
        let mut process = state.process.lock().await;
        process.status = RuntimeStatus {
            state: "starting".into(),
            error: None,
        };
        process.configuration_key = Some(configuration_key);
        process.runtime_url = None;
        process.runtime_token = None;
        process.desired_running = true;
    }
    let port = available_port()?;
    let config = json!({
        "$schema": "https://opencode.ai/config.json",
        "autoupdate": false,
        "share": "disabled",
        "permission": {
            "edit": "deny",
            "bash": "deny",
            "external_directory": "deny",
            "webfetch": "deny"
        },
        "tools": {
            "read": false, "write": false, "edit": false, "bash": false,
            "glob": false, "grep": false, "webfetch": false
        },
        "tool_output": {
            "max_lines": 2000,
            "max_bytes": 51200
        },
        "compaction": {
            "auto": true,
            "prune": true,
            "tail_turns": 4,
            "preserve_recent_tokens": 12000,
            "reserved": 12000
        },
        "plugin": [[plugin_url.as_str(), {
            "endpoint": tool_url, "token": tool_token, "tools": configuration.tools
        }]],
        "skills": { "paths": skill_paths },
        "enabled_providers": configuration.enabled_providers,
        "model": configuration.model,
        "provider": configuration.provider,
        "agent": configuration.agent
    });
    let mut command = app
        .shell()
        .sidecar("opencode")
        .map_err(|e| e.to_string())?
        .args([
            "serve".to_string(),
            "--hostname=127.0.0.1".to_string(),
            format!("--port={port}"),
        ])
        .env("OPENCODE_CONFIG_CONTENT", config.to_string())
        .env("OPENCODE_DISABLE_PROJECT_CONFIG", "true")
        .env("OPENCODE_DISABLE_DEFAULT_PLUGINS", "true")
        .env("OPENCODE_DISABLE_EXTERNAL_SKILLS", "true")
        .env("OPENCODE_DISABLE_CLAUDE_CODE", "true")
        .env("OPENCODE_DISABLE_LSP_DOWNLOAD", "true")
        .env("OPENCODE_TEST_HOME", &runtime_root)
        .env("OPENCODE_TEST_MANAGED_CONFIG_DIR", runtime_root.join("managed"))
        .env("OPENCODE_PURE", "false")
        .env("OPENCODE_CONFIG", "")
        .env("OPENCODE_CONFIG_DIR", "")
        .env("OPENCODE_SERVER_PASSWORD", runtime_token.clone())
        .env("XDG_DATA_HOME", &runtime_data)
        .env("XDG_CONFIG_HOME", &runtime_config)
        .env("XDG_CACHE_HOME", &runtime_cache)
        .current_dir(workspace);
    for (key, value) in child_proxy_environment() {
        command = command.env(key, value);
    }
    let (mut events, child) = command.spawn().map_err(|e| e.to_string())?;
    {
        let mut process = state.process.lock().await;
        process.child = Some(child);
    }
    let expected = format!("http://127.0.0.1:{port}");
    let health_token = runtime_token.clone();
    let generation = state.process.lock().await.generation;
    let (ready_tx, ready_rx) = oneshot::channel::<Result<String, String>>();
    let health_url = expected.clone();
    tauri::async_runtime::spawn(async move {
        let ready = wait_for_opencode_health(&health_url, &health_token)
            .await
            .map(|_| health_url);
        let _ = ready_tx.send(ready);
    });
    let monitor_app = app.clone();
    let termination_protection = protection_config.clone();
    tauri::async_runtime::spawn(async move {
        let mut output = String::new();
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                    output.push_str(&String::from_utf8_lossy(&bytes));
                    if output.contains("opencode server listening") {
                        output.clear();
                    }
                }
                CommandEvent::Error(_) => {}
                CommandEvent::Terminated(payload) => {
                    let error = format!("OpenCode exited: {:?}", payload.code);
                    let runtime = monitor_app.state::<AgentRuntimeState>();
                    let mut process = runtime.process.lock().await;
                    if process.generation == generation && process.status.state != "stopped" {
                        record_failure(&mut process, &termination_protection);
                        process.status.state = "failed".into();
                        process.status.error = Some(error.clone());
                        process.child = None;
                        let _ = monitor_app.emit("agent-runtime-supervisor", json!({
                            "type": "runtime_failed",
                            "generation": generation,
                            "error": error,
                            "failureCount": process.failure_times_ms.len(),
                            "circuitOpenUntilMs": process.circuit_open_until_ms,
                        }));
                    }
                    break;
                }
                _ => {}
            }
        }
    });
    let ready = match tokio::time::timeout(Duration::from_secs(20), ready_rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("OpenCode startup monitor closed".to_string()),
        Err(_) => Err("Timed out waiting for OpenCode to start".to_string()),
    };
    let mut process = state.process.lock().await;
    match ready {
        Ok(url) => {
            process.status = RuntimeStatus {
                state: "ready".into(),
                error: None,
            };
            process.runtime_url = Some(url);
            process.runtime_token = Some(runtime_token);
            process.last_health_at_ms = unix_ms();
            process.last_progress_at_ms = unix_ms();
            let ready_status = process.status.clone();
            drop(process);
            start_runtime_health_monitor(
                app.clone(),
                &state,
                generation,
                protection_config,
            ).await;
            Ok(ready_status)
        }
        Err(error) => {
            if let Some(child) = process.child.take() {
                let _ = child.kill();
            }
            process.status.state = "failed".into();
            process.status.error = Some(error.clone());
            process.runtime_url = None;
            process.runtime_token = None;
            record_failure(&mut process, &protection_config);
            Err(error)
        }
    }
}

async fn start_runtime_health_monitor(
    app: AppHandle,
    state: &AgentRuntimeState,
    generation: u64,
    config: RuntimeProtectionConfiguration,
) {
    let (cancel_tx, mut cancel_rx) = oneshot::channel();
    if let Some(previous) = state.health_cancel.lock().await.replace(cancel_tx) {
        let _ = previous.send(());
    }
    let interval_ms = config.health_interval_ms.unwrap_or(10_000).clamp(2_000, 60_000);
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(interval_ms));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let client = match reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(2))
            .timeout(Duration::from_secs(3))
            .no_proxy()
            .build()
        {
            Ok(client) => client,
            Err(error) => {
                eprintln!("[runtime-supervisor] health client failed: {error}");
                return;
            }
        };
        loop {
            tokio::select! {
                _ = &mut cancel_rx => break,
                _ = interval.tick() => {}
            }
            let runtime = app.state::<AgentRuntimeState>();
            let (url, token, active_run_id, last_progress_at_ms) = {
                let process = runtime.process.lock().await;
                if process.generation != generation || !process.desired_running || process.status.state != "ready" {
                    break;
                }
                (
                    process.runtime_url.clone(),
                    process.runtime_token.clone(),
                    process.active_run_id.clone(),
                    process.last_progress_at_ms,
                )
            };
            let healthy = match (url, token) {
                (Some(url), Some(token)) => client
                    .get(format!("{url}/global/health"))
                    .basic_auth("opencode", Some(token))
                    .send()
                    .await
                    .is_ok_and(|response| response.status().is_success()),
                _ => false,
            };
            let mut process = runtime.process.lock().await;
            if process.generation != generation || process.status.state != "ready" {
                break;
            }
            process.last_health_at_ms = unix_ms();
            if healthy {
                process.consecutive_health_failures = 0;
            } else {
                process.consecutive_health_failures += 1;
                if process.consecutive_health_failures >= 3 {
                    let error = "OpenCode Runtime failed three consecutive health probes".to_string();
                    record_failure(&mut process, &config);
                    if let Some(child) = process.child.take() {
                        let _ = child.kill();
                    }
                    process.status = RuntimeStatus { state: "failed".into(), error: Some(error.clone()) };
                    process.runtime_url = None;
                    process.runtime_token = None;
                    let _ = app.emit("agent-runtime-supervisor", json!({
                        "type": "runtime_failed",
                        "generation": generation,
                        "error": error,
                        "failureCount": process.failure_times_ms.len(),
                        "circuitOpenUntilMs": process.circuit_open_until_ms,
                    }));
                    break;
                }
            }
            if let Some(run_id) = active_run_id {
                let silent_ms = unix_ms().saturating_sub(last_progress_at_ms);
                let warning_ms = config.stall_warning_ms.unwrap_or(180_000) as u128;
                let hard_cap_ms = config.hard_cap_ms.unwrap_or(1_800_000) as u128;
                if silent_ms >= warning_ms {
                    let notice_cooldown_ms = if silent_ms >= hard_cap_ms { 300_000 } else { 120_000 };
                    if unix_ms().saturating_sub(process.last_stall_notice_at_ms) >= notice_cooldown_ms {
                        process.last_stall_notice_at_ms = unix_ms();
                        let _ = app.emit("agent-runtime-supervisor", json!({
                            "type": "session_stalled",
                            "runId": run_id,
                            "silentMs": silent_ms,
                            "hardCap": silent_ms >= hard_cap_ms,
                        }));
                    }
                }
            }
        }
    });
}

#[tauri::command]
pub async fn agent_runtime_note_activity(
    state: tauri::State<'_, AgentRuntimeState>,
    run_id: Option<String>,
    project_key: Option<String>,
    finished: bool,
) -> Result<(), String> {
    let mut process = state.process.lock().await;
    process.last_progress_at_ms = unix_ms();
    process.last_stall_notice_at_ms = 0;
    if finished {
        process.active_run_id = None;
        process.active_project_key = None;
    } else {
        if let Some(value) = run_id { process.active_run_id = Some(value); }
        if let Some(value) = project_key { process.active_project_key = Some(value); }
    }
    Ok(())
}

#[tauri::command]
pub async fn agent_runtime_diagnostics(
    state: tauri::State<'_, AgentRuntimeState>,
) -> Result<Value, String> {
    let process = state.process.lock().await;
    Ok(json!({
        "status": process.status,
        "generation": process.generation,
        "desiredRunning": process.desired_running,
        "failureCount": process.failure_times_ms.len(),
        "circuitOpenUntilMs": process.circuit_open_until_ms,
        "consecutiveHealthFailures": process.consecutive_health_failures,
        "lastHealthAtMs": process.last_health_at_ms,
        "lastProgressAtMs": process.last_progress_at_ms,
        "activeRunId": process.active_run_id,
        "activeProjectKey": process.active_project_key,
    }))
}

#[tauri::command]
pub async fn agent_runtime_status(
    state: tauri::State<'_, AgentRuntimeState>,
) -> Result<RuntimeStatus, String> {
    Ok(state.process.lock().await.status.clone())
}

async fn runtime_connection(state: &AgentRuntimeState) -> Result<(String, String), String> {
    let process = state.process.lock().await;
    if process.status.state != "ready" {
        return Err(process
            .status
            .error
            .clone()
            .unwrap_or_else(|| "OpenCode Runtime is not ready".into()));
    }
    let url = process
        .runtime_url
        .clone()
        .ok_or_else(|| "OpenCode Runtime URL is unavailable".to_string())?;
    let token = process
        .runtime_token
        .clone()
        .ok_or_else(|| "OpenCode Runtime credentials are unavailable".to_string())?;
    Ok((url, token))
}

fn validate_runtime_url(base: &str, requested: &str) -> Result<reqwest::Url, String> {
    let base = reqwest::Url::parse(base).map_err(|e| e.to_string())?;
    if !requested.starts_with('/') || requested.starts_with("//") {
        return Err("OpenCode request target must be a runtime-relative path".into());
    }
    base.join(requested).map_err(|e| e.to_string())
}

fn runtime_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(620))
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())
}

fn runtime_event_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(2))
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn agent_runtime_request(
    state: tauri::State<'_, AgentRuntimeState>,
    request: RuntimeHttpRequest,
) -> Result<RuntimeHttpResponse, String> {
    let (base, token) = runtime_connection(&state).await?;
    let url = validate_runtime_url(&base, &request.url)?;
    let method = reqwest::Method::from_bytes(request.method.as_bytes())
        .map_err(|_| format!("Invalid OpenCode HTTP method: {}", request.method))?;
    let client = runtime_http_client()?;
    let mut outgoing = client
        .request(method, url)
        .basic_auth("opencode", Some(token));
    for (name, value) in request.headers {
        if matches!(
            name.to_ascii_lowercase().as_str(),
            "authorization" | "host" | "content-length" | "connection"
        ) {
            continue;
        }
        let name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| format!("Invalid OpenCode request header: {name}"))?;
        let value = reqwest::header::HeaderValue::from_str(&value)
            .map_err(|_| format!("Invalid value for OpenCode request header: {name}"))?;
        outgoing = outgoing.header(name, value);
    }
    if let Some(body) = request.body {
        outgoing = outgoing.body(body);
    }
    let response = outgoing
        .send()
        .await
        .map_err(|e| format!("OpenCode transport failed: {e}"))?;
    let status = response.status();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.to_string(), value.to_string()))
        })
        .collect();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read OpenCode response: {e}"))?;
    Ok(RuntimeHttpResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        headers,
        body,
    })
}

#[tauri::command]
pub async fn agent_runtime_subscribe(
    app: AppHandle,
    state: tauri::State<'_, AgentRuntimeState>,
    subscription_id: String,
    directory: String,
) -> Result<(), String> {
    let (base, token) = runtime_connection(&state).await?;
    let mut url = reqwest::Url::parse(&format!("{base}/event")).map_err(|e| e.to_string())?;
    url.query_pairs_mut().append_pair("directory", &directory);
    let client = runtime_event_client()?;
    let (cancel_tx, mut cancel_rx) = oneshot::channel();
    if let Some(previous) = state
        .subscriptions
        .lock()
        .await
        .insert(subscription_id.clone(), cancel_tx)
    {
        let _ = previous.send(());
    }
    let task_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = async {
            let response = client
                .get(url)
                .basic_auth("opencode", Some(token))
                .send()
                .await
                .map_err(|e| format!("OpenCode event transport failed: {e}"))?;
            if !response.status().is_success() {
                return Err(format!("OpenCode event stream returned {}", response.status()));
            }
            let mut stream = response.bytes_stream();
            let mut buffer = Vec::new();
            loop {
                tokio::select! {
                    _ = &mut cancel_rx => break,
                    next = stream.next() => match next {
                        Some(Ok(bytes)) => {
                            buffer.extend_from_slice(&bytes);
                            while let Some(frame) = take_sse_frame(&mut buffer) {
                                if let Some(event) = parse_sse_data(&frame) {
                                    let _ = task_app.emit("agent-runtime-event", RuntimeStreamEvent {
                                        subscription_id: subscription_id.clone(),
                                        event: Some(event),
                                        error: None,
                                        done: false,
                                    });
                                }
                            }
                        }
                        Some(Err(error)) => return Err(format!("OpenCode event stream failed: {error}")),
                        None => break,
                    }
                }
            }
            Ok::<(), String>(())
        }
        .await;
        let _ = task_app.emit(
            "agent-runtime-event",
            RuntimeStreamEvent {
                subscription_id: subscription_id.clone(),
                event: None,
                error: result.err(),
                done: true,
            },
        );
        task_app
            .state::<AgentRuntimeState>()
            .subscriptions
            .lock()
            .await
            .remove(&subscription_id);
    });
    Ok(())
}

#[tauri::command]
pub async fn agent_runtime_unsubscribe(
    state: tauri::State<'_, AgentRuntimeState>,
    subscription_id: String,
) -> Result<(), String> {
    if let Some(cancel) = state.subscriptions.lock().await.remove(&subscription_id) {
        let _ = cancel.send(());
    }
    Ok(())
}

#[tauri::command]
pub async fn agent_runtime_register_tools(
    state: tauri::State<'_, AgentRuntimeState>,
    tools: Vec<RuntimeTool>,
    request_id: String,
) -> Result<usize, String> {
    if request_id.is_empty() { return Err("Agent tool registration requires requestId".into()); }
    let mut run = state.tool_run.write().await;
    if !run.request_id.is_empty() && run.request_id != request_id {
        return Err("Shotloom tool transport already has an active run".into());
    }
    *run = ToolRunContext { request_id, session_id: String::new() };
    let mut target = state.tools.write().await;
    *target = tools;
    Ok(target.len())
}

#[tauri::command]
pub async fn agent_runtime_bind_tool_session(
    state: tauri::State<'_, AgentRuntimeState>, request_id: String, session_id: String,
) -> Result<(), String> {
    let mut run = state.tool_run.write().await;
    if run.request_id != request_id || session_id.is_empty() {
        return Err("Unknown Agent run or empty tool session".into());
    }
    run.session_id = session_id;
    Ok(())
}

#[tauri::command]
pub async fn agent_runtime_release_tool_run(
    state: tauri::State<'_, AgentRuntimeState>, request_id: String,
) -> Result<(), String> {
    let mut run = state.tool_run.write().await;
    if run.request_id == request_id {
        *run = ToolRunContext::default();
        for (_, sender) in state.pending.lock().await.drain() {
            let _ = sender.send(Err("Shotloom Agent run ended".into()));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn agent_tool_reply(
    state: tauri::State<'_, AgentRuntimeState>,
    call_id: String,
    result: Option<Value>,
    error: Option<String>,
) -> Result<(), String> {
    let sender = state
        .pending
        .lock()
        .await
        .remove(&call_id)
        .ok_or_else(|| format!("Unknown or expired tool call: {call_id}"))?;
    let reply = match error {
        Some(error) => Err(error),
        None => Ok(result.unwrap_or(Value::Null)),
    };
    sender
        .send(reply)
        .map_err(|_| "Tool caller no longer accepts a reply".to_string())
}

#[tauri::command]
pub async fn agent_runtime_stop(state: tauri::State<'_, AgentRuntimeState>) -> Result<(), String> {
    state.shutdown().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;

    fn bridge() -> BridgeState {
        BridgeState {
            app: None,
            tools: Arc::new(RwLock::new(vec![RuntimeTool {
                name: "get_canvas".into(),
                description: "Read canvas".into(),
                input_schema: json!({ "type": "object", "additionalProperties": false }),
            }])),
            pending: Arc::new(Mutex::new(HashMap::new())),
            tool_run: Arc::new(RwLock::new(ToolRunContext { request_id: "run-1".into(), session_id: "session-1".into() })),
            token: "secret".into(),
        }
    }

    fn auth() -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert("authorization", "Bearer secret".parse().unwrap());
        headers
    }

    async fn body(response: Response) -> Value {
        serde_json::from_slice(&to_bytes(response.into_body(), 1_000_000).await.unwrap()).unwrap()
    }

    fn process_state_for_supervisor() -> ProcessState {
        ProcessState {
            status: RuntimeStatus { state: "ready".into(), error: None },
            child: None,
            configuration_key: None,
            runtime_url: None,
            runtime_token: None,
            generation: 1,
            desired_running: true,
            failure_times_ms: VecDeque::new(),
            circuit_open_until_ms: 0,
            consecutive_health_failures: 0,
            last_health_at_ms: 0,
            last_progress_at_ms: unix_ms(),
            active_run_id: None,
            active_project_key: None,
            last_stall_notice_at_ms: 0,
        }
    }

    #[test]
    fn runtime_failures_open_the_circuit_at_the_configured_threshold() {
        let mut process = process_state_for_supervisor();
        let config = RuntimeProtectionConfiguration {
            failure_threshold: Some(3),
            failure_window_ms: Some(60_000),
            circuit_cooldown_ms: Some(30_000),
            ..RuntimeProtectionConfiguration::default()
        };
        record_failure(&mut process, &config);
        record_failure(&mut process, &config);
        assert_eq!(process.circuit_open_until_ms, 0);
        record_failure(&mut process, &config);
        assert!(process.circuit_open_until_ms > unix_ms());
    }

    #[tokio::test]
    async fn tool_transport_requires_bearer_auth() {
        assert_eq!(tool_context(State(bridge()), HeaderMap::new()).await.status(), StatusCode::UNAUTHORIZED);
        let response = execute_tool(State(bridge()), HeaderMap::new(), Json(ToolRequest {
            request_id: "run-1".into(), name: "get_canvas".into(), arguments: json!({}),
        })).await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn tool_transport_rejects_stale_runs_and_unknown_tools() {
        let response = execute_tool(State(bridge()), auth(), Json(ToolRequest {
            request_id: "old-run".into(), name: "get_canvas".into(), arguments: json!({}),
        })).await;
        assert_eq!(response.status(), StatusCode::CONFLICT);
        let response = execute_tool(State(bridge()), auth(), Json(ToolRequest {
            request_id: "run-1".into(), name: "unknown".into(), arguments: json!({}),
        })).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn tool_context_returns_only_active_run_identity() {
        let context = body(tool_context(State(bridge()), auth()).await).await;
        assert_eq!(context, json!({ "requestId": "run-1", "sessionId": "session-1" }));
        let state = bridge();
        *state.tool_run.write().await = ToolRunContext::default();
        assert_eq!(tool_context(State(state), auth()).await.status(), StatusCode::CONFLICT);
    }

    #[test]
    fn gateway_only_accepts_runtime_relative_targets() {
        let base = "http://127.0.0.1:61234";
        assert_eq!(
            validate_runtime_url(base, "/session?directory=%2Ftmp")
                .unwrap()
                .as_str(),
            "http://127.0.0.1:61234/session?directory=%2Ftmp"
        );
        assert!(validate_runtime_url(base, "http://example.com/session").is_err());
        assert!(validate_runtime_url(base, "//example.com/session").is_err());
    }

    #[test]
    fn gateway_parses_complete_sse_frames() {
        let mut buffer = b"data: {\"type\":\"message.part.updated\",\"text\":\"\xE7\x94\xBB\xE5\xB8\x83\"}\r\n\r\nrest".to_vec();
        let frame = take_sse_frame(&mut buffer).unwrap();
        let event = parse_sse_data(&frame).unwrap();
        assert_eq!(event["text"], "画布");
        assert_eq!(buffer, b"rest");
    }

    #[test]
    fn macos_system_proxy_is_forwarded_as_an_http_connect_proxy() {
        let proxy = parse_macos_system_proxy(
            "<dictionary> {\n  HTTPEnable : 1\n  HTTPPort : 7897\n  HTTPProxy : 127.0.0.1\n  HTTPSEnable : 1\n  HTTPSPort : 7897\n  HTTPSProxy : 127.0.0.1\n}",
        );
        assert_eq!(proxy.as_deref(), Some("http://127.0.0.1:7897"));
    }
}
