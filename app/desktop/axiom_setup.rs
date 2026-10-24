// Bootstrap runs fixed, bundled scripts; web content never supplies commands or paths.
use serde_json::{json, Value};
use std::{fs, io::{Read, Write, Seek, SeekFrom}, process::{Child, Command, ExitStatus, Stdio}, time::{Duration, Instant}};
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
    let job: Value = match fs::read(dir.join("job.json")) { Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "安装记录损坏，请检查安装日志。")?, Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None), Err(error) => return Err(error.to_string()) };
    snapshot_job_at(dir, job, true).map(Some)
}
fn snapshot_job_at(dir: &std::path::Path, mut job: Value, current: bool) -> Result<Value, String> {
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
    match fs::read(files.join("task.json")) {
        Ok(bytes) => {
            let task: Value = serde_json::from_slice(&bytes).map_err(|_| "安装任务记录损坏，请检查安装日志。")?;
            if task["id"] != job["id"] { return Err("安装任务记录身份不匹配。".into()); }
            job["task"] = task;
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && !job["task"].is_object() => {},
        Err(error) => return Err(error.to_string()),
    }
    if job["task"].is_object() && job["running"] != true {
        if job["phase"] == "interrupted" && job["task"]["status"] != "unknown" { job["task"]["status"] = json!("interrupted"); }
        else if job["task"]["status"] == "running" || job["task"]["status"] == "cancelling" { job["task"]["status"] = json!(if job["phase"] == "done" { "succeeded" } else { "failed" }); }
        job["task"]["capabilities"] = json!({"cancel":false,"extend":false});
    }
    merge_system_budgets(&mut job["task"], &files);
    let expired_path = files.join("system-timeout.json");
    let expired = if expired_path.exists() { Some(read_json(&expired_path).unwrap_or(json!({"code":"operation","phase":"installing","message":"系统安装等待记录损坏，请核实安装器与实际版本。"}))) } else { None };
    let observer_lost = !busy && files.join("observer-started.json").exists() && !files.join("observer-complete.json").exists();
    let acknowledged = files.join("acknowledged.json").exists();
    let service_pending = current && !busy && job["action"] == "service" && dir.join("service-owner.json").exists();
    if service_pending {
        job["task"]["status"] = json!("unknown");
        job["task"]["message"] = json!("后台安装或启动的归属记录尚未解除，请核实进程与后台状态；不要重复安装。");
        job["task"]["error"] = json!({"code":"stop-unconfirmed","phase":job["task"]["phase"],"message":job["task"]["message"]});
    }
    if service_pending || !acknowledged && (expired.is_some() || observer_lost || job["task"]["status"] == "unknown") {
        job["running"] = json!(busy);
        job["phase"] = json!(if busy { "running" } else { "interrupted" });
        job["message"] = if job["action"] == "service" {
            job["task"]["message"].as_str().filter(|message| !message.is_empty()).map(|message| json!(message))
                .unwrap_or(json!("后台安装或启动结果尚未核实，请检查维护记录与实际后台状态；不要重复安装。"))
        } else { json!(if busy { "系统安装已超过等待时限，结果待核实；仍在等待安装器退出，安装占用已保留。" } else { "系统安装结果待核实。请检查安装器及实际版本，确认安装器全部退出后解除占用。" }) };
        job["task"]["status"] = json!("unknown");
        job["task"]["message"] = job["message"].clone();
        job["task"]["capabilities"] = json!({"cancel":false,"extend":false});
        if let Some(error) = expired { job["task"]["error"] = error; }
    } else if busy && job["task"]["phase"] == "installing" && job["task"]["capabilities"]["cancel"] == false && job["action"] != "service" {
        job["task"]["capabilities"]["extend"] = json!(true);
    }
    Ok(job)
}
fn history_at(dir: &std::path::Path) -> Result<Value, String> {
    let mut warnings = Vec::new();
    let current = match snapshot_at(dir) {
        Ok(value) => value,
        Err(error) => { warnings.push(format!("当前安装状态未能读取：{error}")); None },
    };
    let current_id = current.as_ref().and_then(|job| job["id"].as_str());
    let mut tasks = Vec::new();
    for entry in fs::read_dir(dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.is_empty() || !name.chars().all(|c| c.is_ascii_digit() || c == '-') || !entry.file_type().map_err(|error| error.to_string())?.is_dir() { continue; }
        let record = (|| -> Result<Value, String> {
            let read = |file: &str| -> Result<Option<Value>, String> {
                let path = entry.path().join(file);
                let metadata = match fs::symlink_metadata(&path) { Ok(value) => value, Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None), Err(error) => return Err(error.to_string()) };
                if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 524288 { return Err("安装记录类型或大小无效。".into()); }
                let mut bytes = Vec::new();
                fs::File::open(path).map_err(|error| error.to_string())?.take(524289).read_to_end(&mut bytes).map_err(|error| error.to_string())?;
                if bytes.len() > 524288 { return Err("安装记录大小超限。".into()); }
                serde_json::from_slice(&bytes).map(Some).map_err(|_| "安装记录损坏。".into())
            };
            let task = read("task.json")?.ok_or("缺少安装任务记录。")?;
            if task["id"].as_str() != Some(name.as_str()) || !task["steps"].is_array() || !valid_budgets(&task["budgets"]) { return Err("安装任务详情不完整或编号不一致。".into()); }
            if current_id == Some(name.as_str()) { return Ok(current.as_ref().unwrap().clone()); }
            let job = if let Some(job) = read("job.json")? { job } else {
                // Older clients kept only the latest job pointer, but each task
                // has its own durable file. Reuse that evidence without replay.
                let running = task["status"] == "running" || task["status"] == "cancelling";
                let phase = if running { "running" } else if task["status"] == "succeeded" { "done" } else if task["status"] == "unknown" || task["status"] == "interrupted" { "interrupted" } else { "error" };
                json!({"id":task["id"],"action":task["resource"],"running":running,"phase":phase,"message":task["message"],"task":task,"lines":[]})
            };
            if job["id"].as_str() != Some(name.as_str()) { return Err("安装记录编号与目录不一致。".into()); }
            // With a missing/corrupt pointer, an existing service owner cannot
            // be assigned to one task safely. Preserve that uncertainty.
            snapshot_job_at(dir, job, current_id.is_none())
        })();
        match record {
            Ok(job) if job["task"].is_object() && job["task"]["id"] == job["id"] => tasks.push(job["task"].clone()),
            Ok(_) => warnings.push(format!("{name}：缺少有效任务详情。")),
            Err(error) => warnings.push(format!("{name}：{error}")),
        }
    }
    tasks.sort_by_key(|task| task["createdAt"].as_u64().unwrap_or(0));
    // Retain every unresolved task; bound only ordinary terminal history.
    let mut recent = 0;
    tasks.reverse();
    tasks.retain(|task| if ["running","cancelling","unknown","interrupted"].contains(&task["status"].as_str().unwrap_or("unknown")) { true } else { recent += 1; recent <= 100 });
    tasks.reverse();
    Ok(json!({"tasks":tasks,"error":if warnings.is_empty() { None } else { Some(format!("部分安装记录未能读取（{} 项）：{}", warnings.len(), warnings.iter().take(5).cloned().collect::<Vec<_>>().join("；"))) }}))
}
fn read_json(path: &std::path::Path) -> Option<Value> {
    fs::read(path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok())
}
fn merge_system_budgets(task: &mut Value, dir: &std::path::Path) {
    if !task.is_object() { return; }
    if let Some(control) = read_json(&dir.join("control.json")) {
        if valid_budgets(&control["budgets"]) {
            for key in ["headersMs","idleMs","installMs","totalMs"] {
                if control["budgets"][key].as_u64() > task["budgets"][key].as_u64() { task["budgets"][key] = control["budgets"][key].clone(); }
            }
        }
    }
}
fn system_deadline(task: &Value, now: u64) -> Option<Value> {
    if task["phase"] != "installing" || task["capabilities"]["cancel"] != false || !valid_budgets(&task["budgets"]) { return None; }
    let total = now.saturating_sub(task["startedAt"].as_u64()?);
    let installing = now.saturating_sub(task["phaseStartedAt"].as_u64()?);
    let code = if total >= task["budgets"]["totalMs"].as_u64()? { "total-timeout" }
        else if installing >= task["budgets"]["installMs"].as_u64()? { "install-timeout" } else { return None; };
    Some(json!({"code":code,"phase":"installing","observedAt":now,"message":"系统安装超过等待时限，结果待核实；未终止系统安装器，安装占用已保留。"}))
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
    for (name, source) in [("maintenance.mjs", include_str!("maintenance.mjs")), ("service-start.mjs", include_str!("service-start.mjs")), ("setup-runtime.json", include_str!("setup-runtime.json"))] {
        let path = dir.join(name);
        if fs::read_to_string(&path).ok().as_deref() != Some(source) { fs::write(path, source).map_err(|e| e.to_string())?; }
    }
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
fn valid_budgets(value: &Value) -> bool {
    value.as_object().is_some_and(|map| map.len() == 4 && ["headersMs","idleMs","installMs","totalMs"].iter().all(|key| value[*key].as_u64().is_some_and(|n| (1000..=86_400_000).contains(&n))))
}
fn read_budgets(dir: &std::path::Path) -> Value {
    fs::read(dir.join("budgets.json")).ok().and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok()).filter(valid_budgets).unwrap_or(json!({"headersMs":30000,"idleMs":60000,"installMs":600000,"totalMs":1200000}))
}
fn wait_installer(child: &mut Child, dir: &std::path::Path, system: bool) -> Result<ExitStatus, String> {
    loop {
        // The system owns elevated installers. Record an expired observation
        // budget, but keep the worker lease and wait instead of killing a parent
        // process and claiming its installer descendants have stopped.
        if system && !dir.join("system-timeout.json").exists() {
            if let Some(mut task) = read_json(&dir.join("task.json")) {
                merge_system_budgets(&mut task, dir);
                let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis() as u64;
                if let Some(error) = system_deadline(&task, now) {
                    fs::write(dir.join("system-timeout.next"), serde_json::to_vec(&error).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
                    fs::rename(dir.join("system-timeout.next"), dir.join("system-timeout.json")).map_err(|e| e.to_string())?;
                }
            }
        }
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? { return Ok(status); }
        std::thread::sleep(Duration::from_millis(100));
    }
}
fn install(action: String, id: String) -> Result<(), String> {
    let _control = crate::axiom_service::CONTROL.lock().map_err(|_| "服务控制器不可用")?;
    let dir = crate::axiom_service::data_root()?.join("setup").join(id);
    let log = fs::File::create(dir.join("install.log")).map_err(|e| e.to_string())?;
    let mut command = script(&action)?; hidden(&mut command);
    command.env("AXIOM_SETUP_RESULT", dir.join("result.txt")).env("AXIOM_SETUP_TASK_DIR", &dir);
    command.stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?)).stderr(Stdio::from(log));
    if action != "service" { fs::write(dir.join("observer-started.json"), r#"{"systemInstaller":true}"#).map_err(|e| e.to_string())?; }
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let status = wait_installer(&mut child, &dir, action != "service")?;
    if action != "service" { fs::write(dir.join("observer-complete.json"), serde_json::to_vec(&json!({"exitCode":status.code()})).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?; }
    fs::write(dir.join("result.txt"), status.code().unwrap_or(1).to_string()).map_err(|e| e.to_string())?;
    // The script has already logged the exact failure. Do not append a generic
    // error that replaces it in both the summary and the execution details.
    Ok(())
}
#[tauri::command]
pub async fn axiom_setup(webview: Webview, action: String, confirmed: Option<bool>, maintenance: Option<Value>) -> Result<Value, String> {
    crate::axiom_views::authorize(&webview)?;
    if ["defaults", "extend", "cancel"].contains(&action.as_str()) {
        return tauri::async_runtime::spawn_blocking(move || {
            let _registry = registry_lock()?;
            let dir = crate::axiom_service::data_root()?.join("setup");
            let payload = maintenance.unwrap_or(json!({}));
            if action == "defaults" {
                if !valid_budgets(&payload["budgets"]) { return Err("下载预算无效。".into()); }
                fs::write(dir.join("budgets.json"), serde_json::to_vec(&payload["budgets"]).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            } else {
                let job = snapshot_unlocked()?.ok_or("没有进行中的安装任务")?;
                if job["running"] != true || payload["id"] != job["id"] { return Err("安装任务已结束或身份已变化。".into()); }
                let task_dir = dir.join(job["id"].as_str().ok_or("任务编号无效")?);
                let file = task_dir.join("control.json");
                let mut control: Value = fs::read(&file).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or(json!({}));
                if action == "cancel" {
                    if job["task"]["capabilities"]["cancel"] != true { return Err("系统安装器当前不可取消，请等待结果。".into()); }
                    control["cancel"] = json!(true);
                } else {
                    let previous = if control["budgets"].is_object() { &control["budgets"] } else { &job["task"]["budgets"] };
                    if job["task"]["capabilities"]["extend"] != true || !valid_budgets(&payload["budgets"]) || ["headersMs","idleMs","installMs","totalMs"].iter().any(|key| payload["budgets"][*key].as_u64() < previous[*key].as_u64()) { return Err("运行中只能延长可控制阶段的时限。".into()); }
                    control["budgets"] = payload["budgets"].clone();
                }
                fs::write(task_dir.join("control.next"), serde_json::to_vec(&control).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
                fs::rename(task_dir.join("control.next"), file).map_err(|e| e.to_string())?;
            }
            Ok(json!({"job":snapshot_unlocked()?,"budgets":read_budgets(&dir)}))
        }).await.map_err(|e| e.to_string())?;
    }
    if action == "history" { return tauri::async_runtime::spawn_blocking(|| { let _registry = registry_lock()?; history_at(&crate::axiom_service::data_root()?.join("setup")) }).await.map_err(|e| e.to_string())?; }
    if action == "status" { return tauri::async_runtime::spawn_blocking(|| Ok(json!({"job":snapshot()?,"budgets":read_budgets(&crate::axiom_service::data_root()?.join("setup"))}))).await.map_err(|e| e.to_string())?; }
    if action == "acknowledge-interruption" {
        if confirmed != Some(true) { return Err("请先确认系统安装器已经全部退出。".into()); }
        return tauri::async_runtime::spawn_blocking(|| {
        let _registry = registry_lock()?;
        let job = snapshot_unlocked()?.ok_or("没有待处理的安装任务")?;
        if job["phase"] != "interrupted" { return Err("当前任务不需要解除占用。".into()); }
        let dir = crate::axiom_service::data_root()?.join("setup").join(job["id"].as_str().ok_or("安装任务编号无效")?);
        fs::write(dir.join("result.txt"), "1").map_err(|e| e.to_string())?;
        fs::write(dir.join("acknowledged.json"), r#"{"installerExitConfirmed":true}"#).map_err(|e| e.to_string())?;
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
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis() as u64;
        let task = json!({"id":id,"attemptId":id,"endpoint":"desktop","scope":"当前电脑 · 系统安装","resource":action,"label":match action.as_str() {"node"=>"Node.js 与 npm","tailscale"=>"Tailscale",_=>"后台服务"},"action":"install","status":"running","phase":"checking","steps":["checking","downloading","verifying","installing","validating"],"completedSteps":0,"createdAt":now,"startedAt":now,"updatedAt":now,"budgets":read_budgets(&dir),"capabilities":{"cancel":false,"extend":false}});
        fs::write(dir.join(&id).join("task.json"), serde_json::to_vec(&task).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        let job = json!({"id":id,"action":action,"task":task,"startedAt":now,"running":true,"phase":"running","message":"正在准备安装；请保持客户端打开。","lines":[]});
        fs::write(dir.join(&id).join("job.json"), serde_json::to_vec(&job).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
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
    fn test_root() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("axiom-system-budget-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()))
    }
    #[test]
    fn history_keeps_old_installations_and_scopes_owner_to_current_job() {
        let root = test_root(); fs::create_dir_all(&root).unwrap();
        for (index, action, status) in [(1, "node", "succeeded"), (2, "tailscale", "running"), (3, "service", "running")] {
            let id = format!("123-{index}"); let files = root.join(&id); fs::create_dir_all(&files).unwrap();
            let task = json!({"id":id,"resource":action,"status":status,"phase":"installing","steps":["installing"],"createdAt":index,"capabilities":{"cancel":false,"extend":false},"budgets":read_budgets(&root)});
            fs::write(files.join("task.json"), serde_json::to_vec(&task).unwrap()).unwrap();
            if index != 2 { fs::write(files.join("result.txt"), "0").unwrap(); }
            if index == 3 {
                let job = json!({"id":id,"action":action,"running":true,"task":task});
                fs::write(files.join("job.json"), serde_json::to_vec(&job).unwrap()).unwrap();
                fs::write(root.join("job.json"), serde_json::to_vec(&job).unwrap()).unwrap();
            }
        }
        fs::write(root.join("service-owner.json"), "{}").unwrap();
        let original = fs::read(root.join("job.json")).unwrap();
        for _ in 0..2 {
            let history = history_at(&root).unwrap();
            let tasks = history["tasks"].as_array().unwrap();
            assert_eq!(tasks.len(), 3);
            assert_eq!(tasks[0]["status"], "succeeded", "current service owner cannot taint old Node install");
            assert_eq!(tasks[1]["status"], "interrupted", "legacy orphan must not claim success");
            assert_eq!(tasks[2]["status"], "unknown");
            assert!(history["error"].is_null());
        }
        assert_eq!(fs::read(root.join("job.json")).unwrap(), original, "history never changes the active pointer");
        assert!(!root.join("123-3/acknowledged.json").exists());
        fs::create_dir_all(root.join("123-4")).unwrap();
        fs::write(root.join("123-4/task.json"), "broken").unwrap();
        let partial = history_at(&root).unwrap();
        assert_eq!(partial["tasks"].as_array().unwrap().len(), 3);
        assert!(partial["error"].as_str().unwrap().contains("123-4"));
        assert_eq!(fs::read_to_string(root.join("123-4/task.json")).unwrap(), "broken");
        let task_path = root.join("123-3/task.json"); let task_bytes = fs::read(&task_path).unwrap();
        fs::write(&task_path, "broken current task").unwrap();
        assert!(snapshot_at(&root).is_err(), "corrupt current task must block admission, not reuse stale success");
        let corrupt_current = history_at(&root).unwrap();
        assert_eq!(corrupt_current["tasks"].as_array().unwrap().len(), 2);
        assert!(corrupt_current["error"].as_str().unwrap().contains("123-3"));
        assert_eq!(fs::read_to_string(&task_path).unwrap(), "broken current task");
        fs::write(&task_path, task_bytes).unwrap();
        fs::write(root.join("job.json"), "broken pointer").unwrap();
        let corrupt_pointer = history_at(&root).unwrap();
        assert_eq!(corrupt_pointer["tasks"].as_array().unwrap().len(), 3);
        assert!(corrupt_pointer["error"].as_str().unwrap().contains("当前安装状态"));
        assert_eq!(corrupt_pointer["tasks"][2]["status"], "unknown", "unassigned service owner must remain conservative");
        assert_eq!(fs::read_to_string(root.join("job.json")).unwrap(), "broken pointer");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn history_limits_completed_tasks_without_dropping_unresolved_records() {
        let root = test_root(); fs::create_dir_all(&root).unwrap();
        for index in 1..=103 {
            let id = format!("456-{index}"); let files = root.join(&id); fs::create_dir_all(&files).unwrap();
            let task = json!({"id":id,"resource":"node","status":if index <= 2 {"unknown"} else {"succeeded"},"phase":"installing","steps":["installing"],"createdAt":index,"capabilities":{"cancel":false,"extend":false},"budgets":read_budgets(&root)});
            fs::write(files.join("task.json"), serde_json::to_vec(&task).unwrap()).unwrap();
        }
        let history = history_at(&root).unwrap();
        let tasks = history["tasks"].as_array().unwrap();
        assert_eq!(tasks.len(), 102);
        assert_eq!(tasks.iter().filter(|task| task["status"] == "unknown").count(), 2);
        assert!(!tasks.iter().any(|task| task["id"] == "456-3"));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn system_budget_extension_keeps_original_phase_start() {
        let root = test_root(); fs::create_dir_all(&root).unwrap();
        let mut task = json!({"phase":"installing","startedAt":1000,"phaseStartedAt":2000,"capabilities":{"cancel":false},"budgets":{"headersMs":1000,"idleMs":1000,"installMs":1000,"totalMs":10000}});
        assert!(system_deadline(&task, 2999).is_none());
        assert_eq!(system_deadline(&task, 3000).unwrap()["code"], "install-timeout");
        fs::write(root.join("control.json"), r#"{"budgets":{"headersMs":1000,"idleMs":1000,"installMs":5000,"totalMs":20000}}"#).unwrap();
        merge_system_budgets(&mut task, &root);
        assert!(system_deadline(&task, 6999).is_none());
        assert_eq!(system_deadline(&task, 7000).unwrap()["code"], "install-timeout");
        assert_eq!(system_deadline(&task, 21000).unwrap()["code"], "total-timeout");
        task["capabilities"]["cancel"] = json!(true);
        assert!(system_deadline(&task, 21000).is_none(), "controllable stages use their own abort protocol");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn expired_system_installer_waits_and_late_success_does_not_release_uncertainty() {
        let root = test_root(); let files = root.join("123-456"); fs::create_dir_all(&files).unwrap();
        fs::write(root.join("job.json"), r#"{"id":"123-456","action":"node","running":true}"#).unwrap();
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64;
        let task = json!({"id":"123-456","status":"running","phase":"installing","startedAt":now,"phaseStartedAt":now-1001,"capabilities":{"cancel":false,"extend":false},"budgets":{"headersMs":1000,"idleMs":1000,"installMs":1000,"totalMs":10000}});
        fs::write(files.join("task.json"), serde_json::to_vec(&task).unwrap()).unwrap();
        let lease = open_lock(&files.join("owner.lock")).unwrap(); lease.try_lock().unwrap();
        assert_eq!(snapshot_at(&root).unwrap().unwrap()["task"]["capabilities"]["extend"], true);
        let mut command = Command::new("node"); command.args(["-e", "setTimeout(() => {}, 700)"]); hidden(&mut command);
        let mut child = command.spawn().unwrap(); let started = Instant::now();
        assert!(wait_installer(&mut child, &files, true).unwrap().success());
        assert!(started.elapsed() >= Duration::from_millis(500), "timeout must not kill the system installer");
        fs::write(files.join("result.txt"), "0").unwrap();
        let active = snapshot_at(&root).unwrap().unwrap();
        assert_eq!(active["running"], true); assert_eq!(active["task"]["status"], "unknown");
        assert_eq!(active["task"]["error"]["code"], "install-timeout");
        assert_eq!(active["task"]["capabilities"]["extend"], false);
        drop(lease);
        let finished = snapshot_at(&root).unwrap().unwrap();
        assert_eq!(finished["phase"], "interrupted"); assert_eq!(finished["running"], false);
        fs::write(files.join("acknowledged.json"), "{}").unwrap(); fs::write(files.join("result.txt"), "1").unwrap();
        assert_eq!(snapshot_at(&root).unwrap().unwrap()["phase"], "error");
        assert!(files.join("system-timeout.json").exists(), "acknowledgement retains timeout evidence");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn lost_system_observer_blocks_retry_even_with_a_result_file() {
        let root = test_root(); let files = root.join("123-456"); fs::create_dir_all(&files).unwrap();
        fs::write(root.join("job.json"), r#"{"id":"123-456","action":"node","running":true}"#).unwrap();
        fs::write(files.join("observer-started.json"), "{}").unwrap();
        fs::write(files.join("result.txt"), "1").unwrap();
        assert_eq!(snapshot_at(&root).unwrap().unwrap()["phase"], "interrupted");
        fs::write(files.join("observer-complete.json"), "{}").unwrap();
        assert_eq!(snapshot_at(&root).unwrap().unwrap()["phase"], "error");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn service_unknown_survives_lease_loss_and_exit_markers() {
        let root = test_root(); let files = root.join("123-456"); fs::create_dir_all(&files).unwrap();
        fs::write(root.join("job.json"), r#"{"id":"123-456","action":"service","running":true}"#).unwrap();
        let task = json!({"id":"123-456","status":"unknown","message":"后台可能已启动，请核实状态。","error":{"code":"stop-unconfirmed"},"capabilities":{"cancel":true,"extend":true}});
        fs::write(files.join("task.json"), serde_json::to_vec(&task).unwrap()).unwrap();
        for result in [None, Some("0"), Some("1")] {
            if let Some(code) = result { fs::write(files.join("result.txt"), code).unwrap(); }
            let recovered = snapshot_at(&root).unwrap().unwrap();
            assert_eq!(recovered["task"]["status"], "unknown");
            assert_eq!(recovered["task"]["error"]["code"], "stop-unconfirmed");
            assert_eq!(recovered["phase"], "interrupted");
            assert_eq!(recovered["running"], false);
            assert_eq!(recovered["message"], task["message"]);
            assert_eq!(recovered["task"]["capabilities"], json!({"cancel":false,"extend":false}));
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn retained_service_owner_cannot_be_overridden_by_exit_or_acknowledgement() {
        let root = test_root(); let files = root.join("123-456"); fs::create_dir_all(&files).unwrap();
        fs::write(root.join("job.json"), r#"{"id":"123-456","action":"service","running":true}"#).unwrap();
        fs::write(root.join("service-owner.json"), "{}").unwrap();
        fs::write(files.join("task.json"), r#"{"id":"123-456","status":"running","phase":"installing"}"#).unwrap();
        for result in [None, Some("0"), Some("1")] {
            if let Some(code) = result { fs::write(files.join("result.txt"), code).unwrap(); }
            for acknowledge in [false, true] {
                if acknowledge { fs::write(files.join("acknowledged.json"), "{}").unwrap(); }
                let recovered = snapshot_at(&root).unwrap().unwrap();
                assert_eq!(recovered["task"]["status"], "unknown");
                assert_eq!(recovered["task"]["error"]["code"], "stop-unconfirmed");
                assert_eq!(recovered["phase"], "interrupted");
                assert_eq!(recovered["running"], false);
                assert_eq!(recovered["task"]["capabilities"], json!({"cancel":false,"extend":false}));
                if acknowledge { fs::remove_file(files.join("acknowledged.json")).unwrap(); }
            }
        }
        fs::remove_dir_all(root).unwrap();
    }
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
