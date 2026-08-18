use std::{path::PathBuf, process::Command};

pub(crate) fn media_tool(name: &str) -> Result<PathBuf, String> {
    let executable = if cfg!(target_os = "windows") { format!("{name}.exe") } else { name.to_string() };
    let mut candidates = Vec::new();
    if let Ok(current) = std::env::current_exe() {
        if let Some(directory) = current.parent() {
            candidates.push(directory.join(&executable));
            candidates.push(directory.join("resources").join(&executable));
            if let Some(contents) = directory.parent() {
                candidates.push(contents.join("Resources").join(&executable));
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from(format!("/opt/homebrew/bin/{name}")));
        candidates.push(PathBuf::from(format!("/usr/local/bin/{name}")));
    }
    #[cfg(target_os = "windows")]
    candidates.push(PathBuf::from(&executable));
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        candidates.push(PathBuf::from(format!("/usr/bin/{name}")));
        candidates.push(PathBuf::from(format!("/usr/local/bin/{name}")));
    }
    candidates.push(PathBuf::from(&executable));
    candidates
        .into_iter()
        .find(|candidate| Command::new(candidate).arg("-version").output().is_ok_and(|output| output.status.success()))
        .ok_or_else(|| format!("未找到 {name}。请安装 FFmpeg，或将 {executable} 放入应用资源目录"))
}
