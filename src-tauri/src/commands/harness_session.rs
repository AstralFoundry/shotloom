use serde_json::{json, Value};
use super::common::localized_error;
use tauri::State;
use super::{HarnessBridgeState, HarnessRuntimeState};

/// Configuration arrives only through the product native IPC boundary.
#[tauri::command]
pub async fn harness_bind_session(
    window: tauri::WebviewWindow,
    runtime: State<'_, HarnessRuntimeState>,
    bridge: State<'_, HarnessBridgeState>,
    config: Value,
) -> Result<Value, String> {
    if window.label() != "main" { return Err("Untrusted Harness configuration caller".into()); }
    let result = native_request(&runtime, "bind", config.clone()).await?;
    let id = result.get("sessionId").and_then(Value::as_str).ok_or_else(|| localized_error("native.harness.missingSession", json!({}), "Agent Host 未返回会话 ID".into()))?;
    let mut binding = config.get("binding").cloned().ok_or_else(|| localized_error("native.harness.missingBinding", json!({}), "缺少会话绑定信息".into()))?;
    binding.as_object_mut().ok_or_else(|| localized_error("native.harness.invalidBinding", json!({}), "会话绑定信息格式无效".into()))?.insert("sessionId".to_string(), Value::String(id.to_string()));
    bridge.bindings.lock().map_err(|_| localized_error("native.harness.bridgeState", json!({}), "工具桥接状态不可用，请重启应用".into()))?.insert(id.to_string(), binding);
    Ok(result)
}


pub(super) enum NativeReply {
    Request(tokio::sync::oneshot::Sender<Result<Value, String>>),
    Stream(tauri::ipc::Channel<Value>),
}

fn write_native(runtime: &HarnessRuntimeState, message: &Value) -> Result<(), String> {
    use std::io::Write;
    let mut child = runtime.child.lock().map_err(|e| e.to_string())?;
    let input = child.as_mut().and_then(|child| child.stdin.as_mut()).ok_or("Agent Host is not running")?;
    let line = serde_json::to_vec(message).map_err(|e| e.to_string())?;
    input.write_all(&line).and_then(|_| input.write_all(b"\n")).and_then(|_| input.flush()).map_err(|e| e.to_string())
}

async fn native_request(runtime: &HarnessRuntimeState, kind: &str, payload: Value) -> Result<Value, String> {
    let request_id = uuid::Uuid::new_v4().to_string();
    let (send, receive) = tokio::sync::oneshot::channel();
    runtime.replies.lock().map_err(|e| e.to_string())?.insert(request_id.clone(), NativeReply::Request(send));
    if let Err(error) = write_native(runtime, &json!({"requestId":request_id,"kind":kind,"payload":payload})) {
        runtime.replies.lock().map_err(|e| e.to_string())?.remove(&request_id);
        return Err(error);
    }
    let result = tokio::time::timeout(std::time::Duration::from_secs(60), receive).await;
    runtime.replies.lock().map_err(|e| e.to_string())?.remove(&request_id);
    result.map_err(|_| "Agent Host request timed out".to_string())?.map_err(|_| "Agent Host disconnected".to_string())?
}

pub(super) fn deliver_native(runtime: &HarnessRuntimeState, payload: &str) {
    let Ok(message) = serde_json::from_str::<Value>(payload) else { return; };
    let Some(id) = message.get("requestId").and_then(Value::as_str) else { return; };
    let terminal = matches!(message.get("kind").and_then(Value::as_str), Some("result" | "end" | "error"));
    let mut replies = runtime.replies.lock().unwrap_or_else(|e| e.into_inner());
    if terminal {
        if let Some(reply) = replies.remove(id) {
            match reply {
                NativeReply::Request(send) => { let _ = send.send(if message["kind"] == "error" { Err(message["error"].as_str().unwrap_or("Agent Host failed").into()) } else { Ok(message["value"].clone()) }); }
                NativeReply::Stream(channel) => { let _ = channel.send(message); }
            }
        }
    } else if let Some(NativeReply::Stream(channel)) = replies.get(id) { let _ = channel.send(message); }
}

/// Only the product WebView has this IPC command; no HTTP browser endpoint exists.
#[tauri::command]
pub fn harness_transport(window: tauri::WebviewWindow, runtime: State<'_, HarnessRuntimeState>, message: Value, channel: tauri::ipc::Channel<Value>) -> Result<(), String> {
    if window.label() != "main" { return Err("Untrusted Harness transport caller".into()); }
    let id = message.get("requestId").and_then(Value::as_str).ok_or("Missing transport request ID")?;
    let kind = message.get("kind").and_then(Value::as_str).ok_or("Missing transport operation")?;
    if matches!(kind, "fetch" | "stream") {
        runtime.replies.lock().map_err(|e| e.to_string())?.insert(id.into(), NativeReply::Stream(channel));
    } else if !matches!(kind, "cancel" | "uplink") { return Err("Invalid client transport operation".into()); }
    if let Err(error) = write_native(&runtime, &message) {
        runtime.replies.lock().map_err(|e| e.to_string())?.remove(id);
        return Err(error);
    }
    if kind == "cancel" { runtime.replies.lock().map_err(|e| e.to_string())?.remove(id); }
    Ok(())
}
