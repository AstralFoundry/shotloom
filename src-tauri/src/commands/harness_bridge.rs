use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashMap, sync::{Arc, Mutex}, time::Duration};
use tauri::{AppHandle, Emitter, State};
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::TcpListener, sync::oneshot, time::timeout};

#[derive(Default, Clone)]
pub struct HarnessBridgeState {
    port: Arc<Mutex<Option<u16>>>,
    token: Arc<Mutex<Option<String>>>,
    pub(super) bindings: Arc<Mutex<HashMap<String, Value>>>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HarnessBridgeStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessToolResponse {
    pub request_id: String,
    pub result: Option<Value>,
    pub error: Option<String>,
}

fn status(state: &HarnessBridgeState) -> HarnessBridgeStatus {
    HarnessBridgeStatus {
        running: state.port.lock().ok().and_then(|value| *value).is_some(),
        port: state.port.lock().ok().and_then(|value| *value),
        token: state.token.lock().ok().and_then(|value| value.clone()),
    }
}

pub fn start_harness_bridge(app: &AppHandle, state: &HarnessBridgeState) -> Result<HarnessBridgeStatus, String> {
    if status(state).running { return Ok(status(state)); }
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    listener.set_nonblocking(true).map_err(|error| error.to_string())?;
    let port = listener.local_addr().map_err(|error| error.to_string())?.port();
    let token = uuid::Uuid::new_v4().to_string();
    *state.port.lock().map_err(|_| "bridge state poisoned".to_string())? = Some(port);
    *state.token.lock().map_err(|_| "bridge state poisoned".to_string())? = Some(token.clone());
    // `from_std` checks for an entered Tokio reactor. Tauri commands run on
    // a synchronous thread, so perform that conversion inside the app runtime
    // before handing the listener to the long-lived task below.
    let listener = tauri::async_runtime::block_on(async { TcpListener::from_std(listener) })
        .map_err(|error| error.to_string())?;
    let bridge = state.clone();
    let app = app.clone();
    tauri::async_runtime::spawn(async move { accept_loop(listener, app, bridge, token).await; });
    Ok(status(state))
}

async fn accept_loop(listener: TcpListener, app: AppHandle, state: HarnessBridgeState, token: String) {
    loop {
        let Ok((mut stream, _)) = listener.accept().await else { break; };
        let app = app.clone();
        let state = state.clone();
        let token = token.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = timeout(Duration::from_secs(130), handle_connection(&mut stream, &app, &state, &token)).await.unwrap_or_else(|_| Err("bridge request timeout".to_string())) {
                let _ = write_json(&mut stream, 400, serde_json::json!({ "success": false, "error": error })).await;
            }
        });
    }
}

async fn handle_connection(stream: &mut tokio::net::TcpStream, app: &AppHandle, state: &HarnessBridgeState, token: &str) -> Result<(), String> {
    let mut bytes = Vec::new();
    let mut chunk = [0_u8; 4096];
    let header_end;
    loop {
        let count = stream.read(&mut chunk).await.map_err(|error| error.to_string())?;
        if count == 0 { return Err("empty request".to_string()); }
        bytes.extend_from_slice(&chunk[..count]);
        if let Some(index) = bytes.windows(4).position(|value| value == b"\r\n\r\n") { header_end = index + 4; break; }
        if bytes.len() > 1_048_576 { return Err("request headers too large".to_string()); }
    }
    let header = String::from_utf8_lossy(&bytes[..header_end]);
    let content_length = header.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        key.eq_ignore_ascii_case("content-length").then(|| value.trim().parse::<usize>().ok()).flatten()
    }).unwrap_or(0);
    if content_length > 8 * 1024 * 1024 { return Err("request body too large".to_string()); }
    while bytes.len() < header_end + content_length {
        let count = stream.read(&mut chunk).await.map_err(|error| error.to_string())?;
        if count == 0 { return Err("truncated request".to_string()); }
        bytes.extend_from_slice(&chunk[..count]);
    }
    let request: Value = serde_json::from_slice(&bytes[header_end..header_end + content_length]).map_err(|error| error.to_string())?;
    let supplied = request.get("token").and_then(Value::as_str).unwrap_or_default();
    if supplied != token { return Err("invalid bridge token".to_string()); }
    if request.get("op").and_then(Value::as_str) == Some("health") {
        return write_json(stream, 200, serde_json::json!({ "success": true })).await;
    }
    if request.get("op").and_then(Value::as_str) != Some("tool") { return Err("unsupported bridge operation".to_string()); }
    let binding = request.get("binding").ok_or("missing trusted session binding")?;
    let session_id = binding.get("sessionId").and_then(Value::as_str).ok_or("missing session id")?;
    if state.bindings.lock().map_err(|_| "bridge state poisoned")?.get(session_id) != Some(binding) {
        return Err("unregistered or mismatched session binding".to_string());
    }
    let request_id = request.get("requestId").and_then(Value::as_str).filter(|value| !value.is_empty()).ok_or("missing call id")?.to_string();
    let (sender, receiver) = oneshot::channel();
    {
        let mut pending = state.pending.lock().map_err(|_| "bridge state poisoned")?;
        if pending.contains_key(&request_id) { return Err("call already pending".to_string()); }
        pending.insert(request_id.clone(), sender);
    }
    let payload = serde_json::json!({ "requestId": request_id, "toolName": request.get("toolName"), "input": request.get("input"), "binding": binding, "phase": request.get("phase"), "approvedByHarness": request.get("approvedByHarness") });
    let emitted = app.emit("harness://tool-request", payload).map_err(|error| error.to_string());
    let result = match emitted {
        Ok(()) => timeout(Duration::from_secs(120), receiver).await.map_err(|_| "tool bridge timeout".to_string()).and_then(|value| value.map_err(|_| "tool bridge cancelled".to_string())),
        Err(error) => Err(error),
    };
    state.pending.lock().map_err(|_| "bridge state poisoned")?.remove(&request_id);
    let result = result?;
    write_json(stream, 200, match result { Ok(value) => serde_json::json!({ "success": true, "result": value }), Err(error) => serde_json::json!({ "success": false, "error": error }) }).await
}

async fn write_json(stream: &mut tokio::net::TcpStream, code: u16, value: Value) -> Result<(), String> {
    let body = serde_json::to_vec(&value).map_err(|error| error.to_string())?;
    let response = format!("HTTP/1.1 {} OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", code, body.len());
    stream.write_all(response.as_bytes()).await.map_err(|error| error.to_string())?;
    stream.write_all(&body).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub fn harness_bridge_status(state: State<'_, HarnessBridgeState>) -> HarnessBridgeStatus { status(&state) }

#[tauri::command]
pub fn harness_tool_respond(state: State<'_, HarnessBridgeState>, response: HarnessToolResponse) -> Result<(), String> {
    let sender = state.pending.lock().map_err(|_| "bridge state poisoned".to_string())?.remove(&response.request_id);
    match sender {
        Some(sender) => { sender.send(response.result.ok_or_else(|| response.error.unwrap_or_else(|| "tool failed".to_string())).map_err(|error| error.to_string())).map_err(|_| "tool request no longer waiting".to_string())?; Ok(()) }
        None => Err("unknown or expired tool request".to_string()),
    }
}

pub fn bridge_env(state: &HarnessBridgeState) -> Option<(u16, String)> {
    let port = state.port.lock().ok().and_then(|value| *value)?;
    let token = state.token.lock().ok().and_then(|value| value.clone())?;
    Some((port, token))
}
