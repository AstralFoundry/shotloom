use serde_json::Value;

/// Typed product error serialized across existing Result<_, String> IPC boundaries.
/// The frontend translates only this explicit envelope; upstream details remain data.
pub fn localized_error(key: &str, params: Value, fallback: String) -> String {
    serde_json::json!({
        "type": "shotloom:localized-error", "key": key, "params": params, "fallback": fallback
    }).to_string()
}

/// Recognize the protocol structurally; never infer a product error from prose.
pub(crate) fn is_localized_error(message: &str) -> bool {
    let Ok(value) = serde_json::from_str::<Value>(message) else { return false; };
    value["type"] == "shotloom:localized-error"
        && value["key"].is_string()
        && value["params"].is_object()
        && value["fallback"].is_string()
}
