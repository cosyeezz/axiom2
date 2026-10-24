//! Run inventory before desktop initialization, in a disposable worker process.
use serde_json::Value;
use std::{io::{Read, Write}, path::Path, process::{Child, Command, Stdio}, sync::mpsc, time::{Duration, Instant}};
const WORKER_FLAG: &str = "--axiom-environment-worker";
const MAX_OUTPUT: u64 = 2 * 1024 * 1024;
static REAPING: std::sync::Mutex<Option<Child>> = std::sync::Mutex::new(None);

// Called by the generated main before Tauri, plugins and single-instance hooks.
pub fn worker() -> bool {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new(WORKER_FLAG)) { return false; }
    let Some(root) = args.next() else { return true; };
    let selected = match args.next().as_deref() {
        None => false,
        Some(value) if value == std::ffi::OsStr::new("selected") => true,
        _ => return true,
    };
    if args.next().is_some() || !Path::new(&root).is_absolute() { return true; }
    let result = if selected {
        let Some(value) = root.to_str() else { return true; };
        if crate::axiom_environment::validate_selected_root(value).is_err() { return true; }
        crate::axiom_environment::selected(Path::new(&root))
    } else { crate::axiom_environment::current(Path::new(&root)) };
    if let Ok(bytes) = serde_json::to_vec(&result) {
        if bytes.len() as u64 <= MAX_OUTPUT { let _ = std::io::stdout().lock().write_all(&bytes); }
    }
    true
}
fn ready() -> Result<(), String> {
    let mut pending = REAPING.lock().unwrap_or_else(|poison| poison.into_inner());
    if let Some(child) = pending.as_mut() {
        match child.try_wait() {
            Ok(Some(_)) => { *pending = None; },
            Ok(None) => return Err("上次扫描进程正在退出，请稍后重试。".into()),
            Err(error) => return Err(format!("无法核实上次扫描进程退出状态：{error}")),
        }
    }
    Ok(())
}
fn terminate(mut child: Child) {
    let _ = child.kill();
    // Normally termination completes within a few milliseconds. Never require a
    // new reaper thread, and retain ownership if the OS has not confirmed exit.
    for _ in 0..10 {
        if matches!(child.try_wait(), Ok(Some(_))) { return; }
        std::thread::sleep(Duration::from_millis(5));
    }
    *REAPING.lock().unwrap_or_else(|poison| poison.into_inner()) = Some(child);
}
fn supervise(mut command: Command, limit: Duration) -> Result<Value, String> {
    ready()?;
    let started = Instant::now();
    let mut child = command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|error| format!("无法启动环境扫描：{error}"))?;
    let stdout = child.stdout.take().ok_or("扫描输出不可用")?;
    let (sender, receiver) = mpsc::sync_channel(1);
    if let Err(error) = std::thread::Builder::new().name("axiom-inventory-output".into()).spawn(move || {
        let mut bytes = Vec::new();
        let result = stdout.take(MAX_OUTPUT + 1).read_to_end(&mut bytes)
            .map_err(|error| format!("扫描输出读取失败：{error}"))
            .and_then(|_| if bytes.len() as u64 > MAX_OUTPUT { Err("扫描结果超过大小上限".into()) } else { Ok(bytes) });
        let _ = sender.send(result);
    }) { terminate(child); return Err(format!("无法读取扫描结果：{error}")); }
    let mut output = None;
    loop {
        if started.elapsed() >= limit { terminate(child); return Err("环境扫描超时，已请求终止扫描进程；未执行任何清理，可重新扫描。".into()); }
        match receiver.try_recv() {
            Ok(Ok(bytes)) => output = Some(bytes),
            Ok(Err(error)) => { terminate(child); return Err(error); },
            Err(mpsc::TryRecvError::Disconnected) if output.is_none() => { terminate(child); return Err("扫描输出中断".into()); },
            Err(_) => {},
        }
        match child.try_wait() {
            Ok(Some(status)) if !status.success() => return Err(format!("扫描进程异常退出：{status}")),
            Ok(Some(_)) => if let Some(bytes) = output { return serde_json::from_slice(&bytes).map_err(|_| "扫描结果无效，请重新扫描。".into()); },
            Ok(None) => {},
            Err(error) => { terminate(child); return Err(format!("无法核实扫描进程：{error}")); },
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}
pub(crate) fn scan(root: &Path, selected: bool) -> Result<Value, String> {
    let mut command = Command::new(std::env::current_exe().map_err(|error| format!("无法定位客户端：{error}"))?);
    command.arg(WORKER_FLAG).arg(root);
    if selected { command.arg("selected"); }
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    supervise(command, Duration::from_secs(6))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    static TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    #[test]
    fn worker_timeout_does_not_prevent_next_scan() {
        let _serial = TEST_LOCK.lock().unwrap();
        let mut stalled = Command::new("/bin/sh"); stalled.args(["-c", "exec sleep 30"]);
        let started = Instant::now();
        assert!(supervise(stalled, Duration::from_millis(100)).unwrap_err().contains("超时"));
        assert!(started.elapsed() < Duration::from_secs(2));
        let mut next = Command::new("/bin/sh"); next.args(["-c", "printf '{\"ok\":true}'"]);
        assert_eq!(supervise(next, Duration::from_secs(2)).unwrap()["ok"], true);
    }
    #[test]
    fn invalid_worker_output_is_not_a_successful_inventory() {
        let _serial = TEST_LOCK.lock().unwrap();
        let mut command = Command::new("/bin/sh"); command.args(["-c", "printf invalid"]);
        assert!(supervise(command, Duration::from_secs(2)).unwrap_err().contains("结果无效"));
    }
    #[test]
    fn pending_process_is_retained_until_exit_is_confirmed() {
        let _serial = TEST_LOCK.lock().unwrap();
        let child = Command::new("/bin/sh").args(["-c", "exec sleep 30"]).spawn().unwrap();
        *REAPING.lock().unwrap() = Some(child);
        assert!(supervise(Command::new("/nonexistent/never-spawn"), Duration::from_secs(1)).unwrap_err().contains("正在退出"));
        let mut child = REAPING.lock().unwrap().take().unwrap();
        child.kill().unwrap(); child.wait().unwrap();
        // Keep the reaped Child in the slot so ready() must confirm and clear it.
        *REAPING.lock().unwrap() = Some(child);
        assert!(ready().is_ok());
        assert!(REAPING.lock().unwrap().is_none());
    }
}
