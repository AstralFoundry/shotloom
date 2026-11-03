use serde_json::{json, Value};
use super::common::localized_error;
use tauri::State;
use super::{HarnessBridgeState, HarnessRuntimeState};
use super::harness_bridge::bridge_env;

/// Native-only configuration channel; its credential is never sent to the iframe.
#[tauri::command]
pub async fn harness_bind_session(
    runtime: State<'_, HarnessRuntimeState>,
    bridge: State<'_, HarnessBridgeState>,
    config: Value,
) -> Result<Value, String> {
    let origin = runtime.url.lock().map_err(|_| localized_error("native.harness.hostState", json!({}), "Agent Host 状态不可用，请重启应用".into()))?.clone().ok_or_else(|| localized_error("native.harness.hostNotReady", json!({}), "Agent Host 尚未就绪".into()))?;
    let (_, token) = bridge_env(&bridge).ok_or_else(|| localized_error("native.harness.bridgeNotReady", json!({}), "工具桥接尚未就绪".into()))?;
    let response = reqwest::Client::new().post(format!("{origin}/shotloom/session"))
        .bearer_auth(token).json(&config).timeout(std::time::Duration::from_secs(30))
        .send().await.map_err(|error| error.to_string())?;
    let status = response.status();
    let result: Value = response.json().await.map_err(|error| error.to_string())?;
    if !status.is_success() { return Err(result.to_string()); }
    let id = result.get("sessionId").and_then(Value::as_str).ok_or_else(|| localized_error("native.harness.missingSession", json!({}), "Agent Host 未返回会话 ID".into()))?;
    let mut binding = config.get("binding").cloned().ok_or_else(|| localized_error("native.harness.missingBinding", json!({}), "缺少会话绑定信息".into()))?;
    binding.as_object_mut().ok_or_else(|| localized_error("native.harness.invalidBinding", json!({}), "会话绑定信息格式无效".into()))?.insert("sessionId".to_string(), Value::String(id.to_string()));
    bridge.bindings.lock().map_err(|_| localized_error("native.harness.bridgeState", json!({}), "工具桥接状态不可用，请重启应用".into()))?.insert(id.to_string(), binding);
    Ok(result)
}
