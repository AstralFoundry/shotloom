use super::common::{chrono_stamp, read_json, user_file, write_json};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{process::Command, sync::Mutex, time::Duration};
use tauri::{AppHandle, Manager};

const RECOVERY_SCHEMA_VERSION: u32 = 1;
const JOURNAL_FILE: &str = "runtime-recovery.json";
const PREVIOUS_FILE: &str = "previous-unclean-exit.json";

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryJournal {
    pub schema_version: u32,
    pub session_id: String,
    pub clean_exit: bool,
    pub started_at: String,
    pub heartbeat_at: String,
    pub pid: u32,
    pub app_version: String,
    pub runtime_state: String,
    pub active_run_id: String,
    pub active_project_key: String,
    pub rss_kb: Option<u64>,
    pub available_memory_kb: Option<u64>,
    pub last_error: String,
}

pub struct RecoveryState {
    current: Mutex<RecoveryJournal>,
    previous_unclean: Mutex<Option<RecoveryJournal>>,
    low_memory_polls: Mutex<u32>,
    last_pressure_emit_ms: Mutex<u128>,
}

impl RecoveryState {
    pub fn new() -> Self {
        Self {
            current: Mutex::new(RecoveryJournal::default()),
            previous_unclean: Mutex::new(None),
            low_memory_polls: Mutex::new(0),
            last_pressure_emit_ms: Mutex::new(0),
        }
    }
}

fn process_rss_kb() -> Option<u64> {
    #[cfg(unix)]
    {
        let output = Command::new("ps")
            .args(["-o", "rss=", "-p", &std::process::id().to_string()])
            .output()
            .ok()?;
        return String::from_utf8(output.stdout).ok()?.trim().parse().ok();
    }
    #[cfg(windows)]
    {
        let query = format!(
            "(Get-Process -Id {}).WorkingSet64 / 1KB",
            std::process::id()
        );
        let output = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &query])
            .output()
            .ok()?;
        return String::from_utf8(output.stdout).ok()?.trim().parse().ok();
    }
    #[allow(unreachable_code)]
    None
}

fn available_memory_kb() -> Option<u64> {
    #[cfg(target_os = "linux")]
    {
        let content = std::fs::read_to_string("/proc/meminfo").ok()?;
        return content.lines().find_map(|line| {
            line.strip_prefix("MemAvailable:")?
                .split_whitespace()
                .next()?
                .parse()
                .ok()
        });
    }
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("vm_stat").output().ok()?;
        let text = String::from_utf8(output.stdout).ok()?;
        let page_size = text
            .lines()
            .next()?
            .split("page size of ")
            .nth(1)?
            .split_whitespace()
            .next()?
            .parse::<u64>()
            .ok()?;
        let mut pages = 0_u64;
        for prefix in ["Pages free:", "Pages inactive:", "Pages speculative:"] {
            if let Some(value) = text.lines().find_map(|line| {
                line.trim()
                    .strip_prefix(prefix)?
                    .trim()
                    .trim_end_matches('.')
                    .parse::<u64>()
                    .ok()
            }) {
                pages = pages.saturating_add(value);
            }
        }
        return Some(pages.saturating_mul(page_size) / 1024);
    }
    #[cfg(windows)]
    {
        let output = Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory",
            ])
            .output()
            .ok()?;
        return String::from_utf8(output.stdout).ok()?.trim().parse().ok();
    }
    #[allow(unreachable_code)]
    None
}

fn persist(app: &AppHandle, journal: &RecoveryJournal) -> Result<(), String> {
    let value = serde_json::to_value(journal).map_err(|error| error.to_string())?;
    write_json(&user_file(app, JOURNAL_FILE)?, &value)
}

