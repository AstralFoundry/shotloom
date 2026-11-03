use serde::Serialize;
use std::{path::PathBuf, process::Command};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentE2eScreenshot {
    pub path: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

/// Temporary desktop verification hook. The test runner brings the Tauri
/// window to front with osascript, then this command captures the visible
/// WKWebView frame without modifying product state.
#[tauri::command]
pub fn capture_agent_e2e_screen(path: Option<String>) -> Result<AgentE2eScreenshot, String> {
    #[cfg(target_os = "macos")]
    {
        let target = path.map(PathBuf::from).unwrap_or_else(|| std::env::temp_dir().join("shotloom-agent-e2e.png"));
        if let Some(parent) = target.parent() { std::fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
        let status = Command::new("screencapture")
            .args(["-x", "-o"])
            .arg(&target)
            .status()
            .map_err(|error| format!("启动 screencapture 失败：{error}"))?;
        if !status.success() { return Err(format!("screencapture 退出码 {:?}", status.code())); }
        return Ok(AgentE2eScreenshot { path: target.display().to_string(), width: None, height: None });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err("Agent E2E screenshot is only available on macOS".to_string())
    }
}
