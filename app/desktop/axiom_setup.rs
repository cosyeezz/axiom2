// Bootstrap runs fixed, bundled scripts; web content never supplies commands or paths.
use serde_json::{json, Value};
use std::{fs, io::{Read, Write, Seek, SeekFrom}, process::{Command, Stdio}, time::{Duration, Instant}};
use tauri::{Manager, Webview};
use tauri_plugin_opener::OpenerExt;

// Short registry transactions serialize readers and publishers across clients.
// A separate OS lease lives for the complete worker lifetime; process death releases it.
fn open_lock(path: &std::path::Path) -> Result<fs::File, String> {
    fs::OpenOptions::new().read(true).write(true).create(true).truncate(false).open(path).map_err(|e| e.to_string())
}
fn registry_lock() -> Result<fs::File, String> {
    let dir = crate::axiom_service::data_root()?.join("setup");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = open_lock(&dir.join("registry.lock"))?;
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        match file.try_lock() {
            Ok(()) => return Ok(file),
            Err(fs::TryLockError::WouldBlock) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            Err(fs::TryLockError::WouldBlock) => return Err("安装状态正被其他客户端读取，请稍后重试。".into()),
            Err(fs::TryLockError::Error(error)) => return Err(error.to_string()),
        }
    }
}
fn lease_busy(path: &std::path::Path) -> Result<bool, String> {
    let file = open_lock(path)?;
    match file.try_lock() { Ok(()) => Ok(false), Err(fs::TryLockError::WouldBlock) => Ok(true), Err(fs::TryLockError::Error(e)) => Err(e.to_string()) }
}