fn unix_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<RecoveryState>();
    let path = user_file(app, JOURNAL_FILE)?;
    let previous_value = read_json(&path, Value::Null)?;
    let previous = serde_json::from_value::<RecoveryJournal>(previous_value).ok();
    if let Some(previous) = previous.filter(|entry| !entry.clean_exit) {
        let previous_path = user_file(app, PREVIOUS_FILE)?;
        write_json(
            &previous_path,
            &serde_json::to_value(&previous).map_err(|error| error.to_string())?,
        )?;
        *state.previous_unclean.lock().map_err(|error| error.to_string())? = Some(previous);
    }
    let now = chrono_stamp();
    let journal = RecoveryJournal {
        schema_version: RECOVERY_SCHEMA_VERSION,
        session_id: format!("{}-{}", std::process::id(), now),
        clean_exit: false,
        started_at: now.clone(),
        heartbeat_at: now,
        pid: std::process::id(),
        app_version: env!("CARGO_PKG_VERSION").into(),
        runtime_state: "stopped".into(),
        rss_kb: process_rss_kb(),
        available_memory_kb: available_memory_kb(),
        ..RecoveryJournal::default()
    };
    persist(app, &journal)?;
    *state.current.lock().map_err(|error| error.to_string())? = journal;

    let heartbeat_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            let state = heartbeat_app.state::<RecoveryState>();
            let snapshot = {
                let Ok(mut current) = state.current.lock() else { break };
                if current.clean_exit {
                    break;
                }
                current.heartbeat_at = chrono_stamp();
                current.rss_kb = process_rss_kb();
                current.available_memory_kb = available_memory_kb();
                current.clone()
            };
            if let Err(error) = persist(&heartbeat_app, &snapshot) {
                eprintln!("[recovery] heartbeat persistence failed: {error}");
            }
            let available_kb = snapshot.available_memory_kb.unwrap_or(u64::MAX);
            let low = available_kb < 1_048_576;
            let critical = available_kb < 524_288;
            let should_emit = {
                let Ok(mut polls) = state.low_memory_polls.lock() else { break };
                *polls = if low { polls.saturating_add(1) } else { 0 };
                let required = if critical { 1 } else { 3 };
                if *polls < required { false } else {
                    let Ok(mut last) = state.last_pressure_emit_ms.lock() else { break };
                    let cooldown = if critical { 120_000 } else { 600_000 };
                    if unix_ms().saturating_sub(*last) < cooldown { false } else {
                        *last = unix_ms();
                        *polls = 0;
                        true
                    }
                }
            };
            if should_emit {
                let _ = tauri::Emitter::emit(&heartbeat_app, "system-memory-pressure", json!({
                    "level": if critical { "critical" } else { "low" },
                    "availableMemoryKb": available_kb,
                    "rssKb": snapshot.rss_kb,
                }));
            }
        }
    });
    Ok(())
}

pub fn mark_clean_exit(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<RecoveryState>();
    let snapshot = {
        let mut current = state.current.lock().map_err(|error| error.to_string())?;
        current.clean_exit = true;
        current.heartbeat_at = chrono_stamp();
        current.clone()
    };
    persist(app, &snapshot)
}

#[tauri::command]
pub fn recovery_status(app: AppHandle) -> Result<Value, String> {
    let state = app.state::<RecoveryState>();
    let current = state.current.lock().map_err(|error| error.to_string())?.clone();
    let previous = state
        .previous_unclean
        .lock()
        .map_err(|error| error.to_string())?
        .clone();
    Ok(json!({ "current": current, "previousUnclean": previous }))
}

#[tauri::command]
pub fn recovery_update_activity(
    app: AppHandle,
    runtime_state: Option<String>,
    active_run_id: Option<String>,
    active_project_key: Option<String>,
    last_error: Option<String>,
) -> Result<(), String> {
    let state = app.state::<RecoveryState>();
    let snapshot = {
        let mut current = state.current.lock().map_err(|error| error.to_string())?;
        if let Some(value) = runtime_state { current.runtime_state = value; }
        if let Some(value) = active_run_id { current.active_run_id = value; }
        if let Some(value) = active_project_key { current.active_project_key = value; }
        if let Some(value) = last_error { current.last_error = value; }
        current.heartbeat_at = chrono_stamp();
        current.clone()
    };
    persist(&app, &snapshot)
}
