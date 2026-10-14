#[cfg(target_os = "macos")]
use std::process::Command;
use std::collections::HashMap;

pub(crate) fn parse_macos_system_proxy(output: &str) -> Option<String> {
    let values = output
        .lines()
        .filter_map(|line| line.trim().split_once(':'))
        .map(|(key, value)| (key.trim(), value.trim()))
        .collect::<HashMap<_, _>>();
    for prefix in ["HTTPS", "HTTP"] {
        let enable_key = format!("{prefix}Enable");
        let proxy_key = format!("{prefix}Proxy");
        let port_key = format!("{prefix}Port");
        if values.get(enable_key.as_str()) != Some(&"1") {
            continue;
        }
        let host = values.get(proxy_key.as_str())?;
        let port = values.get(port_key.as_str())?;
        let proxy = format!("http://{host}:{port}");
        if reqwest::Url::parse(&proxy).is_ok() {
            return Some(proxy);
        }
    }
    None
}

pub(crate) fn resolved_system_proxy_url() -> Option<String> {
    for key in [
        "HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "https_proxy", "http_proxy", "all_proxy",
    ] {
        if let Ok(value) = std::env::var(key) {
            if reqwest::Url::parse(value.trim()).is_ok() {
                return Some(value.trim().to_string());
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        return Command::new("/usr/sbin/scutil")
            .arg("--proxy")
            .output()
            .ok()
            .filter(|output| output.status.success())
            .and_then(|output| String::from_utf8(output.stdout).ok())
            .and_then(|output| parse_macos_system_proxy(&output));
    }
    #[cfg(not(target_os = "macos"))]
    None
}