fn snapshot() -> Result<Option<Value>, String> {
    let _registry = registry_lock()?;
    snapshot_unlocked()
}
fn snapshot_unlocked() -> Result<Option<Value>, String> {
    snapshot_at(&crate::axiom_service::data_root()?.join("setup"))
}
fn snapshot_at(dir: &std::path::Path) -> Result<Option<Value>, String> {
    let mut job: Value = match fs::read(dir.join("job.json")) { Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "安装记录损坏，请检查安装日志。")?, Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None), Err(error) => return Err(error.to_string()) };
    let id = job["id"].as_str().filter(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_digit() || c == '-')).ok_or("安装任务编号无效")?.to_string();
    if !job["running"].is_boolean() { return Err("安装记录缺少执行状态，请检查安装日志。".into()); }
    if !job["lines"].is_array() { job["lines"] = json!([]); }
    if !job["phase"].is_string() { job["phase"] = json!("running"); }
    if !job["message"].is_string() { job["message"] = json!("正在核实安装状态。"); }
    let files = dir.join(id);
    let busy = lease_busy(&files.join("owner.lock"))?;
    if !busy { if let Ok(text) = fs::read_to_string(files.join("result.txt")) {
        if let Ok(code) = text.trim().trim_start_matches('\u{feff}').parse::<i32>() {
            job["running"] = json!(false); job["phase"] = json!(if code == 0 { "done" } else { "error" });
            job["exitCode"] = json!(code);
            job["message"] = json!(if code == 0 { "安装步骤已完成，正在验证实际状态。".to_string() } else { format!("安装命令退出（代码 {code}），未收到具体错误输出。请检查运行环境及网络后重试。") });
        }
    } }
    if !busy && job["running"] == true {
        job["running"] = json!(false); job["phase"] = json!("interrupted");
        job["message"] = json!("上次安装意外中断，结果未确认。请检查系统安装器；确认全部退出后解除占用并重新验证。");
    }
    if let Ok(mut file) = fs::File::open(files.join("install.log")) {
        let metadata = file.metadata().map_err(|e| e.to_string())?;
        let len = metadata.len();
        job["logUpdatedAt"] = json!(metadata.modified().ok().and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok()).map(|duration| duration.as_millis() as u64));
        file.seek(SeekFrom::Start(len.saturating_sub(32_768))).map_err(|e| e.to_string())?;
        let mut bytes = Vec::new(); file.take(32_768).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&bytes);
        let mut lines = Vec::new();
        let mut last_error = None;
        let mut last_phase = None;
        job["progress"] = Value::Null;
        for line in text.lines() {
            if let Some(value) = line.strip_prefix("@@progress:") {
                if let Ok(value) = serde_json::from_str::<Value>(value) { job["progress"] = value; }
                continue;
            }
            if let Some(message) = line.strip_prefix("@@phase:") {
                job["progress"] = Value::Null; last_phase = Some(message.to_string());
            }
            if let Some(message) = line.strip_prefix("@@error:") { last_error = Some(message.to_string()); }
            lines.push(line.trim_start_matches("@@phase:").trim_start_matches("@@error:").chars().take(4000).collect::<String>());
        }
        if job["running"] == true {
            if !job["progress"].is_null() { job["message"] = json!(format!("正在下载并校验 {}…", job["progress"]["name"].as_str().unwrap_or("安装包"))); }
            else { job["message"] = json!(last_phase.unwrap_or_else(|| "正在执行安装命令；下方显示最近的实际输出。".into())); }
        }
        if job["phase"] == "error" {
            if let Some(message) = last_error.or_else(|| lines.iter().rev().find(|line| !line.trim().is_empty() && !line.contains("请查看执行详情")).cloned()) { job["message"] = json!(message); }
        }
        job["lines"] = json!(lines.into_iter().rev().take(80).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>());
    }
    Ok(Some(job))
}
pub fn ensure_idle() -> Result<(), String> {
    if snapshot()?.as_ref().is_some_and(|j| j["running"] == true || j["phase"] == "interrupted") { Err("安装正在进行或上次结果待核实，请在安装区查看进度。".into()) } else { Ok(()) }
}
pub fn is_running() -> bool { snapshot().ok().flatten().is_some_and(|j| j["running"] == true) }
fn hidden(command: &mut Command) {
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    command.stdin(Stdio::null());
}
pub fn capture(command: &mut Command, seconds: u64) -> Result<String, String> {
    hidden(command); command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let out = child.stdout.take().ok_or("无法读取命令输出")?;
    let err = child.stderr.take().ok_or("无法读取错误输出")?;
    let read = |mut stream: Box<dyn Read + Send>| { let mut result = Vec::new(); let mut buffer = [0; 8192]; loop { let n = stream.read(&mut buffer).unwrap_or(0); if n == 0 { break; } if result.len() < 2_000_000 { result.extend_from_slice(&buffer[..n]); } } String::from_utf8_lossy(&result).trim_start_matches('\u{feff}').to_string() };
    let (out_send, stdout) = std::sync::mpsc::sync_channel(1);
    let (err_send, stderr) = std::sync::mpsc::sync_channel(1);
    std::thread::spawn(move || { let _ = out_send.send(read(Box::new(out))); });
    std::thread::spawn(move || { let _ = err_send.send(read(Box::new(err))); });
    let deadline = Instant::now() + Duration::from_secs(seconds);
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? { break status; }
        if Instant::now() >= deadline { let _ = child.kill(); let _ = child.wait(); return Err("读取状态超时，请重试。".into()); }
        std::thread::sleep(Duration::from_millis(50));
    };
    let output = stdout.recv_timeout(deadline.saturating_duration_since(Instant::now())).map_err(|_| "读取命令输出超时，请重试。")?;
    let error = stderr.recv_timeout(deadline.saturating_duration_since(Instant::now())).map_err(|_| "读取错误输出超时，请重试。")?;
    if status.success() { Ok(output) } else { Err(if error.trim().is_empty() { output } else { error }) }
}
fn script(action: &str) -> Result<Command, String> {
    let root = crate::axiom_service::data_root()?;
    let dir = root.join("setup"); fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join(if cfg!(windows) { concat!("bootstrap-", env!("CARGO_PKG_VERSION"), ".ps1") } else { concat!("bootstrap-", env!("CARGO_PKG_VERSION"), ".sh") });
    let source = if cfg!(windows) { format!("\u{feff}{}", include_str!("setup.ps1")) } else { include_str!("setup.sh").to_string() };
    if fs::read_to_string(&file).ok().as_deref() != Some(source.as_str()) { fs::write(&file, source).map_err(|e| e.to_string())?; }
    let helper = dir.join(concat!("setup-service-", env!("CARGO_PKG_VERSION"), ".mjs"));
    let helper_source = include_str!("setup-service.mjs");
    if fs::read_to_string(&helper).ok().as_deref() != Some(helper_source) { fs::write(&helper, helper_source).map_err(|e| e.to_string())?; }
    let mut command;
    if cfg!(windows) {
        let system = std::env::var_os("SystemRoot").ok_or("无法定位系统 PowerShell")?;
        command = Command::new(std::path::PathBuf::from(system).join("System32/WindowsPowerShell/v1.0/powershell.exe"));
        command.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"]).arg(file).arg("-Action").arg(action);
    } else { command = Command::new("/bin/sh"); command.arg(file).arg(action); }
    command.env("AXIOM_DATA_DIR", &root).env("AXIOM_SETUP_SERVICE", helper).env("AXIOM_SETUP_RESULT", root.join("setup/result.txt"));
    Ok(command)
}
pub fn runtime_node() -> Result<std::path::PathBuf, String> {
    let state: Value = serde_json::from_str(capture(&mut script("check")?, 20)?.trim()).map_err(|_| "运行环境检测未返回有效状态。")?;
    if state["nodeReady"] != true { return Err("请先在运行环境中安装 Node.js 22.19.0+ 和 npm；终端 Pi 不需要安装后台服务。".into()); }
    let node = std::path::PathBuf::from(state["node"].as_str().ok_or("未找到 Node.js 路径，请重新验证运行环境。")?);
    if !node.is_absolute() || !node.is_file() { return Err("Node.js 路径不可用，请重新验证运行环境。".into()); }
    Ok(node)
}
fn install(action: String, id: String) -> Result<(), String> {
    let _control = crate::axiom_service::CONTROL.lock().map_err(|_| "服务控制器不可用")?;
    let dir = crate::axiom_service::data_root()?.join("setup").join(id);
    let log = fs::File::create(dir.join("install.log")).map_err(|e| e.to_string())?;
    let mut command = script(&action)?; hidden(&mut command);
    command.env("AXIOM_SETUP_RESULT", dir.join("result.txt"));
    command.stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?)).stderr(Stdio::from(log));
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let status = child.wait().map_err(|e| e.to_string())?;
    fs::write(dir.join("result.txt"), status.code().unwrap_or(1).to_string()).map_err(|e| e.to_string())?;
    // The script has already logged the exact failure. Do not append a generic
    // error that replaces it in both the summary and the execution details.
    Ok(())
}
#[tauri::command]
pub async fn axiom_setup(webview: Webview, action: String, confirmed: Option<bool>) -> Result<Value, String> {
    crate::axiom_views::authorize(&webview)?;
    if action == "status" { return tauri::async_runtime::spawn_blocking(|| Ok(json!({"job":snapshot()?}))).await.map_err(|e| e.to_string())?; }
    if action == "acknowledge-interruption" {
        if confirmed != Some(true) { return Err("请先确认系统安装器已经全部退出。".into()); }
        return tauri::async_runtime::spawn_blocking(|| {
        let _registry = registry_lock()?;
        let job = snapshot_unlocked()?.ok_or("没有待处理的安装任务")?;
        if job["phase"] != "interrupted" { return Err("当前任务不需要解除占用。".into()); }
        let dir = crate::axiom_service::data_root()?.join("setup").join(job["id"].as_str().ok_or("安装任务编号无效")?);
        fs::write(dir.join("result.txt"), "1").map_err(|e| e.to_string())?;
        Ok(json!({"job":snapshot_unlocked()?}))
        }).await.map_err(|e| e.to_string())?;
    }
    if action == "check" {
        return tauri::async_runtime::spawn_blocking(|| {
            let text = capture(&mut script("check")?, 20)?;
            serde_json::from_str::<Value>(text.trim()).map_err(|_| "环境检测未返回有效状态。".into())
        }).await.map_err(|e| e.to_string())?;
    }
    if action == "open-node" || action == "open-tailscale" {
        let url = if action == "open-node" { "https://nodejs.org/en/download" } else { "https://tailscale.com/download" };
        webview.app_handle().opener().open_url(url, None::<&str>).map_err(|e| e.to_string())?;
        return Ok(json!({"opened":true}));
    }
    if action == "launch-tailscale" {
        #[cfg(windows)] {
            let path = std::path::PathBuf::from(std::env::var_os("ProgramFiles").ok_or("找不到程序目录")?).join("Tailscale/tailscale-ipn.exe");
            Command::new(path).spawn().map_err(|e| e.to_string())?;
        }
        #[cfg(target_os = "macos")] { Command::new("/usr/bin/open").args(["-a", "Tailscale"]).spawn().map_err(|e| e.to_string())?; }
        return Ok(json!({"opened":true}));
    }
    if !["node", "tailscale", "service"].contains(&action.as_str()) { return Err("不支持的安装步骤。".into()); }
    tauri::async_runtime::spawn_blocking(move || {
    let id = format!("{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos());
    let lease = {
        let _registry = registry_lock()?;
        if snapshot_unlocked()?.as_ref().is_some_and(|j| j["running"] == true || j["phase"] == "interrupted") { return Err("已有安装任务正在执行或结果待核实。".into()); }
        let dir = crate::axiom_service::data_root()?.join("setup");
        fs::create_dir_all(dir.join(&id)).map_err(|e| e.to_string())?;
        let lease = open_lock(&dir.join(&id).join("owner.lock"))?;
        lease.try_lock().map_err(|e| e.to_string())?;
        let job = json!({"id":id,"action":action,"running":true,"phase":"running","message":"正在准备安装；请保持客户端打开。","startedAt":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis() as u64,"lines":[]});
        // Readers hold registry.lock, so they cannot observe a partial publication.
        fs::write(dir.join("job.next"), serde_json::to_vec(&job).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        fs::rename(dir.join("job.next"), dir.join("job.json")).map_err(|e| e.to_string())?;
        lease
    };
    std::thread::spawn(move || {
        let _lease = lease;
        let result = install(action, id.clone());
        if let Err(error) = result {
            if let Ok(root) = crate::axiom_service::data_root() {
                let dir = root.join("setup").join(id);
                if let Ok(mut log) = fs::OpenOptions::new().create(true).append(true).open(dir.join("install.log")) { let _ = writeln!(log, "@@error:{error}"); }
                let _ = fs::write(dir.join("result.txt"), "1");
            }
        }
    });
    Ok(json!({"job":snapshot()?}))
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn download_progress_and_exact_errors_survive_snapshots() {
        let root = std::env::temp_dir().join(format!("axiom-setup-progress-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let files = root.join("123-789"); fs::create_dir_all(&files).unwrap();
        fs::write(root.join("job.json"), r#"{"id":"123-789","running":true}"#).unwrap();
        let lease = open_lock(&files.join("owner.lock")).unwrap(); lease.try_lock().unwrap();
        fs::write(files.join("install.log"), "@@phase:正在下载并校验…\n@@progress:{\"name\":\"axiom2.tgz\",\"downloaded\":512,\"total\":1024,\"speed\":256}\n").unwrap();
        let job = snapshot_at(&root).unwrap().unwrap();
        assert_eq!(job["progress"]["downloaded"], 512);
        assert!(job["message"].as_str().unwrap().contains("axiom2.tgz"));
        assert!(!job["lines"].to_string().contains("@@progress"));
        fs::write(files.join("install.log"), "@@phase:正在校验…\n@@error:安装包大小不符：预期 1024 字节，实际 512 字节。\n").unwrap();
        fs::write(files.join("result.txt"), "1").unwrap(); drop(lease);
        let job = snapshot_at(&root).unwrap().unwrap();
        assert_eq!(job["phase"], "error"); assert_eq!(job["exitCode"], 1);
        assert_eq!(job["message"], "安装包大小不符：预期 1024 字节，实际 512 字节。");
        assert!(job["progress"].is_null());
        assert!(!job.to_string().contains("请查看执行详情"));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn worker_lease_guards_completion_and_exposes_interruption() {
        let root = std::env::temp_dir().join(format!("axiom-setup-test-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let files = root.join("123-456"); fs::create_dir_all(&files).unwrap();
        fs::write(root.join("job.json"), r#"{"id":"123-456","running":true}"#).unwrap();
        let lease = open_lock(&files.join("owner.lock")).unwrap(); lease.try_lock().unwrap();
        assert!(lease_busy(&files.join("owner.lock")).unwrap());
        fs::write(files.join("result.txt"), "0").unwrap();
        assert_eq!(snapshot_at(&root).unwrap().unwrap()["running"], true, "result cannot complete a still-owned worker");
        drop(lease);
        assert_eq!(snapshot_at(&root).unwrap().unwrap()["phase"], "done");
        fs::remove_file(files.join("result.txt")).unwrap();
        assert_eq!(snapshot_at(&root).unwrap().unwrap()["phase"], "interrupted");
        assert_eq!(snapshot_at(&root).unwrap().unwrap()["running"], false, "interrupted jobs must not trap window close");
        fs::write(root.join("job.json"), r#"{"id":"../escape","running":true}"#).unwrap();
        assert!(snapshot_at(&root).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
