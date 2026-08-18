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

pub(crate) fn child_proxy_environment() -> Vec<(String, String)> {
    let loopback = "127.0.0.1,localhost,::1";
    let existing_no_proxy = std::env::var("NO_PROXY")
        .or_else(|_| std::env::var("no_proxy"))
        .unwrap_or_default();
    let no_proxy = if existing_no_proxy.is_empty() {
        loopback.to_string()
    } else {
        format!("{existing_no_proxy},{loopback}")
    };
    let mut environment = vec![("NO_PROXY".into(), no_proxy.clone()), ("no_proxy".into(), no_proxy)];
    let inherited_proxy = [
        "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy",
    ]
    .iter()
    .any(|key| std::env::var(key).is_ok_and(|value| !value.trim().is_empty()));
    if inherited_proxy {
        return environment;
    }
    if let Some(proxy) = resolved_system_proxy_url() {
        for key in [
            "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy",
        ] {
            environment.push((key.into(), proxy.clone()));
        }
    }
    environment
}
