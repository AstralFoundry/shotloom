use serde_json::json;
use super::common::localized_error;
use std::{
    collections::HashMap,
    io::Read,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::State;

/// 长时原生媒体任务的取消通道。
///
/// FFmpeg 子进程一旦启动就会跑到结束，用户停止 Agent 轮次或关掉导出窗口都不能让它停下，
/// 工具层也因此无法保证"这次调用真的被中断"。渲染进程用 requestId 登记任务，取消时只置
/// 一个标记，子进程在下一次轮询时被终止。
#[derive(Default)]
pub struct MediaTaskState {
    flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl MediaTaskState {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Arc<AtomicBool>>> {
        self.flags.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn begin(&self, request_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.lock().insert(request_id.to_string(), flag.clone());
        flag
    }

    pub fn finish(&self, request_id: &str) {
        self.lock().remove(request_id);
    }

    pub fn cancel(&self, request_id: &str) -> bool {
        match self.lock().get(request_id) {
            Some(flag) => {
                flag.store(true, Ordering::Release);
                true
            }
            None => false,
        }
    }
}

#[tauri::command]
pub async fn media_task_cancel(
    state: State<'_, MediaTaskState>,
    request_id: String,
) -> Result<bool, String> {
    Ok(state.cancel(&request_id))
}

pub struct FfmpegRun {
    pub ok: bool,
    pub stderr: String,
    pub cancelled: bool,
}

fn stderr_tail(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    text.chars()
        .rev()
        .take(4_000)
        .collect::<String>()
        .chars()
        .rev()
        .collect()
}

/// 运行 FFmpeg 并在每次轮询时检查取消标记；stderr 由独立线程持续读空，
/// 否则管道写满会让子进程停在退出之前，取消也就永远轮不到。
pub fn run_ffmpeg(command: &mut Command, cancelled: &AtomicBool) -> Result<FfmpegRun, String> {
    let mut child: Child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| localized_error("native.error.e9f40671ae", json!({"error": error.to_string()}), format!("无法启动 FFmpeg：{error}")))?;
    let mut pipe = child.stderr.take();
    let reader = thread::spawn(move || {
        let mut buffer = Vec::new();
        if let Some(pipe) = pipe.as_mut() {
            let _ = pipe.read_to_end(&mut buffer);
        }
        buffer
    });
    loop {
        if cancelled.load(Ordering::Acquire) {
            let _ = child.kill();
            let _ = child.wait();
            return Ok(FfmpegRun {
                ok: false,
                stderr: String::new(),
                cancelled: true,
            });
        }
        match child.try_wait().map_err(|error| localized_error("native.error.fdb7a33db2", json!({"error": error.to_string()}), format!("无法等待 FFmpeg：{error}")))? {
            Some(status) => {
                let stderr = stderr_tail(&reader.join().unwrap_or_default());
                return Ok(FfmpegRun {
                    ok: status.success(),
                    stderr,
                    cancelled: false,
                });
            }
            None => thread::sleep(Duration::from_millis(50)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn cancel_flag_terminates_a_long_running_child() {
        let flag = Arc::new(AtomicBool::new(false));
        let killer = flag.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(100));
            killer.store(true, Ordering::Release);
        });
        let mut command = Command::new("/bin/sleep");
        command.arg("30");
        let started = std::time::Instant::now();
        let run = run_ffmpeg(&mut command, &flag).expect("cancelled run must resolve");
        assert!(run.cancelled);
        assert!(!run.ok);
        assert!(started.elapsed() < Duration::from_secs(5), "取消后不应等满整条命令");
    }

    #[cfg(unix)]
    #[test]
    fn finished_run_reports_status_and_stderr() {
        let flag = Arc::new(AtomicBool::new(false));
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "echo failure-reason 1>&2; exit 3"]);
        let run = run_ffmpeg(&mut command, &flag).unwrap();
        assert!(!run.ok);
        assert!(!run.cancelled);
        assert!(run.stderr.contains("failure-reason"));
    }

    #[test]
    fn registry_only_cancels_registered_tasks() {
        let state = MediaTaskState::default();
        let flag = state.begin("export-1");
        assert!(!state.cancel("other-1"));
        assert!(state.cancel("export-1"));
        assert!(flag.load(Ordering::Acquire));
        state.finish("export-1");
        assert!(!state.cancel("export-1"));
    }
}
